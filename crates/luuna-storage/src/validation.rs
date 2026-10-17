//! Transactional candidate identity, command evidence, review and repair gates.
use crate::{
    append, authorize_run, get_run, now, transition, Result, RunRecord, StorageError, Store,
};
use luuna_domain::{
    BudgetUsage, CandidateEvidence, CandidateSet, CandidateStatus, CheckResult, CheckStatus,
    DomainError, PlanRevision, ProjectManifest, ReviewResult, ReviewVerdict, RunState,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde_json::json;
use std::collections::BTreeMap;

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
            started_at: now(),
            finished_at: None,
            reason: None,
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
        if !matches!(
            (run.state, evidence.status),
            (RunState::Validating, CandidateStatus::Pending)
                | (RunState::Interrupted, CandidateStatus::Interrupted)
        ) {
            return invalid("candidate validation is already active or cannot be resumed");
        }
        let plan = current_plan(&tx, run_id)?;
        require_headroom(&plan, workflow_usage(&tx, run_id)?)?;
        evidence.validation_generation += 1;
        evidence.results.clear();
        evidence.review = None;
        evidence.status = CandidateStatus::Validating;
        evidence.finished_at = None;
        evidence.reason = None;
        evidence.stage_started_at = Some(now());
        evidence.stage_start_elapsed_seconds = evidence.elapsed_seconds;
        save_candidate(&tx, &evidence)?;
        if run.state == RunState::Interrupted {
            transition(
                &tx,
                run_id,
                expected_revision,
                RunState::Validating,
                "candidate.validation_started",
                json!({"candidate_hash":hash,"generation":evidence.validation_generation}),
            )?;
        } else {
            bump(
                &tx,
                &run,
                "candidate.validation_started",
                json!({"candidate_hash":hash,"generation":evidence.validation_generation}),
            )?;
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
        tx.execute("INSERT INTO candidate_check_results(id,candidate_hash,generation,recipe_id,payload) VALUES (?1,?2,?3,?4,?5)",
            params![result.id,hash,evidence.validation_generation,result.recipe_id,serde_json::to_string(result)?])?;
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
                Some("required candidate checks could not run meaningfully"),
            )
        } else if statuses.contains(&Some(CheckStatus::Failed)) {
            (
                RunState::Failed,
                CandidateStatus::Failed,
                Some("required candidate checks failed"),
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
        current_plan(&tx, run_id)?;
        review.validate_for(&evidence.candidate, &evidence.implementer_session)?;
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
        save_candidate(&tx, &evidence)?;
        if run.state == RunState::Paused && next == RunState::Paused {
            bump(
                &tx,
                &run,
                "candidate.stage_failed",
                json!({"candidate_hash":hash,"reason":reason}),
            )?;
        } else {
            transition(
                &tx,
                run_id,
                expected_revision,
                next,
                "candidate.stage_failed",
                json!({"candidate_hash":hash,"reason":reason}),
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
        evidence.elapsed_seconds = evidence.elapsed_seconds.saturating_add(elapsed_seconds);
        evidence.cost_usd_micros = evidence.cost_usd_micros.saturating_add(cost_usd_micros);
        save_candidate(&tx, &evidence)?;
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
        append(
            &tx,
            run_id,
            "candidate.usage",
            json!({"candidate_hash":hash,"usage":usage}),
        )?;
        tx.commit()?;
        Ok(usage)
    }

    pub fn can_candidate_repair(&self, run_id: &str, hash: &str) -> Result<()> {
        repair_gate(&self.connection, run_id, hash).map(|_| ())
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
        for repository_id in plan.base_commits.keys() {
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
    let repairs: u64 = connection.query_row("SELECT COUNT(*) FROM events WHERE run_id=?1 AND json_extract(envelope,'$.type')='candidate.repair_started'",[run_id],|r|r.get(0))?;
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

pub(crate) fn interrupt_candidates(tx: &Transaction<'_>) -> Result<()> {
    let mut statement = tx.prepare("SELECT c.hash FROM candidates c JOIN runs r ON r.id=c.run_id WHERE r.state=?1 AND c.status IN ('pending','validating','reviewing')")?;
    let hashes = statement
        .query_map([crate::state_json(RunState::Interrupted)?], |r| {
            r.get::<_, String>(0)
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(statement);
    for hash in hashes {
        let mut evidence =
            load_candidate(tx, &hash)?.ok_or_else(|| StorageError::NotFound(hash.clone()))?;
        let was_reviewing = evidence.status == CandidateStatus::Reviewing;
        if let Some(started) = &evidence.stage_started_at {
            let elapsed = chrono::DateTime::parse_from_rfc3339(started)
                .map(|started| {
                    (chrono::Utc::now() - started.with_timezone(&chrono::Utc))
                        .num_seconds()
                        .max(0) as u64
                })
                .unwrap_or(u64::MAX);
            evidence.elapsed_seconds = evidence
                .elapsed_seconds
                .max(evidence.stage_start_elapsed_seconds.saturating_add(elapsed));
        }
        if was_reviewing {
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
        evidence.reason = Some(if was_reviewing {
            "runtime restarted during independent review; unreported provider spend reserved the remaining approved cost budget; re-plan required".into()
        } else {
            "runtime restarted before candidate validation settled; elapsed time retained and fresh evidence required".into()
        });
        evidence.stage_started_at = None;
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
