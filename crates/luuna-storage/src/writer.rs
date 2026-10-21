//! Tickets, plan workflows, worktree leases and attempts (M2c).
//!
//! Legacy tickets are the explicitly temporary local source from ADR 0003;
//! enabled Missions tickets are revision-aware projections with durable delivery
//! intent. A plan workflow binds a
//! run to one immutable plan revision that names the ticket revision, manifest
//! hash and base commits it was planned against. A lease records Luuna's
//! ownership of one detached worktree; at most one lease per repository is
//! active, which is how a second writer is refused. Attempts count against the
//! plan's budget and are interrupted, never completed, by a restart.
use crate::{
    append, append_project_event, now, transition, undecodable, Result, SkippedRecord,
    StorageError, Store,
};
use luuna_domain::{
    AttemptState, DomainError, LeaseState, PlanRevision, RunState, Ticket, WorktreeLease,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttemptRecord {
    pub id: String,
    pub run_id: String,
    pub task_id: String,
    pub number: u32,
    pub state: AttemptState,
    pub payload: Value,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
}

fn text<T: Serialize>(value: T) -> Result<String> {
    Ok(serde_json::to_value(value)?
        .as_str()
        .unwrap_or_default()
        .to_owned())
}

impl Store {
    /// Reserve a ticket projection (or legacy local ticket). The same project and idempotency key
    /// returns the existing record; the same key with different content is a conflict.
    pub fn create_ticket(
        &mut self,
        ticket: &Ticket,
        idempotency_key: &str,
    ) -> Result<(Ticket, bool)> {
        ticket.validate()?;
        if idempotency_key.trim().is_empty() || idempotency_key.len() > 200 {
            return Err(StorageError::Invalid(
                "an idempotency key of 1..200 bytes is required".into(),
            ));
        }
        if ticket.revision != 1 {
            return Err(StorageError::Invalid(
                "a new ticket starts at revision 1".into(),
            ));
        }
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        crate::projects::get_project_in(&tx, &ticket.project_id)?
            .ok_or_else(|| StorageError::NotFound(ticket.project_id.clone()))?;
        let registered: Vec<String> = crate::projects::repositories_in(&tx, &ticket.project_id)?
            .into_iter()
            .map(|r| r.repository_id)
            .collect();
        if let Some(unknown) = ticket
            .repository_ids
            .iter()
            .find(|id| !registered.contains(id))
        {
            return Err(StorageError::Invalid(format!(
                "repository {unknown} is not registered in project {}",
                ticket.project_id
            )));
        }
        if let Some(existing) = ticket_by_key(&tx, &ticket.project_id, idempotency_key)? {
            let original = crate::missions::binding_in(&tx, &existing.id)?
                .map(|binding| binding.original)
                .unwrap_or_else(|| existing.clone());
            let same = original.title == ticket.title
                && original.intent == ticket.intent
                && original.acceptance_criteria == ticket.acceptance_criteria
                && original.repository_ids == ticket.repository_ids;
            if !same {
                return Err(StorageError::AlreadyExists(format!(
                    "idempotency key {idempotency_key} was already used for different ticket content"
                )));
            }
            return Ok((existing, false));
        }
        let count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM tickets WHERE project_id=?1",
            [&ticket.project_id],
            |row| row.get(0),
        )?;
        if count >= 1000 {
            return Err(StorageError::Invalid(
                "ticket limit reached for this project".into(),
            ));
        }
        if load_ticket(&tx, &ticket.id)?.is_some() {
            return Err(StorageError::AlreadyExists(ticket.id.clone()));
        }
        tx.execute(
            "INSERT INTO tickets(id,project_id,revision,idempotency_key,payload,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![
                ticket.id,
                ticket.project_id,
                ticket.revision,
                idempotency_key,
                serde_json::to_string(ticket)?,
                ticket.created_at,
                ticket.updated_at
            ],
        )?;
        append_project_event(
            &tx,
            &ticket.project_id,
            "ticket.created",
            json!({"ticket_id": ticket.id, "revision": ticket.revision, "source": ticket.source, "title": ticket.title, "repository_ids": ticket.repository_ids}),
        )?;
        tx.commit()?;
        Ok((ticket.clone(), true))
    }

    /// Revise the local ticket's intent. Plans bound to the previous revision are
    /// stale from this point and scheduling refuses them until re-planned.
    pub fn update_ticket(
        &mut self,
        ticket_id: &str,
        expected_revision: u64,
        title: &str,
        intent: &str,
        acceptance_criteria: &[String],
    ) -> Result<Ticket> {
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut ticket =
            load_ticket(&tx, ticket_id)?.ok_or_else(|| StorageError::NotFound(ticket_id.into()))?;
        if ticket.source == luuna_domain::TicketSource::Missions {
            return Err(StorageError::Invalid(
                "Missions owns ticket intent; reconcile the source instead of writing SQLite"
                    .into(),
            ));
        }
        if ticket.revision != expected_revision {
            return Err(StorageError::RevisionConflict {
                expected: expected_revision,
                actual: ticket.revision,
            });
        }
        ticket.revision += 1;
        ticket.title = title.to_owned();
        ticket.intent = intent.to_owned();
        ticket.acceptance_criteria = acceptance_criteria.to_vec();
        ticket.updated_at = now();
        ticket.validate()?;
        tx.execute(
            "UPDATE tickets SET revision=?1,payload=?2,updated_at=?3 WHERE id=?4 AND revision=?5",
            params![
                ticket.revision,
                serde_json::to_string(&ticket)?,
                ticket.updated_at,
                ticket.id,
                expected_revision
            ],
        )?;
        append_project_event(
            &tx,
            &ticket.project_id,
            "ticket.revised",
            json!({"ticket_id": ticket.id, "revision": ticket.revision}),
        )?;
        tx.commit()?;
        Ok(ticket)
    }

    pub fn get_ticket(&self, id: &str) -> Result<Option<Ticket>> {
        load_ticket(&self.connection, id)
    }

    pub fn tickets(&self, project_id: &str) -> Result<Vec<Ticket>> {
        let mut statement = self.connection.prepare(
            "SELECT payload FROM tickets WHERE project_id=?1 ORDER BY created_at, rowid",
        )?;
        let rows = statement.query_map([project_id], |r| r.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    /// Persist a new plan revision and open the workflow run that carries it,
    /// already bound and `plan_ready`, in one transaction. The plan must name
    /// the ticket's current revision, the project's current manifest hash and
    /// that manifest's recorded base commits.
    pub fn open_plan_workflow(
        &mut self,
        run_id: &str,
        plan: &PlanRevision,
    ) -> Result<crate::RunRecord> {
        plan.validate()?;
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let ticket = load_ticket(&tx, &plan.ticket_id)?
            .ok_or_else(|| StorageError::NotFound(plan.ticket_id.clone()))?;
        if ticket.project_id != plan.project_id {
            return Err(StorageError::Invalid(
                "plan project does not match the ticket's project".into(),
            ));
        }
        if ticket.revision != plan.ticket_revision {
            return Err(StorageError::RevisionConflict {
                expected: ticket.revision,
                actual: plan.ticket_revision,
            });
        }
        if let Some(unknown) = plan
            .base_commits
            .keys()
            .find(|id| !ticket.repository_ids.contains(id))
        {
            return Err(StorageError::Invalid(format!(
                "repository {unknown} is outside the ticket's repositories"
            )));
        }
        check_manifest_binding(&tx, plan)?;
        let current: u64 = tx.query_row(
            "SELECT COALESCE(MAX(revision),0) FROM plan_revisions WHERE id=?1",
            [&plan.id],
            |row| row.get(0),
        )?;
        if plan.revision != current + 1 {
            return Err(StorageError::RevisionConflict {
                expected: current + 1,
                actual: plan.revision,
            });
        }
        tx.execute(
            "INSERT INTO plan_revisions(id,revision,hash,payload) VALUES (?1,?2,?3,?4)",
            params![
                plan.id,
                plan.revision,
                plan.hash,
                serde_json::to_string(plan)?
            ],
        )?;
        let created_at = now();
        let metadata = json!({"kind": "workflow", "ticket_id": plan.ticket_id, "ticket_revision": plan.ticket_revision, "plan_id": plan.id, "plan_revision": plan.revision});
        tx.execute(
            "INSERT INTO runs(id,project_id,state,revision,metadata,created_at,updated_at,plan_id,plan_revision) VALUES (?1,?2,?3,1,?4,?5,?5,?6,?7)",
            params![
                run_id,
                plan.project_id,
                crate::state_json(RunState::Discovered)?,
                serde_json::to_string(&metadata)?,
                created_at,
                plan.id,
                plan.revision
            ],
        )?;
        append(
            &tx,
            run_id,
            "run.created",
            json!({"state": RunState::Discovered}),
        )?;
        transition(
            &tx,
            run_id,
            1,
            RunState::Exploring,
            "run.exploring",
            json!({"ticket_id": plan.ticket_id, "ticket_revision": plan.ticket_revision}),
        )?;
        transition(
            &tx,
            run_id,
            2,
            RunState::PlanReady,
            "plan.ready",
            json!({"plan_id": plan.id, "plan_revision": plan.revision, "plan_hash": plan.hash}),
        )?;
        append_project_event(
            &tx,
            &plan.project_id,
            "plan.recorded",
            json!({"run_id": run_id, "ticket_id": plan.ticket_id, "ticket_revision": plan.ticket_revision, "plan_id": plan.id, "plan_revision": plan.revision, "plan_hash": plan.hash}),
        )?;
        tx.commit()?;
        self.get_run(run_id)?
            .ok_or_else(|| StorageError::NotFound(run_id.into()))
    }

    pub fn latest_plan(&self, plan_id: &str) -> Result<Option<PlanRevision>> {
        let payload: Option<String> = self
            .connection
            .query_row(
                "SELECT payload FROM plan_revisions WHERE id=?1 ORDER BY revision DESC LIMIT 1",
                [plan_id],
                |r| r.get(0),
            )
            .optional()?;
        payload
            .map(|value| serde_json::from_str(&value).map_err(Into::into))
            .transpose()
    }

    pub fn plans_for_ticket(&self, ticket_id: &str) -> Result<Vec<PlanRevision>> {
        let mut statement = self.connection.prepare(
            "SELECT payload FROM plan_revisions WHERE json_extract(payload,'$.ticket_id')=?1 ORDER BY id, revision",
        )?;
        let rows = statement.query_map([ticket_id], |r| r.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    /// The workflow run bound to one plan revision (the latest recorded).
    pub fn run_for_plan(&self, plan_id: &str, revision: u64) -> Result<Option<crate::RunRecord>> {
        let id: Option<String> = self
            .connection
            .query_row(
                "SELECT id FROM runs WHERE plan_id=?1 AND plan_revision=?2 ORDER BY rowid DESC LIMIT 1",
                params![plan_id, revision],
                |r| r.get(0),
            )
            .optional()?;
        id.map(|id| self.get_run(&id))
            .transpose()
            .map(Option::flatten)
    }

    /// Record Luuna's ownership of a worktree. A second active lease on the same
    /// repository is refused by the database, whatever the caller believed.
    pub fn acquire_worktree_lease(&mut self, lease: &WorktreeLease) -> Result<()> {
        lease.validate()?;
        if lease.state != LeaseState::Active {
            return Err(StorageError::Invalid("a new lease must be active".into()));
        }
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let run = crate::get_run(&tx, &lease.run_id)?
            .ok_or_else(|| StorageError::NotFound(lease.run_id.clone()))?;
        if run.state != RunState::Implementing {
            return Err(StorageError::Invalid(format!(
                "run {} is {:?}, not implementing",
                run.id, run.state
            )));
        }
        let inserted = tx.execute(
            "INSERT INTO worktree_leases(id,run_id,project_id,repository_id,path,base_commit,state,payload,created_at) VALUES (?1,?2,?3,?4,?5,?6,'active',?7,?8)",
            params![
                lease.id,
                lease.run_id,
                lease.project_id,
                lease.repository_id,
                lease.path,
                lease.base_commit,
                serde_json::to_string(lease)?,
                lease.created_at
            ],
        );
        match inserted {
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(error, _))
                if error.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                return Err(StorageError::AlreadyExists(format!(
                    "repository {} already has an active worktree lease or this path is leased",
                    lease.repository_id
                )));
            }
            Err(error) => return Err(error.into()),
        }
        append(
            &tx,
            &lease.run_id,
            "worktree.leased",
            json!({"lease_id": lease.id, "repository_id": lease.repository_id, "path": lease.path, "base_commit": lease.base_commit}),
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn release_worktree_lease(
        &mut self,
        lease_id: &str,
        state: LeaseState,
        candidate_commit: Option<&str>,
        reason: Option<&str>,
    ) -> Result<WorktreeLease> {
        if state == LeaseState::Active {
            return Err(StorageError::Invalid(
                "release needs a settled state".into(),
            ));
        }
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut lease =
            load_lease(&tx, lease_id)?.ok_or_else(|| StorageError::NotFound(lease_id.into()))?;
        if lease.state != LeaseState::Active {
            return Err(StorageError::Invalid("lease is already settled".into()));
        }
        lease.state = state;
        lease.candidate_commit = candidate_commit.map(ToOwned::to_owned);
        lease.reason = reason.map(ToOwned::to_owned);
        lease.released_at = Some(now());
        lease.validate()?;
        tx.execute(
            "UPDATE worktree_leases SET state=?1,payload=?2,released_at=?3 WHERE id=?4",
            params![
                text(state)?,
                serde_json::to_string(&lease)?,
                lease.released_at,
                lease_id
            ],
        )?;
        append(
            &tx,
            &lease.run_id,
            "worktree.released",
            json!({"lease_id": lease.id, "repository_id": lease.repository_id, "state": state, "candidate_commit": candidate_commit, "reason": reason}),
        )?;
        tx.commit()?;
        Ok(lease)
    }

    pub fn worktree_leases(&self, run_id: &str) -> Result<Vec<WorktreeLease>> {
        let mut statement = self.connection.prepare(
            "SELECT payload FROM worktree_leases WHERE run_id=?1 ORDER BY created_at, rowid",
        )?;
        let rows = statement.query_map([run_id], |r| r.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    pub fn active_worktree_leases(&self) -> Result<Vec<WorktreeLease>> {
        let mut statement = self.connection.prepare(
            "SELECT payload FROM worktree_leases WHERE state='active' ORDER BY created_at",
        )?;
        let rows = statement.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    /// Open the next attempt for a task; the plan's `max_attempts` is enforced here.
    pub fn start_attempt(
        &mut self,
        id: &str,
        run_id: &str,
        task_id: &str,
        max_attempts: u32,
        payload: Value,
    ) -> Result<AttemptRecord> {
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let previous: u32 = tx.query_row(
            "SELECT COUNT(*) FROM attempts WHERE run_id=?1",
            [run_id],
            |r| r.get(0),
        )?;
        let number = previous + 1;
        if number > max_attempts {
            return Err(StorageError::Domain(DomainError::BudgetExceeded(format!(
                "attempt {number} exceeds max_attempts {max_attempts}"
            ))));
        }
        let running: u32 = tx.query_row(
            "SELECT COUNT(*) FROM attempts WHERE run_id=?1 AND state='running'",
            [run_id],
            |r| r.get(0),
        )?;
        if running > 0 {
            return Err(StorageError::AlreadyExists(
                "an attempt is already running for this run".into(),
            ));
        }
        let record = AttemptRecord {
            id: id.into(),
            run_id: run_id.into(),
            task_id: task_id.into(),
            number,
            state: AttemptState::Running,
            payload,
            started_at: now(),
            finished_at: None,
        };
        tx.execute(
            "INSERT INTO attempts(id,run_id,task_id,number,state,payload,started_at) VALUES (?1,?2,?3,?4,'running',?5,?6)",
            params![
                record.id,
                record.run_id,
                record.task_id,
                record.number,
                serde_json::to_string(&record.payload)?,
                record.started_at
            ],
        )?;
        append(
            &tx,
            run_id,
            "attempt.started",
            json!({"attempt_id": id, "task_id": task_id, "number": number, "max_attempts": max_attempts}),
        )?;
        tx.commit()?;
        Ok(record)
    }

    pub fn finish_attempt(
        &mut self,
        id: &str,
        state: AttemptState,
        payload: Value,
    ) -> Result<AttemptRecord> {
        if !state.is_terminal() {
            return Err(StorageError::Invalid(
                "a finished attempt needs a terminal state".into(),
            ));
        }
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut record = load_attempt(&tx, id)?.ok_or_else(|| StorageError::NotFound(id.into()))?;
        if record.state != AttemptState::Running {
            return Err(StorageError::Invalid("attempt is already settled".into()));
        }
        record.state = state;
        record.payload = payload;
        record.finished_at = Some(now());
        tx.execute(
            "UPDATE attempts SET state=?1,payload=?2,finished_at=?3 WHERE id=?4",
            params![
                text(state)?,
                serde_json::to_string(&record.payload)?,
                record.finished_at,
                id
            ],
        )?;
        append(
            &tx,
            &record.run_id,
            "attempt.finished",
            json!({"attempt_id": id, "task_id": record.task_id, "number": record.number, "state": state, "payload": record.payload}),
        )?;
        tx.commit()?;
        Ok(record)
    }

    pub fn attempts(&self, run_id: &str) -> Result<Vec<AttemptRecord>> {
        let mut statement = self
            .connection
            .prepare("SELECT id FROM attempts WHERE run_id=?1 ORDER BY number")?;
        let ids = statement
            .query_map([run_id], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        ids.into_iter()
            .map(|id| load_attempt(&self.connection, &id)?.ok_or(StorageError::NotFound(id)))
            .collect()
    }
}

/// The plan must bind to the project's current confirmed manifest and that
/// manifest's recorded base commits for every repository in scope.
pub(crate) fn check_manifest_binding(tx: &Transaction<'_>, plan: &PlanRevision) -> Result<()> {
    let current: Option<String> = tx
        .query_row(
            "SELECT manifest_hash FROM projects WHERE id=?1",
            [&plan.project_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    if current.as_deref() != Some(plan.manifest_hash.as_str()) {
        return Err(StorageError::Domain(DomainError::BaselineRequired(
            "plan is bound to a manifest that is not the project's current confirmed manifest"
                .into(),
        )));
    }
    let recorded: Option<String> = tx
        .query_row(
            "SELECT base_commits FROM manifest_revisions WHERE project_id=?1 AND hash=?2 ORDER BY revision DESC LIMIT 1",
            params![plan.project_id, plan.manifest_hash],
            |r| r.get(0),
        )
        .optional()?;
    let recorded: BTreeMap<String, String> = recorded
        .map(|value| serde_json::from_str(&value))
        .transpose()?
        .unwrap_or_default();
    for (repository_id, commit) in &plan.base_commits {
        if recorded.get(repository_id) != Some(commit) {
            return Err(StorageError::Domain(DomainError::BaselineRequired(
                format!(
                "plan base commit for {repository_id} is not the base the current manifest recorded"
            ),
            )));
        }
    }
    Ok(())
}

/// The ticket a plan names must still be at the revision it was planned against.
pub(crate) fn check_ticket_binding(tx: &Transaction<'_>, plan: &PlanRevision) -> Result<()> {
    let ticket = load_ticket(tx, &plan.ticket_id)?
        .ok_or_else(|| StorageError::NotFound(plan.ticket_id.clone()))?;
    if ticket.project_id != plan.project_id || ticket.revision != plan.ticket_revision {
        return Err(StorageError::Domain(DomainError::BaselineRequired(
            format!(
            "ticket {} is at revision {}, plan was made for revision {}; re-plan before scheduling",
            ticket.id, ticket.revision, plan.ticket_revision
        ),
        )));
    }
    Ok(())
}

/// Startup recovery, after active runs were interrupted in the same
/// transaction. No writer runs before the runtime accepts work, so every lease
/// still active is orphaned whatever its run's state (including a run that
/// settled while its lease release failed, which would otherwise wedge the
/// repository): it is abandoned with its files preserved. Every running
/// attempt is interrupted. The worktree is not read here, so the reason says a
/// commit may exist in it unrecorded; such a commit is never a candidate.
pub(crate) fn abandon_orphaned_work(
    tx: &Transaction<'_>,
    skipped: &mut Vec<SkippedRecord>,
) -> Result<usize> {
    const LEASE_REASON: &str = "runtime restarted while the lease was active; files preserved, and a commit the writer made before the restart may exist in the worktree unrecorded (it is never a candidate); attempt evidence void";
    let mut statement = tx.prepare(
        "SELECT id,run_id,repository_id FROM worktree_leases WHERE state='active' ORDER BY rowid",
    )?;
    let leases = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(statement);
    let released_at = now();
    for (id, run_id, repository_id) in &leases {
        let mut lease = match load_lease(tx, id) {
            Ok(Some(lease)) => lease,
            Ok(None) => return Err(StorageError::NotFound(id.clone())),
            Err(StorageError::Json(error)) => {
                // The state column alone frees the repository's lease slot.
                let reason = format!("{LEASE_REASON}; {}", undecodable(&error));
                tx.execute(
                    "UPDATE worktree_leases SET state='abandoned',released_at=?1 WHERE id=?2",
                    params![released_at, id],
                )?;
                append(
                    tx,
                    run_id,
                    "worktree.released",
                    json!({"lease_id": id, "repository_id": repository_id, "state": LeaseState::Abandoned, "reason": reason}),
                )?;
                skipped.push(SkippedRecord {
                    table: "worktree_leases",
                    id: id.clone(),
                    reason,
                });
                continue;
            }
            Err(error) => return Err(error),
        };
        lease.state = LeaseState::Abandoned;
        lease.reason = Some(LEASE_REASON.into());
        lease.released_at = Some(released_at.clone());
        tx.execute(
            "UPDATE worktree_leases SET state='abandoned',payload=?1,released_at=?2 WHERE id=?3",
            params![serde_json::to_string(&lease)?, released_at, id],
        )?;
        append(
            tx,
            &lease.run_id,
            "worktree.released",
            json!({"lease_id": lease.id, "repository_id": lease.repository_id, "state": LeaseState::Abandoned, "reason": lease.reason}),
        )?;
    }
    let mut statement = tx.prepare(
        "SELECT id,run_id,task_id,number,payload FROM attempts WHERE state='running' ORDER BY rowid",
    )?;
    let attempts = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, u32>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(statement);
    for (id, run_id, task_id, number, payload) in &attempts {
        let previous = match serde_json::from_str::<Value>(payload) {
            Ok(previous) => Some(previous),
            Err(error) => {
                skipped.push(SkippedRecord {
                    table: "attempts",
                    id: id.clone(),
                    reason: format!(
                        "{}; interrupted and charged as if it reported no usage",
                        undecodable(&error)
                    ),
                });
                None
            }
        };
        let usage = reserved_usage(tx, run_id, previous.as_ref());
        let payload = json!({"reason": "runtime restarted before the writer settled; unreported time and provider spend reserve the remaining approved budgets; re-plan required", "usage": usage});
        tx.execute(
            "UPDATE attempts SET state='interrupted',payload=?1,finished_at=?2 WHERE id=?3",
            params![serde_json::to_string(&payload)?, released_at, id],
        )?;
        append(
            tx,
            run_id,
            "attempt.finished",
            json!({"attempt_id": id, "task_id": task_id, "number": number, "state": AttemptState::Interrupted, "payload": payload}),
        )?;
    }
    Ok(leases.len() + attempts.len())
}

/// An attempt lost to a restart reported neither its final time nor its
/// provider spend: they reserve the remaining approved budgets. Usage that
/// cannot be read reserves the full budgets, never less.
fn reserved_usage(tx: &Transaction<'_>, run_id: &str, previous: Option<&Value>) -> Value {
    let Ok(plan) = crate::validation::bound_plan(tx, run_id) else {
        return json!({});
    };
    let previous = previous.map(|value| value.get("usage").unwrap_or(value));
    let reported = |field: &str| {
        previous
            .and_then(|value| value.get(field))
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    let (elapsed, cost) = crate::validation::workflow_usage(tx, run_id)
        .map(|used| (used.elapsed_seconds, used.cost_usd_micros))
        .unwrap_or((0, 0));
    json!({"elapsed_seconds": reported("elapsed_seconds").saturating_add(plan.budgets.timeout_seconds.saturating_sub(elapsed)),
        "cost_usd_micros": reported("cost_usd_micros").saturating_add(plan.budgets.cost_usd_micros.saturating_sub(cost))})
}

fn load_ticket(connection: &Connection, id: &str) -> Result<Option<Ticket>> {
    let payload: Option<String> = connection
        .query_row("SELECT payload FROM tickets WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .optional()?;
    payload
        .map(|value| serde_json::from_str(&value).map_err(Into::into))
        .transpose()
}

fn ticket_by_key(connection: &Connection, project_id: &str, key: &str) -> Result<Option<Ticket>> {
    let payload: Option<String> = connection
        .query_row(
            "SELECT payload FROM tickets WHERE project_id=?1 AND idempotency_key=?2",
            params![project_id, key],
            |r| r.get(0),
        )
        .optional()?;
    payload
        .map(|value| serde_json::from_str(&value).map_err(Into::into))
        .transpose()
}

fn load_lease(connection: &Connection, id: &str) -> Result<Option<WorktreeLease>> {
    let payload: Option<String> = connection
        .query_row(
            "SELECT payload FROM worktree_leases WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    payload
        .map(|value| serde_json::from_str(&value).map_err(Into::into))
        .transpose()
}

fn load_attempt(connection: &Connection, id: &str) -> Result<Option<AttemptRecord>> {
    let row = connection
        .query_row(
            "SELECT run_id,task_id,number,state,payload,started_at,finished_at FROM attempts WHERE id=?1",
            [id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, u32>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .optional()?;
    row.map(
        |(run_id, task_id, number, state, payload, started_at, finished_at)| {
            Ok(AttemptRecord {
                id: id.into(),
                run_id,
                task_id,
                number,
                state: serde_json::from_value(Value::String(state))?,
                payload: serde_json::from_str(&payload)?,
                started_at,
                finished_at,
            })
        },
    )
    .transpose()
}
