//! SQLite authority for local state and its durable event stream.
use chrono::{SecondsFormat, Utc};
use luuna_domain::{Approval, DomainError, EventEnvelope, PlanRevision, RunState, SCHEMA_VERSION};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::Path, time::Duration};
use thiserror::Error;

mod baselines;
mod projects;
pub use projects::*;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("SQLite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("filesystem: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Domain(#[from] DomainError),
    #[error("record not found: {0}")]
    NotFound(String),
    #[error("revision conflict: expected {expected}, current {actual}")]
    RevisionConflict { expected: u64, actual: u64 },
    #[error("plan revision already exists and is immutable")]
    ImmutableRevision,
    #[error("record already exists: {0}")]
    AlreadyExists(String),
    #[error("invalid input: {0}")]
    Invalid(String),
}

pub type Result<T> = std::result::Result<T, StorageError>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RunRecord {
    pub id: String,
    pub project_id: String,
    pub state: RunState,
    pub revision: u64,
    pub metadata: Value,
    pub created_at: String,
    pub updated_at: String,
}

pub struct Store {
    connection: Connection,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if path != Path::new(":memory:") {
            if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
                let mut builder = fs::DirBuilder::new();
                builder.recursive(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::DirBuilderExt;
                    builder.mode(0o700);
                }
                builder.create(parent)?;
            }
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            match options.open(path) {
                Ok(_) => (),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
                Err(e) => return Err(e.into()),
            }
        }
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
        )?;
        connection.execute_batch(MIGRATION_1)?;
        connection.execute_batch(MIGRATION_2)?;
        connection.execute_batch(MIGRATION_3)?;
        Ok(Self { connection })
    }

    /// A run is one owned Pi attempt in M1. Metadata is descriptive, never authority.
    pub fn create_run(&mut self, id: &str, project_id: &str, metadata: Value) -> Result<RunRecord> {
        self.create_run_with_state(id, project_id, metadata, RunState::Queued)
    }

    pub fn create_workflow_run(
        &mut self,
        id: &str,
        project_id: &str,
        metadata: Value,
    ) -> Result<RunRecord> {
        self.create_run_with_state(id, project_id, metadata, RunState::Discovered)
    }

    fn create_run_with_state(
        &mut self,
        id: &str,
        project_id: &str,
        metadata: Value,
        state: RunState,
    ) -> Result<RunRecord> {
        if id.trim().is_empty() || project_id.trim().is_empty() || !metadata.is_object() {
            return Err(StorageError::Invalid(
                "run IDs and object metadata are required".into(),
            ));
        }
        let now = now();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("INSERT INTO runs(id,project_id,state,revision,metadata,created_at,updated_at) VALUES (?1,?2,?3,1,?4,?5,?5)",
            params![id, project_id, state_json(state)?, serde_json::to_string(&metadata)?, now])?;
        append(&tx, id, "run.created", serde_json::json!({"state":state}))?;
        tx.commit()?;
        self.get_run(id)?
            .ok_or_else(|| StorageError::NotFound(id.into()))
    }

    pub fn get_run(&self, id: &str) -> Result<Option<RunRecord>> {
        get_run(&self.connection, id)
    }

    pub fn runs(&self) -> Result<Vec<RunRecord>> {
        let mut query = self
            .connection
            .prepare("SELECT id FROM runs ORDER BY created_at DESC,id")?;
        let ids = query
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        ids.iter()
            .map(|id| {
                self.get_run(id)?
                    .ok_or_else(|| StorageError::NotFound(id.clone()))
            })
            .collect()
    }

    /// State and event commit together; no worker event can invoke this implicitly.
    pub fn transition_run(
        &mut self,
        run_id: &str,
        expected_revision: u64,
        next: RunState,
        event_type: &str,
        payload: Value,
    ) -> Result<RunRecord> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if next == RunState::Approved || next == RunState::PlanReady {
            return Err(StorageError::Invalid(
                "use bind_plan / approve_plan for plan transitions".into(),
            ));
        }
        if next == RunState::Implementing {
            authorize_run(&tx, run_id)?;
            return Err(StorageError::Invalid("baseline evidence required: enter implementation through begin_implementation, which checks the approval, current manifest and passed baselines transactionally".into()));
        }
        transition(&tx, run_id, expected_revision, next, event_type, payload)?;
        tx.commit()?;
        self.get_run(run_id)?
            .ok_or_else(|| StorageError::NotFound(run_id.into()))
    }

    pub fn append_event(
        &mut self,
        run_id: &str,
        event_type: &str,
        payload: Value,
    ) -> Result<EventEnvelope> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let event = append(&tx, run_id, event_type, payload)?;
        tx.commit()?;
        Ok(event)
    }

    pub fn events_after(&self, run_id: &str, cursor: u64) -> Result<Vec<EventEnvelope>> {
        if self.get_run(run_id)?.is_none() {
            return Err(StorageError::NotFound(run_id.into()));
        }
        let mut statement = self.connection.prepare(
            "SELECT envelope FROM events WHERE run_id=?1 AND sequence>?2 ORDER BY sequence",
        )?;
        let rows = statement.query_map(params![run_id, cursor], |row| row.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    /// Call at service startup, before accepting work. Both queued and active
    /// attempts are interrupted; they are never silently reported successful.
    pub fn interrupt_active_runs(&mut self) -> Result<usize> {
        let active: Vec<_> = self
            .runs()?
            .into_iter()
            .filter(|run| {
                matches!(
                    run.state,
                    RunState::Queued
                        | RunState::Running
                        | RunState::Exploring
                        | RunState::Implementing
                        | RunState::Validating
                        | RunState::Reviewing
                )
            })
            .collect();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        for run in &active {
            transition(
                &tx,
                &run.id,
                run.revision,
                RunState::Interrupted,
                "run.interrupted",
                serde_json::json!({"reason":"runtime restarted before attempt settled"}),
            )?;
        }
        baselines::interrupt_running_baselines(&tx)?;
        tx.commit()?;
        Ok(active.len())
    }

    /// Append-only revisions. Concurrent writers must supply the next revision.
    pub fn save_plan(&mut self, plan: &PlanRevision) -> Result<()> {
        plan.validate()?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current: u64 = tx.query_row(
            "SELECT COALESCE(MAX(revision),0) FROM plan_revisions WHERE id=?1",
            [&plan.id],
            |row| row.get(0),
        )?;
        if plan.revision <= current {
            return Err(StorageError::ImmutableRevision);
        }
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
        tx.commit()?;
        Ok(())
    }

    pub fn get_plan(&self, id: &str, revision: u64) -> Result<Option<PlanRevision>> {
        let payload: Option<String> = self
            .connection
            .query_row(
                "SELECT payload FROM plan_revisions WHERE id=?1 AND revision=?2",
                params![id, revision],
                |r| r.get(0),
            )
            .optional()?;
        payload
            .map(|value| serde_json::from_str(&value).map_err(Into::into))
            .transpose()
    }

    /// A plan-ready workflow binds to one immutable project plan. Metadata
    /// supplied to create_run cannot impersonate this transactional binding.
    pub fn bind_plan(
        &mut self,
        run_id: &str,
        expected_run_revision: u64,
        plan_id: &str,
        plan_revision: u64,
    ) -> Result<RunRecord> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let plan = latest_plan(&tx, plan_id)?;
        let run = get_run(&tx, run_id)?.ok_or_else(|| StorageError::NotFound(run_id.into()))?;
        if plan.revision != plan_revision || plan.project_id != run.project_id {
            return Err(StorageError::Invalid(
                "plan revision or project does not match this workflow".into(),
            ));
        }
        tx.execute(
            "UPDATE runs SET plan_id=?1,plan_revision=?2 WHERE id=?3",
            params![plan_id, plan_revision, run_id],
        )?;
        transition(
            &tx,
            run_id,
            expected_run_revision,
            RunState::PlanReady,
            "plan.ready",
            serde_json::json!({"plan_id":plan.id,"plan_revision":plan.revision,"plan_hash":plan.hash}),
        )?;
        tx.commit()?;
        self.get_run(run_id)?
            .ok_or_else(|| StorageError::NotFound(run_id.into()))
    }

    /// Compare current plan revision/hash and persist authorization, state and
    /// event in one write transaction. Browser-supplied permissions cannot widen it.
    pub fn approve_plan(
        &mut self,
        run_id: &str,
        expected_run_revision: u64,
        approval: &Approval,
    ) -> Result<RunRecord> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let plan = latest_plan(&tx, &approval.plan_id)?;
        approval.authorize(&plan)?;
        let bound: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM runs WHERE id=?1 AND plan_id=?2 AND plan_revision=?3 AND project_id=?4)",
            params![run_id,plan.id,plan.revision,plan.project_id], |r| r.get(0))?;
        if !bound {
            return Err(StorageError::Invalid(
                "approval does not match the workflow's bound plan".into(),
            ));
        }
        tx.execute(
            "INSERT INTO approvals(id,plan_id,plan_revision,payload) VALUES (?1,?2,?3,?4)",
            params![
                approval.id,
                approval.plan_id,
                approval.plan_revision,
                serde_json::to_string(approval)?
            ],
        )?;
        tx.execute(
            "UPDATE runs SET approval_id=?1 WHERE id=?2",
            params![approval.id, run_id],
        )?;
        transition(
            &tx,
            run_id,
            expected_run_revision,
            RunState::Approved,
            "plan.approved",
            serde_json::json!({"approval_id":approval.id,"plan_id":plan.id,"plan_revision":plan.revision,"plan_hash":plan.hash}),
        )?;
        tx.commit()?;
        self.get_run(run_id)?
            .ok_or_else(|| StorageError::NotFound(run_id.into()))
    }
}

