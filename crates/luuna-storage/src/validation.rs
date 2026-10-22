//! Transactional candidate identity, command evidence, review and repair gates.
use crate::{
    append, authorize_run, get_run, now, transition, Result, RunRecord, StorageError, Store,
};
use luuna_domain::{
    BudgetUsage, CandidateEvidence, CandidateSet, CandidateStatus, CheckResult, CheckStatus,
    DomainError, PlanRevision, ProjectManifest, ReviewResult, ReviewVerdict, RunState,
    TicketPurpose,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::Serialize;
use serde_json::json;
use std::collections::BTreeMap;

/// Seconds between the durable heartbeats of an active validation or review
/// stage. Restart recovery charges an interrupted stage up to its last
/// heartbeat plus one interval, so an outage is not charged as stage time.
pub const STAGE_HEARTBEAT_SECONDS: u64 = 5;

/// Event recorded when a writer or reviewer session reported token usage
/// without a provider cost: the cost budget cannot meter that spend.
pub const COST_UNREPORTED_EVENT: &str = "usage.cost_unreported";

/// Why a multi-repository candidate set has no repair path (ADR 0017).
pub const MULTI_REPOSITORY_REPAIR: &str = "repair is not available for a multi-repository candidate set: create the next plan revision (re-plan) so every task runs again against the recorded evidence";

const REVIEW_PROMPT_SENT: &str = "review.prompt_sent";
const REVIEW_USAGE_SETTLED: &str = "review.usage_settled";

/// One workflow's aggregate usage (writer attempts plus validation and review)
/// against its approved plan budgets and the project's repair policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WorkflowUsageView {
    pub attempts: u64,
    pub max_attempts: u64,
    pub elapsed_seconds: u64,
    pub timeout_seconds: u64,
    pub cost_usd_micros: u64,
    pub cost_budget_usd_micros: u64,
    /// A session reported tokens without a cost, so `cost_usd_micros` is a
    /// lower bound and the cost budget did not meter that spend.
    pub cost_unreported: bool,
    pub repairs: u64,
    /// `max_task_repairs` of the plan's manifest, when it is still recorded.
    pub max_repairs: Option<u64>,
}

/// Usage accumulated across every workflow opened for one ticket's plan
/// revisions; each revision has its own approved budgets.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct TicketUsage {
    pub workflows: u64,
    pub attempts: u64,
    pub elapsed_seconds: u64,
    pub cost_usd_micros: u64,
    pub cost_unreported: bool,
    pub repairs: u64,
}

impl Store {
    /// Freeze the writer's exact commit/tree identity and enter validation.
    pub fn record_candidate(
        &mut self,
        run_id: &str,
        expected_revision: u64,
        candidate: &CandidateSet,
        repository_trees: &BTreeMap<String, String>,
        implementer_session: &str,
    ) -> Result<CandidateEvidence> {
        candidate.validate()?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = require_run(&tx, run_id, expected_revision)?;
        if run.state != RunState::Implementing {
            return invalid("only an implementing workflow can record a candidate");
        }
        let writer_completed: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM attempts WHERE id=?1 AND run_id=?2 AND state='completed')",
            params![implementer_session, run_id],
            |r| r.get(0),
        )?;
        if !writer_completed {
            return invalid(
                "candidate must name a completed writer attempt belonging to this workflow",
            );
        }
        let plan = current_plan(&tx, run_id)?;
        if candidate.plan_hash != plan.hash
            || candidate.repository_commits.keys().collect::<Vec<_>>()
                != plan.base_commits.keys().collect::<Vec<_>>()
        {
            return invalid("candidate does not match the approved plan and repositories");
        }
        let previous = current_candidate(&tx, run_id)?;
        if candidate.revision != previous.as_ref().map_or(1, |c| c.candidate.revision + 1)
            || previous
                .as_ref()
                .is_some_and(|p| p.candidate.id != candidate.id)
        {
            return invalid("candidate revisions must be sequential under one identity");
        }
        let evidence = CandidateEvidence {
            candidate: candidate.clone(),
            run_id: run_id.into(),
            implementer_session: implementer_session.into(),
            repository_trees: repository_trees.clone(),
            status: CandidateStatus::Pending,
            validation_generation: 0,
            results: vec![],
            review: None,
            elapsed_seconds: 0,
            cost_usd_micros: 0,
            stage_started_at: None,
            stage_start_elapsed_seconds: 0,
            stage_checkpoint_at: None,
            started_at: now(),
            finished_at: None,
            reason: None,
            content_drift: false,
        };
        evidence.validate()?;
        tx.execute(
            "INSERT INTO candidates(hash,run_id,id,revision,status,payload,created_at) VALUES (?1,?2,?3,?4,'pending',?5,?6)",
            params![candidate.hash,run_id,candidate.id,candidate.revision,serde_json::to_string(&evidence)?,evidence.started_at],
        )?;
        append(
            &tx,
            run_id,
            "candidate.recorded",
            json!({"candidate":candidate,"repository_trees":repository_trees}),
        )?;
        transition(
            &tx,
            run_id,
            expected_revision,
            RunState::Validating,
            "run.validating",
            json!({"candidate": candidate, "repository_trees": repository_trees}),
        )?;
        tx.commit()?;
        Ok(evidence)
    }

    pub fn current_candidate(&self, run_id: &str) -> Result<Option<CandidateEvidence>> {
        current_candidate(&self.connection, run_id)
    }

    pub fn candidates(&self, run_id: &str) -> Result<Vec<CandidateEvidence>> {
        let mut statement = self
            .connection
            .prepare("SELECT hash FROM candidates WHERE run_id=?1 ORDER BY revision")?;
        let hashes = statement
            .query_map([run_id], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        hashes
            .iter()
            .map(|hash| {
                load_candidate(&self.connection, hash)?
                    .ok_or_else(|| StorageError::NotFound(hash.clone()))
            })
            .collect()
    }

    /// Claim a pending candidate once. A restart retry gets a fresh evidence
    /// generation; old command/review records remain immutable and auditable.
    pub fn begin_candidate_validation(
        &mut self,
        run_id: &str,
        expected_revision: u64,
        hash: &str,
    ) -> Result<CandidateEvidence> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = require_run(&tx, run_id, expected_revision)?;
        let mut evidence = require_candidate(&tx, run_id, hash)?;
        let revalidation = validation_gate(&tx, &run, &evidence)?;
        evidence.validation_generation += 1;
        evidence.results.clear();
        evidence.review = None;
        evidence.status = CandidateStatus::Validating;
        evidence.finished_at = None;
        evidence.reason = None;
        evidence.stage_started_at = Some(now());
        evidence.stage_checkpoint_at = evidence.stage_started_at.clone();
        evidence.stage_start_elapsed_seconds = evidence.elapsed_seconds;
        save_candidate(&tx, &evidence)?;
        let payload = json!({
            "candidate_hash": hash,
            "generation": evidence.validation_generation,
            "revalidation": revalidation,
        });
        if run.state != RunState::Validating {
            transition(
                &tx,
                run_id,
                expected_revision,
                RunState::Validating,
                "candidate.validation_started",
                payload,
            )?;
        } else {
            bump(&tx, &run, "candidate.validation_started", payload)?;
        }
        tx.commit()?;
        Ok(evidence)
    }

    pub fn record_candidate_check(
        &mut self,
        run_id: &str,
        hash: &str,
        result: &CheckResult,
    ) -> Result<()> {
        result.validate()?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let evidence = require_candidate(&tx, run_id, hash)?;
        let run = get_run(&tx, run_id)?.ok_or_else(|| StorageError::NotFound(run_id.into()))?;
        if run.state != RunState::Validating || evidence.status != CandidateStatus::Validating {
            return invalid("checks require an active candidate validation");
        }
        let plan = current_plan(&tx, run_id)?;
        let recipe = plan
            .required_checks
            .iter()
            .find(|c| c.id == result.recipe_id && c.repository_id == result.repository_id)
            .ok_or_else(|| {
                StorageError::Invalid("check does not name an approved recipe".into())
            })?;
        let command: Vec<String> = std::iter::once(recipe.executable.clone())
            .chain(recipe.args.clone())
            .collect();
        if result.candidate_hash != hash
            || result.run_id != run_id
            || evidence
                .candidate
                .repository_commits
                .get(&result.repository_id)
                != Some(&result.commit)
            || result.command != command
            || result.cwd != recipe.cwd
        {
            return invalid("check inputs do not match the exact candidate and approved recipe");
        }
        // The index column is unique per candidate and generation; recipes of
        // a multi-repository set are keyed by repository too (results are
        // read back from the payload, which names both).
        let recipe_key = if evidence.candidate.repository_commits.len() > 1 {
            format!("{}/{}", result.repository_id, result.recipe_id)
        } else {
            result.recipe_id.clone()
        };
        tx.execute("INSERT INTO candidate_check_results(id,candidate_hash,generation,recipe_id,payload) VALUES (?1,?2,?3,?4,?5)",
            params![result.id,hash,evidence.validation_generation,recipe_key,serde_json::to_string(result)?])?;
        append(
            &tx,
            run_id,
            "candidate.check_finished",
            json!({"candidate_hash":hash,"generation":evidence.validation_generation,"result":result}),
        )?;
        tx.commit()?;
        Ok(())
    }

    /// The runtime aggregates actual recipe outcomes, never a model's claim.
    pub fn finish_candidate_validation(
        &mut self,
        run_id: &str,
        expected_revision: u64,
        hash: &str,
    ) -> Result<CandidateEvidence> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = require_run(&tx, run_id, expected_revision)?;
        let mut evidence = require_candidate(&tx, run_id, hash)?;
        if run.state != RunState::Validating || evidence.status != CandidateStatus::Validating {
            return invalid("candidate validation is not active");
        }
        let plan = current_plan(&tx, run_id)?;
        // The validation's own elapsed time is charged in this transaction, so
        // whatever ran after the worker's last charge is not lost.
        retain_live_elapsed(&mut evidence);
        save_candidate(&tx, &evidence)?;
        let required: Vec<_> = plan.required_checks.iter().filter(|c| c.required).collect();
        let statuses: Vec<_> = required
            .iter()
            .map(|recipe| {
                evidence
                    .results
                    .iter()
                    .find(|r| r.recipe_id == recipe.id && r.repository_id == recipe.repository_id)
                    .map(|r| r.status)
            })
            .collect();
        // A failing or blocked required check is named with its repository:
        // for a multi-repository set a consumer's failing check is the
        // integration verdict, and no other repository's success stands for it.
        let named = |wanted: CheckStatus| -> String {
            let names: Vec<String> = required
                .iter()
                .zip(&statuses)
                .filter(|(_, status)| **status == Some(wanted))
                .map(|(recipe, _)| format!("{}/{}", recipe.repository_id, recipe.id))
                .collect();
            let integration = if plan.base_commits.len() > 1 {
                "; integration blocked: the candidate set is not accepted"
            } else {
                ""
            };
            format!(" ({}{integration})", names.join(", "))
        };
        let failed_reason = format!(
            "required candidate checks failed{}",
            named(CheckStatus::Failed)
        );
        let blocked_reason = format!(
            "required candidate checks could not run meaningfully{}",
            named(CheckStatus::Blocked)
        );
        // A testing-setup candidate exists to make tests run: besides every
        // required check passing, at least one of them must have executed a
        // test its recognised runner counted. A check that merely exits 0, or
        // whose runner the executor does not recognise, is not evidence that a
        // suite exists (ADR 0022); the executor already blocks empty and
        // skip-only suites, which the rule above turns into `testing_blocked`.
        let setup_without_tests = plan.purpose == TicketPurpose::TestingSetup
            && !statuses.contains(&None)
            && statuses
                .iter()
                .all(|status| *status == Some(CheckStatus::Passed))
            && !required.iter().any(|recipe| {
                evidence.results.iter().any(|r| {
                    r.recipe_id == recipe.id
                        && r.repository_id == recipe.repository_id
                        && r.status == CheckStatus::Passed
                        && r.tests_detected.is_some_and(|count| count > 0)
                })
            });
        let setup_reason = format!(
            "testing setup candidate executed no recognised test: every required check passed without a test runner summary counting at least one executed test ({}); the setup must make real tests run",
            required
                .iter()
                .map(|recipe| format!("{}/{}", recipe.repository_id, recipe.id))
                .collect::<Vec<_>>()
                .join(", ")
        );
        let (mut next, mut status, mut reason) = if statuses.contains(&None) {
            (
                RunState::Failed,
                CandidateStatus::Failed,
                Some("candidate lacks required command evidence"),
            )
        } else if statuses.contains(&Some(CheckStatus::Interrupted)) {
            (
                RunState::Interrupted,
                CandidateStatus::Interrupted,
                Some("candidate check was interrupted"),
            )
        } else if statuses.contains(&Some(CheckStatus::Cancelled)) {
            (
                RunState::Cancelled,
                CandidateStatus::Cancelled,
                Some("candidate check was cancelled"),
            )
        } else if statuses.contains(&Some(CheckStatus::Blocked)) {
            (
                RunState::TestingBlocked,
                CandidateStatus::TestingBlocked,
                Some(blocked_reason.as_str()),
            )
        } else if statuses.contains(&Some(CheckStatus::Failed)) {
            (
                RunState::Failed,
                CandidateStatus::Failed,
                Some(failed_reason.as_str()),
            )
        } else if setup_without_tests {
            (
                RunState::TestingBlocked,
                CandidateStatus::TestingBlocked,
                Some(setup_reason.as_str()),
            )
        } else {
            (RunState::Reviewing, CandidateStatus::Reviewing, None)
        };
        if next == RunState::Reviewing
            && require_headroom(&plan, workflow_usage(&tx, run_id)?).is_err()
        {
            next = RunState::Paused;
            status = CandidateStatus::Paused;
            reason = Some("workflow budget exhausted before independent review; re-plan required");
        }
        evidence.status = status;
        evidence.reason = reason.map(ToOwned::to_owned);
        if next != RunState::Reviewing {
            evidence.finished_at = Some(now());
            evidence.stage_started_at = None;
        } else {
            evidence.stage_started_at = Some(now());
            evidence.stage_start_elapsed_seconds = evidence.elapsed_seconds;
        }
        evidence.stage_checkpoint_at = evidence.stage_started_at.clone();
        save_candidate(&tx, &evidence)?;
        transition(
            &tx,
            run_id,
            expected_revision,
            next,
            "candidate.validation_finished",
            json!({"candidate_hash":hash,"reason":evidence.reason}),
        )?;
        tx.commit()?;
        Ok(evidence)
    }

    pub fn finish_candidate_review(
        &mut self,
        run_id: &str,
        expected_revision: u64,
        hash: &str,
        review: &ReviewResult,
    ) -> Result<CandidateEvidence> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = require_run(&tx, run_id, expected_revision)?;
        let mut evidence = require_candidate(&tx, run_id, hash)?;
        if run.state != RunState::Reviewing || evidence.status != CandidateStatus::Reviewing {
            return invalid("candidate review is not active");
        }
        let plan = current_plan(&tx, run_id)?;
        review.validate_for(&evidence.candidate, &evidence.implementer_session)?;
        // The review's elapsed time is charged in this transaction, and a
        // review that would end past the approved budget is not recorded: the
        // workflow pauses for re-planning instead.
        retain_live_elapsed(&mut evidence);
        save_candidate(&tx, &evidence)?;
        let usage = workflow_usage(&tx, run_id)?;
        if let Err(error) = plan.budgets.check(usage) {
            evidence.status = CandidateStatus::Paused;
            evidence.reason = Some(error.to_string());
            evidence.finished_at = Some(now());
            evidence.stage_started_at = None;
            evidence.stage_checkpoint_at = None;
            save_candidate(&tx, &evidence)?;
            transition(
                &tx,
                run_id,
                expected_revision,
                RunState::Paused,
                "candidate.budget_exhausted",
                json!({"candidate_hash":hash,"reason":error.to_string(),"usage":usage}),
            )?;
            tx.commit()?;
            return Ok(evidence);
        }
        let implemented: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM attempts WHERE id=?1 AND run_id=?2)",
            params![review.reviewer_session, run_id],
            |r| r.get(0),
        )?;
        if implemented {
            return invalid(
                "reviewer session must be independent of every writer attempt in this workflow",
            );
        }
        tx.execute("INSERT INTO candidate_reviews(id,candidate_hash,generation,payload) VALUES (?1,?2,?3,?4)",
            params![review.id,hash,evidence.validation_generation,serde_json::to_string(review)?])?;
        let next = if review.verdict == ReviewVerdict::Passed {
            RunState::Reviewed
        } else {
            RunState::Paused
        };
        evidence.status = if next == RunState::Reviewed {
            CandidateStatus::Reviewed
        } else {
            CandidateStatus::Paused
        };
        evidence.reason = if next == RunState::Reviewed {
            None
        } else {
            Some("independent review did not pass; repair or re-plan required".into())
        };
        evidence.finished_at = Some(now());
        evidence.review = Some(review.clone());
        evidence.stage_started_at = None;
        evidence.stage_checkpoint_at = None;
        save_candidate(&tx, &evidence)?;
        transition(
            &tx,
            run_id,
            expected_revision,
            next,
            "candidate.review_finished",
            json!({"candidate_hash":hash,"review":review,"reason":evidence.reason}),
        )?;
        tx.commit()?;
        Ok(evidence)
    }

    /// Settle transport, timeout or cancellation errors without inventing review evidence.
    pub fn fail_candidate_stage(
        &mut self,
        run_id: &str,
        expected_revision: u64,
        hash: &str,
        next: RunState,
        reason: &str,
    ) -> Result<CandidateEvidence> {
        self.settle_candidate_stage(run_id, expected_revision, hash, next, reason, false)
    }

    /// The plan a workflow is authorized to act on right now: its durably
    /// stored approval must still authorize the *latest* revision of its plan
    /// (a newer revision supersedes the approval), and the plan's ticket and
    /// manifest bindings must still hold. This is the gate validation and
    /// repair apply in their transactions, evaluated read-only for
    /// publication admission so a reviewed candidate cannot be published
    /// under superseded authorization.
    pub fn authorize_workflow(&self, run_id: &str) -> Result<PlanRevision> {
        let tx = self.connection.unchecked_transaction()?;
        current_plan(&tx, run_id)
    }

    /// Invalidate a reviewed candidate whose inputs changed after the review:
    /// the owned worktree drifted from the frozen candidate when publication
    /// was requested, or the developer sends a CI failure to repair. The
    /// candidate is marked failed with the reason (content drift marked so it
    /// is never re-validated in place), the run leaves `reviewed` for
    /// `failed`, and `candidate.invalidated` records it; repair or the next
    /// plan revision follow as for any failed candidate.
    pub fn invalidate_reviewed_candidate(
        &mut self,
        run_id: &str,
        hash: &str,
        reason: &str,
        content_drift: bool,
    ) -> Result<CandidateEvidence> {
        if reason.trim().is_empty() {
            return invalid("candidate invalidation needs a reason");
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = get_run(&tx, run_id)?.ok_or_else(|| StorageError::NotFound(run_id.into()))?;
        let mut evidence = require_candidate(&tx, run_id, hash)?;
        if run.state != RunState::Reviewed || evidence.status != CandidateStatus::Reviewed {
            return invalid("only a reviewed candidate can be invalidated after review");
        }
        evidence.status = CandidateStatus::Failed;
        evidence.reason = Some(reason.into());
        evidence.finished_at = Some(now());
        evidence.stage_started_at = None;
        evidence.stage_checkpoint_at = None;
        evidence.content_drift |= content_drift;
        save_candidate(&tx, &evidence)?;
        transition(
            &tx,
            run_id,
            run.revision,
            RunState::Failed,
            "candidate.invalidated",
            json!({"candidate_hash":hash,"reason":reason,"content_drift":content_drift,"review_retained_as_history":true}),
        )?;
        tx.commit()?;
        Ok(evidence)
    }

    /// Fail a generation whose owned worktree no longer holds the frozen
    /// candidate (a tracked edit, a moved HEAD, a missing or rebound worktree).
    /// The candidate is marked so it is never re-validated in place: nothing
    /// that ran there is evidence for the candidate any more. Repair (a new
    /// revision in a fresh worktree) or a new plan revision remain.
    pub fn fail_candidate_drift(
        &mut self,
        run_id: &str,
        expected_revision: u64,
        hash: &str,
        reason: &str,
    ) -> Result<CandidateEvidence> {
        self.settle_candidate_stage(
            run_id,
            expected_revision,
            hash,
            RunState::Failed,
            reason,
            true,
        )
    }

    fn settle_candidate_stage(
        &mut self,
        run_id: &str,
        expected_revision: u64,
        hash: &str,
        next: RunState,
        reason: &str,
        content_drift: bool,
    ) -> Result<CandidateEvidence> {
        if !matches!(
            next,
            RunState::Failed
                | RunState::TestingBlocked
                | RunState::Paused
                | RunState::Cancelled
                | RunState::Interrupted
        ) || reason.trim().is_empty()
        {
            return invalid("candidate stage failure needs a supported state and reason");
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let run = require_run(&tx, run_id, expected_revision)?;
        let mut evidence = require_candidate(&tx, run_id, hash)?;
        evidence.status = candidate_status(next)?;
        evidence.reason = Some(reason.into());
        evidence.finished_at = Some(now());
        evidence.stage_started_at = None;
        evidence.content_drift |= content_drift;
        evidence.stage_checkpoint_at = None;
        save_candidate(&tx, &evidence)?;
        let mut payload = json!({"candidate_hash":hash,"reason":reason});
        if content_drift {
            payload["content_drift"] = json!(true);
        }
        if run.state == RunState::Paused && next == RunState::Paused {
            bump(&tx, &run, "candidate.stage_failed", payload)?;
        } else {
            transition(
                &tx,
                run_id,
                expected_revision,
                next,
                "candidate.stage_failed",
                payload,
            )?;
        }
        tx.commit()?;
        Ok(evidence)
    }

    pub fn workflow_usage(&self, run_id: &str) -> Result<BudgetUsage> {
        workflow_usage(&self.connection, run_id)
    }

    /// Always retain consumed resources. Exhaustion pauses active work in the
    /// same transaction; callers must stop workers when the returned usage exceeds budget.
    pub fn charge_candidate_usage(
        &mut self,
        run_id: &str,
        hash: &str,
        elapsed_seconds: u64,
        cost_usd_micros: u64,
    ) -> Result<BudgetUsage> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut evidence = require_candidate(&tx, run_id, hash)?;
        let plan = bound_plan(&tx, run_id)?;
        // A charge of nothing still checks the budget, but rewrites no row and
        // appends no `candidate.usage` event: streaming records and stage
        // boundaries that consumed nothing must not grow the history.
        let changed = elapsed_seconds > 0 || cost_usd_micros > 0;
        evidence.elapsed_seconds = evidence.elapsed_seconds.saturating_add(elapsed_seconds);
        evidence.cost_usd_micros = evidence.cost_usd_micros.saturating_add(cost_usd_micros);
        if changed {
            save_candidate(&tx, &evidence)?;
        }
        let usage = workflow_usage(&tx, run_id)?;
        if let Err(error) = plan.budgets.check(usage) {
            let run = get_run(&tx, run_id)?.ok_or_else(|| StorageError::NotFound(run_id.into()))?;
            if matches!(run.state, RunState::Validating | RunState::Reviewing) {
                evidence.status = CandidateStatus::Paused;
                evidence.reason = Some(error.to_string());
                evidence.finished_at = Some(now());
                save_candidate(&tx, &evidence)?;
                transition(
                    &tx,
                    run_id,
                    run.revision,
                    RunState::Paused,
                    "candidate.budget_exhausted",
                    json!({"candidate_hash":hash,"reason":error.to_string(),"usage":usage}),
                )?;
            }
        }
        if changed {
            append(
                &tx,
                run_id,
                "candidate.usage",
                json!({"candidate_hash":hash,"usage":usage}),
            )?;
        }
        tx.commit()?;
        Ok(usage)
    }

    /// Stamp the active validation or review stage's durable heartbeat. The
    /// runtime calls this every `STAGE_HEARTBEAT_SECONDS` while the stage
    /// runs; nothing is charged and no event is appended. Returns whether a
    /// stage was active.
    pub fn checkpoint_candidate_stage(&mut self, run_id: &str, hash: &str) -> Result<bool> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut evidence = require_candidate(&tx, run_id, hash)?;
        if !matches!(
            evidence.status,
            CandidateStatus::Validating | CandidateStatus::Reviewing
        ) || evidence.stage_started_at.is_none()
        {
            return Ok(false);
        }
        evidence.stage_checkpoint_at = Some(now());
        save_candidate(&tx, &evidence)?;
        tx.commit()?;
        Ok(true)
    }

    /// Durable record, written immediately before the reviewer prompt is
    /// sent, that provider work may now be billed before Pi reports it. Only
    /// with this marker (and without a later settled marker) does restart
    /// recovery reserve the remaining approved cost budget.
    pub fn record_review_prompt_sent(
        &mut self,
        run_id: &str,
        hash: &str,
        reviewer_session: &str,
    ) -> Result<()> {
        self.review_marker(run_id, hash, reviewer_session, REVIEW_PROMPT_SENT)
    }

    /// Durable record that the reviewer settled (Pi will do no further model
    /// work) after its final usage was charged.
    pub fn record_review_usage_settled(
        &mut self,
        run_id: &str,
        hash: &str,
        reviewer_session: &str,
    ) -> Result<()> {
        self.review_marker(run_id, hash, reviewer_session, REVIEW_USAGE_SETTLED)
    }

    fn review_marker(
        &mut self,
        run_id: &str,
        hash: &str,
        reviewer_session: &str,
        kind: &str,
    ) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let evidence = require_candidate(&tx, run_id, hash)?;
        if evidence.status != CandidateStatus::Reviewing || reviewer_session.is_empty() {
            return invalid("reviewer markers require an active candidate review");
        }
        append(
            &tx,
            run_id,
            kind,
            json!({"candidate_hash": hash, "generation": evidence.validation_generation, "reviewer_session": reviewer_session}),
        )?;
        tx.commit()?;
        Ok(())
    }

    /// The workflow's aggregate usage against its approved budgets, as clients
    /// display it; `None` for a run that is not bound to a plan.
    pub fn workflow_usage_view(&self, run_id: &str) -> Result<Option<WorkflowUsageView>> {
        let plan = match bound_plan(&self.connection, run_id) {
            Ok(plan) => plan,
            Err(StorageError::Invalid(_)) => return Ok(None),
            Err(error) => return Err(error),
        };
        let usage = workflow_usage(&self.connection, run_id)?;
        let max_repairs: Option<String> = self
            .connection
            .query_row(
                "SELECT payload FROM manifest_revisions WHERE project_id=?1 AND hash=?2 ORDER BY revision DESC LIMIT 1",
                params![plan.project_id, plan.manifest_hash],
                |r| r.get(0),
            )
            .optional()?;
        let max_repairs = max_repairs
            .map(|payload| serde_json::from_str::<ProjectManifest>(&payload))
            .transpose()?
            .map(|manifest| u64::from(manifest.policy.max_task_repairs));
        Ok(Some(WorkflowUsageView {
            attempts: u64::from(usage.attempts),
            max_attempts: u64::from(plan.budgets.max_attempts),
            elapsed_seconds: usage.elapsed_seconds,
            timeout_seconds: plan.budgets.timeout_seconds,
            cost_usd_micros: usage.cost_usd_micros,
            cost_budget_usd_micros: plan.budgets.cost_usd_micros,
            cost_unreported: cost_unreported(&self.connection, run_id)?,
            repairs: repair_count(&self.connection, run_id)?,
            max_repairs,
        }))
    }

    /// Usage accumulated by every workflow opened for the ticket's plan
    /// revisions. A new revision starts its own budgets; this is what the
    /// approver sees as already spent on the ticket.
    pub fn ticket_usage(&self, ticket_id: &str) -> Result<TicketUsage> {
        let mut statement = self.connection.prepare(
            "SELECT r.id FROM runs r JOIN plan_revisions p ON p.id=r.plan_id AND p.revision=r.plan_revision WHERE json_extract(p.payload,'$.ticket_id')=?1 ORDER BY r.rowid",
        )?;
        let runs = statement
            .query_map([ticket_id], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut total = TicketUsage::default();
        for run_id in runs {
            let usage = workflow_usage(&self.connection, &run_id)?;
            total.workflows += 1;
            total.attempts = total.attempts.saturating_add(u64::from(usage.attempts));
            total.elapsed_seconds = total.elapsed_seconds.saturating_add(usage.elapsed_seconds);
            total.cost_usd_micros = total.cost_usd_micros.saturating_add(usage.cost_usd_micros);
            total.repairs = total
                .repairs
                .saturating_add(repair_count(&self.connection, &run_id)?);
            total.cost_unreported |= cost_unreported(&self.connection, &run_id)?;
        }
        Ok(total)
    }

    pub fn can_candidate_repair(&self, run_id: &str, hash: &str) -> Result<()> {
        repair_gate(&self.connection, run_id, hash).map(|_| ())
    }

    /// Whether a failed candidate may start a fresh validation generation in
    /// place: its required checks passed in the current generation, no
    /// reviewer verdict was recorded (the reviewer failed, produced invalid or
    /// self-inconsistent output, or never reported), and the approved budgets
    /// still have headroom. Spend reserved for an unreported reviewer turn
    /// closes this gate exactly as it closes repair.
    pub fn can_candidate_revalidate(&self, run_id: &str, hash: &str) -> Result<()> {
        // A read-only transaction so the same approval, ticket and manifest
        // binding checks as `begin_candidate_validation` apply; it is dropped
        // without a commit.
        let tx = self.connection.unchecked_transaction()?;
        let run = get_run(&tx, run_id)?.ok_or_else(|| StorageError::NotFound(run_id.into()))?;
        let evidence = require_candidate(&tx, run_id, hash)?;
        if (run.state, evidence.status) != (RunState::Failed, CandidateStatus::Failed) {
            return invalid("candidate is not a failed candidate awaiting a fresh validation");
        }
        validation_gate(&tx, &run, &evidence).map(|_| ())
    }

    /// Whether `POST …/validate` may claim a generation of this exact
    /// candidate now, and whether it would be a re-validation in place. This
    /// is the gate `begin_candidate_validation` applies in its transaction,
    /// evaluated in a read-only transaction that is dropped without a commit,
    /// so `GET …/candidate` reports what the route decides.
    pub fn can_candidate_validate(&self, run_id: &str, hash: &str) -> Result<bool> {
        let tx = self.connection.unchecked_transaction()?;
        let run = get_run(&tx, run_id)?.ok_or_else(|| StorageError::NotFound(run_id.into()))?;
        let evidence = require_candidate(&tx, run_id, hash)?;
        validation_gate(&tx, &run, &evidence)
    }

    /// Reuse the exact approved scope and durable budgets, never resetting them.
    pub fn begin_candidate_repair(
        &mut self,
        run_id: &str,
        expected_revision: u64,
        hash: &str,
        environment_fingerprint: &str,
    ) -> Result<RunRecord> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_run(&tx, run_id, expected_revision)?;
        let usage = repair_gate(&tx, run_id, hash)?;
        let plan = current_plan(&tx, run_id)?;
        if environment_fingerprint.is_empty() {
            return invalid("repair requires the current host fingerprint");
        }
        // A testing-setup candidate is repaired under the same admission that
        // scheduled it: there is no baseline yet by definition (ADR 0022).
        for repository_id in plan.base_commits.keys() {
            if plan.purpose == TicketPurpose::TestingSetup {
                break;
            }
            let evidence = crate::baselines::latest_baseline(&tx, &plan.project_id, repository_id)?
                .ok_or_else(|| {
                    StorageError::Domain(DomainError::BaselineRequired(
                        "repair requires a passed baseline".into(),
                    ))
                })?;
            evidence.authorizes(&plan, repository_id, environment_fingerprint)?;
            let run = get_run(&tx, &evidence.run_id)?
                .ok_or_else(|| StorageError::NotFound(evidence.run_id.clone()))?;
            if run.state != RunState::Completed {
                return invalid("repair baseline run has not completed");
            }
        }
        crate::writer::require_repositories_free(&tx, run_id, &plan)?;
        transition(
            &tx,
            run_id,
            expected_revision,
            RunState::Implementing,
            "candidate.repair_started",
            json!({"candidate_hash":hash,"usage":usage}),
        )?;
        tx.commit()?;
        self.get_run(run_id)?
            .ok_or_else(|| StorageError::NotFound(run_id.into()))
    }
}