fn get_run(connection: &Connection, id: &str) -> Result<Option<RunRecord>> {
    let row = connection.query_row("SELECT id,project_id,state,revision,metadata,created_at,updated_at FROM runs WHERE id=?1", [id],
        |r| Ok((r.get::<_, String>(0)?,r.get::<_, String>(1)?,r.get::<_, String>(2)?,r.get::<_, u64>(3)?,
            r.get::<_, String>(4)?,r.get::<_, String>(5)?,r.get::<_, String>(6)?))).optional()?;
    row.map(
        |(id, project_id, state, revision, metadata, created_at, updated_at)| {
            Ok(RunRecord {
                id,
                project_id,
                state: serde_json::from_str(&state)?,
                revision,
                metadata: serde_json::from_str(&metadata)?,
                created_at,
                updated_at,
            })
        },
    )
    .transpose()
}

pub(crate) fn transition(
    tx: &Transaction<'_>,
    id: &str,
    expected: u64,
    next: RunState,
    kind: &str,
    payload: Value,
) -> Result<()> {
    let run = get_run(tx, id)?.ok_or_else(|| StorageError::NotFound(id.into()))?;
    if run.revision != expected {
        return Err(StorageError::RevisionConflict {
            expected,
            actual: run.revision,
        });
    }
    run.state.transition(next)?;
    tx.execute(
        "UPDATE runs SET state=?1,revision=revision+1,updated_at=?2 WHERE id=?3 AND revision=?4",
        params![state_json(next)?, now(), id, expected],
    )?;
    let mut payload = payload
        .as_object()
        .cloned()
        .ok_or_else(|| StorageError::Invalid("event payload must be an object".into()))?;
    payload.insert("state".into(), serde_json::to_value(next)?);
    payload.insert("revision".into(), serde_json::json!(expected + 1));
    append(tx, id, kind, Value::Object(payload))?;
    Ok(())
}