fn invalid<T>(message: &str) -> Result<T> {
    Err(StorageError::Invalid(message.into()))
}

fn require_run(connection: &Connection, id: &str, expected: u64) -> Result<RunRecord> {
    let run = get_run(connection, id)?.ok_or_else(|| StorageError::NotFound(id.into()))?;
    if run.revision != expected {
        return Err(StorageError::RevisionConflict {
            expected,
            actual: run.revision,
        });
    }
    Ok(run)
}

pub(crate) fn bound_plan(connection: &Connection, run_id: &str) -> Result<PlanRevision> {
    let payload: String = connection.query_row("SELECT p.payload FROM runs r JOIN plan_revisions p ON p.id=r.plan_id AND p.revision=r.plan_revision WHERE r.id=?1",[run_id],|r|r.get(0))
        .optional()?.ok_or_else(||StorageError::Invalid("workflow is not bound to a plan".into()))?;
    Ok(serde_json::from_str(&payload)?)
}

fn current_plan(tx: &Transaction<'_>, run_id: &str) -> Result<PlanRevision> {
    authorize_run(tx, run_id)?;
    let plan = bound_plan(tx, run_id)?;
    crate::writer::check_ticket_binding(tx, &plan)?;
    crate::writer::check_manifest_binding(tx, &plan)?;
    Ok(plan)
}

fn current_candidate(connection: &Connection, run_id: &str) -> Result<Option<CandidateEvidence>> {
    let hash: Option<String> = connection
        .query_row(
            "SELECT hash FROM candidates WHERE run_id=?1 ORDER BY revision DESC LIMIT 1",
            [run_id],
            |r| r.get(0),
        )
        .optional()?;
    hash.map(|hash| load_candidate(connection, &hash)?.ok_or(StorageError::NotFound(hash)))
        .transpose()
}

fn require_candidate(
    connection: &Connection,
    run_id: &str,
    hash: &str,
) -> Result<CandidateEvidence> {
    let candidate = current_candidate(connection, run_id)?
        .ok_or_else(|| StorageError::NotFound("workflow candidate".into()))?;
    if candidate.candidate.hash != hash {
        return invalid("candidate hash is stale; evidence for another revision cannot pass");
    }
    Ok(candidate)
}

fn load_candidate(connection: &Connection, hash: &str) -> Result<Option<CandidateEvidence>> {
    let payload: Option<String> = connection
        .query_row(
            "SELECT payload FROM candidates WHERE hash=?1",
            [hash],
            |r| r.get(0),
        )
        .optional()?;
    let Some(payload) = payload else {
        return Ok(None);
    };
    let mut evidence: CandidateEvidence = serde_json::from_str(&payload)?;
    let mut statement = connection.prepare("SELECT payload FROM candidate_check_results WHERE candidate_hash=?1 AND generation=?2 ORDER BY rowid")?;
    evidence.results = statement
        .query_map(params![hash, evidence.validation_generation], |r| {
            r.get::<_, String>(0)
        })?
        .map(|row| Ok(serde_json::from_str(&row?)?))
        .collect::<Result<Vec<_>>>()?;
    let review: Option<String> = connection
        .query_row(
            "SELECT payload FROM candidate_reviews WHERE candidate_hash=?1 AND generation=?2",
            params![hash, evidence.validation_generation],
            |r| r.get(0),
        )
        .optional()?;
    evidence.review = review
        .map(|value| serde_json::from_str(&value))
        .transpose()?;
    Ok(Some(evidence))
}