fn append(
    tx: &Transaction<'_>,
    run_id: &str,
    event_type: &str,
    payload: Value,
) -> Result<EventEnvelope> {
    if event_type.trim().is_empty() || !payload.is_object() {
        return Err(StorageError::Invalid(
            "event type and object payload are required".into(),
        ));
    }
    let project_id: String = tx
        .query_row("SELECT project_id FROM runs WHERE id=?1", [run_id], |r| {
            r.get(0)
        })
        .optional()?
        .ok_or_else(|| StorageError::NotFound(run_id.into()))?;
    let sequence: u64 = tx.query_row(
        "SELECT COALESCE(MAX(sequence),0)+1 FROM events WHERE run_id=?1",
        [run_id],
        |r| r.get(0),
    )?;
    let event = append_envelope(&project_id, run_id, sequence, event_type, payload)?;
    tx.execute(
        "INSERT INTO events(run_id,sequence,event_id,envelope) VALUES (?1,?2,?3,?4)",
        params![
            run_id,
            sequence,
            event.event_id,
            serde_json::to_string(&event)?
        ],
    )?;
    Ok(event)
}

fn latest_plan(tx: &Transaction<'_>, id: &str) -> Result<PlanRevision> {
    let payload: String = tx
        .query_row(
            "SELECT payload FROM plan_revisions WHERE id=?1 ORDER BY revision DESC LIMIT 1",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| StorageError::NotFound(id.into()))?;
    Ok(serde_json::from_str(&payload)?)
}

pub(crate) fn authorize_run(tx: &Transaction<'_>, run_id: &str) -> Result<()> {
    let payload: String = tx.query_row("SELECT a.payload FROM runs r JOIN approvals a ON r.approval_id=a.id AND r.plan_id=a.plan_id AND r.plan_revision=a.plan_revision WHERE r.id=?1", [run_id], |r| r.get(0))
        .optional()?.ok_or_else(|| StorageError::Invalid("implementation requires a durably stored approval".into()))?;
    let approval: Approval = serde_json::from_str(&payload)?;
    approval.authorize(&latest_plan(tx, &approval.plan_id)?)?;
    Ok(())
}