fn save_candidate(tx: &Transaction<'_>, evidence: &CandidateEvidence) -> Result<()> {
    let mut stored = evidence.clone();
    stored.results.clear();
    stored.review = None;
    tx.execute(
        "UPDATE candidates SET status=?1,payload=?2 WHERE hash=?3",
        params![
            serde_json::to_value(evidence.status)?
                .as_str()
                .unwrap_or("interrupted"),
            serde_json::to_string(&stored)?,
            evidence.candidate.hash
        ],
    )?;
    Ok(())
}

fn bump(
    tx: &Transaction<'_>,
    run: &RunRecord,
    kind: &str,
    payload: serde_json::Value,
) -> Result<()> {
    tx.execute(
        "UPDATE runs SET revision=revision+1,updated_at=?1 WHERE id=?2 AND revision=?3",
        params![now(), run.id, run.revision],
    )?;
    let mut payload = payload
        .as_object()
        .cloned()
        .ok_or_else(|| StorageError::Invalid("event payload must be object".into()))?;
    payload.insert("state".into(), serde_json::to_value(run.state)?);
    payload.insert("revision".into(), json!(run.revision + 1));
    append(tx, &run.id, kind, serde_json::Value::Object(payload))?;
    Ok(())
}

pub(crate) fn workflow_usage(connection: &Connection, run_id: &str) -> Result<BudgetUsage> {
    let mut usage = BudgetUsage {
        workers: 1,
        ..Default::default()
    };
    let mut statement = connection.prepare("SELECT payload FROM attempts WHERE run_id=?1")?;
    for value in statement.query_map([run_id], |r| r.get::<_, String>(0))? {
        let value: serde_json::Value = serde_json::from_str(&value?)?;
        usage.attempts = usage.attempts.saturating_add(1);
        let value = value.get("usage").unwrap_or(&value);
        usage.elapsed_seconds = usage.elapsed_seconds.saturating_add(
            value
                .get("elapsed_seconds")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
        );
        usage.cost_usd_micros = usage.cost_usd_micros.saturating_add(
            value
                .get("cost_usd_micros")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
        );
    }
    let mut statement = connection.prepare("SELECT payload FROM candidates WHERE run_id=?1")?;
    for value in statement.query_map([run_id], |r| r.get::<_, String>(0))? {
        let evidence: CandidateEvidence = serde_json::from_str(&value?)?;
        usage.elapsed_seconds = usage
            .elapsed_seconds
            .saturating_add(evidence.elapsed_seconds);
        usage.cost_usd_micros = usage
            .cost_usd_micros
            .saturating_add(evidence.cost_usd_micros);
    }
    Ok(usage)
}

fn repair_count(connection: &Connection, run_id: &str) -> Result<u64> {
    Ok(connection.query_row("SELECT COUNT(*) FROM events WHERE run_id=?1 AND json_extract(envelope,'$.type')='candidate.repair_started'",[run_id],|r|r.get(0))?)
}

fn cost_unreported(connection: &Connection, run_id: &str) -> Result<bool> {
    Ok(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM events WHERE run_id=?1 AND json_extract(envelope,'$.type')=?2)",
        params![run_id, COST_UNREPORTED_EVENT],
        |r| r.get(0),
    )?)
}

fn repair_gate(connection: &Connection, run_id: &str, hash: &str) -> Result<BudgetUsage> {
    let run = get_run(connection, run_id)?.ok_or_else(|| StorageError::NotFound(run_id.into()))?;
    if !matches!(
        run.state,
        RunState::Paused | RunState::Failed | RunState::TestingBlocked
    ) {
        return invalid("workflow is not awaiting candidate repair");
    }
    let evidence = require_candidate(connection, run_id, hash)?;
    if !matches!(
        evidence.status,
        CandidateStatus::Paused | CandidateStatus::Failed | CandidateStatus::TestingBlocked
    ) {
        return invalid("candidate is not repairable");
    }
    let plan = bound_plan(connection, run_id)?;
    // Repair of a multi-repository candidate set is re-planning (ADR 0017):
    // a repair writer in one repository cannot re-establish the other
    // repositories' bindings, so no single-repository fix stands for the set.
    if plan.base_commits.len() > 1 {
        return invalid(MULTI_REPOSITORY_REPAIR);
    }
    // Read the same immutable authorization/bindings without requiring a mutation.
    let approval: Option<String> = connection
        .query_row(
            "SELECT a.payload FROM runs r JOIN approvals a ON a.id=r.approval_id WHERE r.id=?1",
            [run_id],
            |r| r.get(0),
        )
        .optional()?;
    let approval: luuna_domain::Approval = serde_json::from_str(
        &approval
            .ok_or_else(|| StorageError::Invalid("repair requires durable approval".into()))?,
    )?;
    approval.authorize(&plan)?;
    let latest: u64 = connection.query_row(
        "SELECT MAX(revision) FROM plan_revisions WHERE id=?1",
        [&plan.id],
        |r| r.get(0),
    )?;
    let ticket_revision: u64 = connection.query_row(
        "SELECT revision FROM tickets WHERE id=?1",
        [&plan.ticket_id],
        |r| r.get(0),
    )?;
    let manifest_hash: Option<String> = connection.query_row(
        "SELECT manifest_hash FROM projects WHERE id=?1",
        [&plan.project_id],
        |r| r.get(0),
    )?;
    if latest != plan.revision
        || ticket_revision != plan.ticket_revision
        || manifest_hash.as_deref() != Some(&plan.manifest_hash)
    {
        return invalid("repair requires the current approved plan, ticket and manifest");
    }
    let manifest: String = connection.query_row(
        "SELECT payload FROM manifest_revisions WHERE project_id=?1 AND hash=?2",
        params![plan.project_id, plan.manifest_hash],
        |r| r.get(0),
    )?;
    let manifest: ProjectManifest = serde_json::from_str(&manifest)?;
    let mut usage = workflow_usage(connection, run_id)?;
    let repairs = repair_count(connection, run_id)?;
    if repairs >= u64::from(manifest.policy.max_task_repairs) {
        return Err(DomainError::BudgetExceeded(
            "max_task_repairs exhausted; re-plan required".into(),
        )
        .into());
    }
    usage.attempts = usage.attempts.saturating_add(1);
    require_headroom(&plan, usage)?;
    Ok(usage)
}