/// Build one durable envelope. `stream_id` is a run ID or a project stream ID.
fn append_envelope(
    project_id: &str,
    stream_id: &str,
    sequence: u64,
    event_type: &str,
    payload: Value,
) -> Result<EventEnvelope> {
    if event_type.trim().is_empty() || !payload.is_object() {
        return Err(StorageError::Invalid(
            "event type and object payload are required".into(),
        ));
    }
    Ok(EventEnvelope {
        schema_version: SCHEMA_VERSION.into(),
        event_id: format!("{stream_id}:{sequence}"),
        sequence,
        timestamp: now(),
        project_id: project_id.into(),
        run_id: stream_id.into(),
        event_type: event_type.into(),
        payload,
    })
}

pub(crate) fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn state_json(state: RunState) -> Result<String> {
    Ok(serde_json::to_string(&state)?)
}

const MIGRATION_1: &str = "
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS plan_revisions(id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), hash TEXT NOT NULL,
 payload TEXT NOT NULL, PRIMARY KEY(id,revision));
CREATE TRIGGER IF NOT EXISTS immutable_plans_update BEFORE UPDATE ON plan_revisions BEGIN SELECT RAISE(ABORT,'immutable plan revision'); END;
CREATE TRIGGER IF NOT EXISTS immutable_plans_delete BEFORE DELETE ON plan_revisions BEGIN SELECT RAISE(ABORT,'immutable plan revision'); END;
CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, plan_revision INTEGER NOT NULL, payload TEXT NOT NULL,
 FOREIGN KEY(plan_id,plan_revision) REFERENCES plan_revisions(id,revision));
CREATE TRIGGER IF NOT EXISTS immutable_approvals_update BEFORE UPDATE ON approvals BEGIN SELECT RAISE(ABORT,'immutable approval'); END;
CREATE TRIGGER IF NOT EXISTS immutable_approvals_delete BEFORE DELETE ON approvals BEGIN SELECT RAISE(ABORT,'immutable approval'); END;
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 metadata TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, approval_id TEXT REFERENCES approvals(id),
 plan_id TEXT, plan_revision INTEGER, FOREIGN KEY(plan_id,plan_revision) REFERENCES plan_revisions(id,revision));
CREATE TABLE IF NOT EXISTS events(run_id TEXT NOT NULL REFERENCES runs(id), sequence INTEGER NOT NULL CHECK(sequence>0), event_id TEXT NOT NULL UNIQUE,
 envelope TEXT NOT NULL, PRIMARY KEY(run_id,sequence));
INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
COMMIT;
";

const MIGRATION_2: &str = "
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=0),
 manifest_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS manifest_revisions(project_id TEXT NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL CHECK(revision>0),
 hash TEXT NOT NULL, payload TEXT NOT NULL, base_commits TEXT NOT NULL, confirmed_at TEXT NOT NULL, PRIMARY KEY(project_id,revision));
CREATE TRIGGER IF NOT EXISTS immutable_manifests_update BEFORE UPDATE ON manifest_revisions BEGIN SELECT RAISE(ABORT,'immutable manifest revision'); END;
CREATE TRIGGER IF NOT EXISTS immutable_manifests_delete BEFORE DELETE ON manifest_revisions BEGIN SELECT RAISE(ABORT,'immutable manifest revision'); END;
CREATE TABLE IF NOT EXISTS repositories(project_id TEXT NOT NULL REFERENCES projects(id), id TEXT NOT NULL, local_path TEXT NOT NULL,
 observation TEXT NOT NULL, registered_at TEXT NOT NULL, PRIMARY KEY(project_id,id));
CREATE TABLE IF NOT EXISTS discoveries(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_events(project_id TEXT NOT NULL REFERENCES projects(id), sequence INTEGER NOT NULL CHECK(sequence>0),
 event_id TEXT NOT NULL UNIQUE, envelope TEXT NOT NULL, PRIMARY KEY(project_id,sequence));
INSERT OR IGNORE INTO schema_migrations(version) VALUES (2);
COMMIT;
";

const MIGRATION_3: &str = "
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS baselines(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), repository_id TEXT NOT NULL,
 run_id TEXT NOT NULL REFERENCES runs(id), status TEXT NOT NULL, payload TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE IF NOT EXISTS check_results(id TEXT PRIMARY KEY, baseline_id TEXT NOT NULL REFERENCES baselines(id), recipe_id TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS immutable_check_results_update BEFORE UPDATE ON check_results BEGIN SELECT RAISE(ABORT,'immutable check result'); END;
CREATE TRIGGER IF NOT EXISTS immutable_check_results_delete BEFORE DELETE ON check_results BEGIN SELECT RAISE(ABORT,'immutable check result'); END;
INSERT OR IGNORE INTO schema_migrations(version) VALUES (3);
COMMIT;
";