fn candidate_status(state: RunState) -> Result<CandidateStatus> {
    Ok(match state {
        RunState::Failed => CandidateStatus::Failed,
        RunState::TestingBlocked => CandidateStatus::TestingBlocked,
        RunState::Paused => CandidateStatus::Paused,
        RunState::Cancelled => CandidateStatus::Cancelled,
        RunState::Interrupted => CandidateStatus::Interrupted,
        _ => return invalid("unsupported candidate failure state"),
    })
}

pub(crate) fn interrupt_candidates(
    tx: &Transaction<'_>,
    skipped: &mut Vec<crate::SkippedRecord>,
) -> Result<()> {
    let mut statement = tx.prepare("SELECT c.hash FROM candidates c JOIN runs r ON r.id=c.run_id WHERE r.state=?1 AND c.status IN ('pending','validating','reviewing')")?;
    let hashes = statement
        .query_map([crate::state_json(RunState::Interrupted)?], |r| {
            r.get::<_, String>(0)
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(statement);
    for hash in hashes {
        let mut evidence = match load_candidate(tx, &hash) {
            Ok(Some(evidence)) => evidence,
            Ok(None) => return Err(StorageError::NotFound(hash.clone())),
            Err(StorageError::Json(error)) => {
                skipped.push(interrupt_undecodable_candidate(tx, &hash, &error)?);
                continue;
            }
            Err(error) => return Err(error),
        };
        let review = if evidence.status == CandidateStatus::Reviewing {
            Some(review_spend(tx, &evidence)?)
        } else {
            None
        };
        if let Some(started) = &evidence.stage_started_at {
            let elapsed = chrono::DateTime::parse_from_rfc3339(started)
                .map(|started| {
                    let now = chrono::Utc::now();
                    // A crash stops the stage's heartbeat, so time later than
                    // one interval past the last durable checkpoint was not
                    // spent on the stage: an outage is not charged as check or
                    // review time. A record without a checkpoint (written
                    // before heartbeats existed) is charged up to now.
                    let end = evidence
                        .stage_checkpoint_at
                        .as_deref()
                        .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
                        .and_then(|at| {
                            at.with_timezone(&chrono::Utc).checked_add_signed(
                                chrono::Duration::seconds(STAGE_HEARTBEAT_SECONDS as i64),
                            )
                        })
                        .map_or(now, |end| end.min(now));
                    (end - started.with_timezone(&chrono::Utc))
                        .num_seconds()
                        .max(0) as u64
                })
                .unwrap_or(u64::MAX);
            evidence.elapsed_seconds = evidence
                .elapsed_seconds
                .max(evidence.stage_start_elapsed_seconds.saturating_add(elapsed));
        }
        if review == Some(ReviewSpend::Unknown) {
            let plan = bound_plan(tx, &evidence.run_id)?;
            let usage = workflow_usage(tx, &evidence.run_id)?;
            evidence.cost_usd_micros = evidence.cost_usd_micros.saturating_add(
                plan.budgets
                    .cost_usd_micros
                    .saturating_sub(usage.cost_usd_micros),
            );
        }
        evidence.status = CandidateStatus::Interrupted;
        evidence.finished_at = Some(now());
        evidence.reason = Some(match review {
            Some(ReviewSpend::Unknown) => "runtime restarted during independent review; unreported provider spend reserved the remaining approved cost budget; re-plan required".into(),
            Some(ReviewSpend::NotPrompted) => "runtime restarted during independent review before the reviewer was prompted, so no provider spend occurred; elapsed time retained and fresh evidence required".into(),
            Some(ReviewSpend::Settled) => "runtime restarted after the independent reviewer reported its final usage; elapsed time retained and fresh evidence required".into(),
            None => "runtime restarted before candidate validation settled; elapsed time retained and fresh evidence required".into(),
        });
        evidence.stage_started_at = None;
        evidence.stage_checkpoint_at = None;
        save_candidate(tx, &evidence)?;
        append(
            tx,
            &evidence.run_id,
            "candidate.interrupted",
            json!({"candidate_hash":hash,"reason":evidence.reason}),
        )?;
    }
    Ok(())
}

/// A candidate record recovery cannot decode is still never resumable: its
/// status column becomes `interrupted` (the gates decode the record and fail
/// closed on it anyway). A payload that is not JSON at all trips the identity
/// trigger, so that candidate keeps its status and is only reported.
fn interrupt_undecodable_candidate(
    tx: &Transaction<'_>,
    hash: &str,
    error: &serde_json::Error,
) -> Result<crate::SkippedRecord> {
    let reason = format!(
        "runtime restarted before candidate validation settled; {}; fresh evidence and a new plan are required",
        crate::undecodable(error)
    );
    let run_id: String =
        tx.query_row("SELECT run_id FROM candidates WHERE hash=?1", [hash], |r| {
            r.get(0)
        })?;
    match tx.execute(
        "UPDATE candidates SET status='interrupted' WHERE hash=?1",
        [hash],
    ) {
        Ok(_) => {
            append(
                tx,
                &run_id,
                "candidate.interrupted",
                json!({"candidate_hash": hash, "reason": reason}),
            )?;
        }
        // Only the trigger's refusal is tolerated: an I/O or full-disk error
        // can end the transaction and must stop recovery.
        Err(rusqlite::Error::SqliteFailure(error, _))
            if matches!(
                error.code,
                rusqlite::ErrorCode::Unknown | rusqlite::ErrorCode::ConstraintViolation
            ) => {}
        Err(error) => return Err(error.into()),
    }
    Ok(crate::SkippedRecord {
        table: "candidates",
        id: hash.into(),
        reason,
    })
}

/// What an interrupted review may have spent at the provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReviewSpend {
    /// No reviewer of the current generation received its prompt: nothing
    /// could have been billed.
    NotPrompted,
    /// The prompted reviewer settled after its final usage was charged.
    Settled,
    /// A prompt was sent and the reviewer never settled, or the record
    /// predates the markers: the spend is unknown.
    Unknown,
}

/// Decides from durable markers, as the live path decides from its in-flight
/// flag, whether an interrupted review's provider spend is unknown. The
/// latest `review.started` names the reviewer; one recorded by a runtime that
/// wrote no markers (no `generation`) is treated as prompted and unsettled.
fn review_spend(connection: &Connection, evidence: &CandidateEvidence) -> Result<ReviewSpend> {
    let started: Option<String> = connection
        .query_row(
            "SELECT json_extract(envelope,'$.payload') FROM events WHERE run_id=?1 AND json_extract(envelope,'$.type')='review.started' AND json_extract(envelope,'$.payload.candidate_hash')=?2 ORDER BY sequence DESC LIMIT 1",
            params![evidence.run_id, evidence.candidate.hash],
            |r| r.get(0),
        )
        .optional()?;
    let Some(started) = started else {
        return Ok(ReviewSpend::NotPrompted);
    };
    let started: serde_json::Value = serde_json::from_str(&started)?;
    let Some(generation) = started["generation"].as_u64() else {
        return Ok(ReviewSpend::Unknown);
    };
    let session = started["reviewer_session"].as_str().unwrap_or_default();
    if generation != evidence.validation_generation || session.is_empty() {
        return Ok(ReviewSpend::NotPrompted);
    }
    let marked = |kind: &str| -> Result<bool> {
        Ok(connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE run_id=?1 AND json_extract(envelope,'$.type')=?2 AND json_extract(envelope,'$.payload.reviewer_session')=?3)",
            params![evidence.run_id, kind, session],
            |r| r.get(0),
        )?)
    };
    Ok(if !marked(REVIEW_PROMPT_SENT)? {
        ReviewSpend::NotPrompted
    } else if marked(REVIEW_USAGE_SETTLED)? {
        ReviewSpend::Settled
    } else {
        ReviewSpend::Unknown
    })
}

/// Raises the candidate's elapsed time to at least what its current stage has
/// actually taken (whole seconds, rounded up). The runtime is alive here, so
/// the stage ran until now; restart recovery instead stops at the stage's
/// last heartbeat plus one interval.
fn retain_live_elapsed(evidence: &mut CandidateEvidence) {
    let Some(started) = evidence
        .stage_started_at
        .as_deref()
        .and_then(|started| chrono::DateTime::parse_from_rfc3339(started).ok())
    else {
        return;
    };
    let millis = (chrono::Utc::now() - started.with_timezone(&chrono::Utc))
        .num_milliseconds()
        .max(0) as u64;
    let live = evidence
        .stage_start_elapsed_seconds
        .saturating_add(millis.div_ceil(1000));
    evidence.elapsed_seconds = evidence.elapsed_seconds.max(live);
}

/// A fresh generation without a new revision is only for a candidate whose
/// every required recipe passed in the current generation and whose review
/// never produced a verdict. Failed, blocked, missing or interrupted checks
/// and any recorded verdict (passed or not) keep the existing paths: repair
/// for a new revision, or nothing.
fn require_unreviewed_passed_checks(
    plan: &PlanRevision,
    evidence: &CandidateEvidence,
) -> Result<()> {
    if evidence.content_drift {
        return invalid(
            "candidate content drifted from the frozen candidate; repair it in a fresh worktree or re-plan",
        );
    }
    if evidence.review.is_some() {
        return invalid("candidate already has a recorded review verdict");
    }
    let all_passed = plan
        .required_checks
        .iter()
        .filter(|recipe| recipe.required)
        .all(|recipe| {
            evidence.results.iter().any(|result| {
                result.recipe_id == recipe.id
                    && result.repository_id == recipe.repository_id
                    && result.status == CheckStatus::Passed
            })
        });
    if !all_passed {
        return invalid(
            "fresh validation requires every required check to have passed in the current generation; repair the candidate instead",
        );
    }
    Ok(())
}

/// The single admission gate for a validation generation: a pending or
/// interrupted candidate, or a failed one that qualifies for re-validation in
/// place (ADR 0009 point 7), under the current approval, ticket and manifest
/// binding and with budget headroom. Returns whether it is a re-validation.
fn validation_gate(
    tx: &Transaction<'_>,
    run: &RunRecord,
    evidence: &CandidateEvidence,
) -> Result<bool> {
    let revalidation = match (run.state, evidence.status) {
        (RunState::Validating, CandidateStatus::Pending)
        | (RunState::Interrupted, CandidateStatus::Interrupted) => false,
        (RunState::Failed, CandidateStatus::Failed) => true,
        _ => {
            return invalid("candidate validation is already active or cannot be resumed");
        }
    };
    let plan = current_plan(tx, &run.id)?;
    if revalidation {
        require_unreviewed_passed_checks(&plan, evidence)?;
    }
    require_headroom(&plan, workflow_usage(tx, &run.id)?)?;
    Ok(revalidation)
}

fn require_headroom(plan: &PlanRevision, usage: BudgetUsage) -> Result<()> {
    plan.budgets.check(usage)?;
    if usage.elapsed_seconds >= plan.budgets.timeout_seconds
        || usage.cost_usd_micros >= plan.budgets.cost_usd_micros
    {
        return Err(DomainError::BudgetExceeded(
            "workflow time or cost budget exhausted; re-plan required".into(),
        )
        .into());
    }
    Ok(())
}
