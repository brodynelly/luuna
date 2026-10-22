//! Durable publication records and the intent ledger for their external side
//! effects (M7). A publication is one candidate hash of one workflow run
//! published to GitHub: per-repository branches, pull requests, and the CI and
//! merge observations the runtime reads back. Every external write (a branch
//! push, a pull request creation, a cross-link update) first records its
//! intent under a stable idempotency key and then its outcome, so a retry
//! after a timeout or crash reconciles against the remote instead of
//! repeating the write. Merging is never performed, only observed.
use crate::{append, now, Result, StorageError, Store};
use luuna_domain::{Publication, PublicationState, SCHEMA_VERSION};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// CI as observed on a pull request head, never acted upon.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CiState {
    Pending,
    Success,
    Failure,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CiCheck {
    pub name: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conclusion: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct CiObservation {
    pub state: CiState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_at: Option<String>,
    #[serde(default)]
    pub checks: Vec<CiCheck>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Whether a human merged the pull request on GitHub, as observed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct MergeObservation {
    pub merged: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merged_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merged_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PullRequestRef {
    pub number: u64,
    pub url: String,
}

/// One step of a publication as it stands for a repository.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum StepState {
    #[default]
    Pending,
    Done,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepositoryPublication {
    pub branch: String,
    pub commit: String,
    /// The registered (redacted, portable) remote identity.
    pub remote: String,
    pub owner: String,
    pub repo: String,
    pub base_branch: String,
    pub push: StepState,
    pub pull_request_step: StepState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pull_request: Option<PullRequestRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default)]
    pub ci: CiObservation,
    #[serde(default)]
    pub merge: MergeObservation,
}

/// The durable record a client displays. It mirrors the domain
/// [`Publication`] contract (see [`PublicationRecord::contract`]) and adds the
/// per-repository detail, observations and request identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationRecord {
    pub schema_version: String,
    pub run_id: String,
    pub project_id: String,
    pub ticket_id: String,
    pub candidate_hash: String,
    pub idempotency_key: String,
    pub publication_state: PublicationState,
    pub repositories: BTreeMap<String, RepositoryPublication>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_at: Option<String>,
}

impl PublicationRecord {
    /// The domain contract (`schemas/publication.schema.json`) for this record.
    pub fn contract(&self) -> Publication {
        Publication {
            schema_version: SCHEMA_VERSION.into(),
            ticket_id: self.ticket_id.clone(),
            candidate_hash: self.candidate_hash.clone(),
            per_repository_branch: self
                .repositories
                .iter()
                .map(|(id, repository)| (id.clone(), repository.branch.clone()))
                .collect(),
            pull_request_urls: self
                .repositories
                .iter()
                .filter_map(|(id, repository)| {
                    repository
                        .pull_request
                        .as_ref()
                        .map(|pr| (id.clone(), pr.url.clone()))
                })
                .collect(),
            publication_state: self.publication_state.clone(),
        }
    }

    /// Whether every repository has its branch pushed and a pull request open.
    pub fn complete(&self) -> bool {
        !self.repositories.is_empty()
            && self.repositories.values().all(|repository| {
                repository.push == StepState::Done
                    && repository.pull_request_step == StepState::Done
                    && repository.pull_request.is_some()
            })
    }

    /// Whether every pull request has been observed merged.
    pub fn all_merged(&self) -> bool {
        self.complete() && self.repositories.values().all(|r| r.merge.merged)
    }
}

/// An external side effect's durable intent and outcome.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntentState {
    /// Recorded before the external call; the call's outcome is not known.
    Intended,
    Succeeded,
    Failed,
    /// The call may have taken effect (a timeout after the request was sent);
    /// reconciliation must look before retrying.
    Uncertain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationIntent {
    /// Stable across retries: `<run>:<hash>:<repository>:<step>:<branch>:<commit>`.
    pub key: String,
    pub run_id: String,
    pub candidate_hash: String,
    pub repository_id: String,
    /// `push`, `pull_request` or `link`.
    pub step: String,
    pub branch: String,
    pub commit: String,
    pub state: IntentState,
    pub outcome: Value,
    pub created_at: String,
    pub updated_at: String,
}

pub fn intent_key(
    run_id: &str,
    candidate_hash: &str,
    repository_id: &str,
    step: &str,
    branch: &str,
    commit: &str,
) -> String {
    format!("{run_id}:{candidate_hash}:{repository_id}:{step}:{branch}:{commit}")
}

fn state_text(state: &PublicationState) -> Result<String> {
    Ok(serde_json::to_value(state)?
        .as_str()
        .unwrap_or("pending")
        .to_owned())
}

fn intent_state_text(state: &IntentState) -> Result<String> {
    Ok(serde_json::to_value(state)?
        .as_str()
        .unwrap_or("intended")
        .to_owned())
}

impl Store {
    /// Record a new publication for the run's candidate hash. One record per
    /// (run, candidate hash): a repeat is `AlreadyExists`.
    pub fn create_publication(&mut self, record: &PublicationRecord) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if crate::get_run(&tx, &record.run_id)?.is_none() {
            return Err(StorageError::NotFound(record.run_id.clone()));
        }
        let existing: Option<String> = tx
            .query_row(
                "SELECT idempotency_key FROM publications WHERE run_id=?1 AND candidate_hash=?2",
                params![record.run_id, record.candidate_hash],
                |row| row.get(0),
            )
            .optional()?;
        if existing.is_some() {
            return Err(StorageError::AlreadyExists(format!(
                "publication of candidate {} for run {}",
                record.candidate_hash, record.run_id
            )));
        }
        tx.execute(
            "INSERT INTO publications(run_id,candidate_hash,ticket_id,idempotency_key,state,payload,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                record.run_id,
                record.candidate_hash,
                record.ticket_id,
                record.idempotency_key,
                state_text(&record.publication_state)?,
                serde_json::to_string(record)?,
                record.created_at,
                record.updated_at
            ],
        )?;
        append(
            &tx,
            &record.run_id,
            "publication.requested",
            serde_json::json!({
                "candidate_hash": record.candidate_hash,
                "idempotency_key": record.idempotency_key,
                "repositories": record.repositories.iter().map(|(id, r)| serde_json::json!({"repository_id": id, "branch": r.branch, "commit": r.commit, "remote": r.remote})).collect::<Vec<_>>(),
            }),
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn get_publication(
        &self,
        run_id: &str,
        candidate_hash: &str,
    ) -> Result<Option<PublicationRecord>> {
        let payload: Option<String> = self
            .connection
            .query_row(
                "SELECT payload FROM publications WHERE run_id=?1 AND candidate_hash=?2",
                params![run_id, candidate_hash],
                |row| row.get(0),
            )
            .optional()?;
        payload
            .map(|payload| Ok(serde_json::from_str(&payload)?))
            .transpose()
    }

    /// The newest publication of a run, whichever candidate hash it published.
    pub fn latest_publication(&self, run_id: &str) -> Result<Option<PublicationRecord>> {
        let payload: Option<String> = self
            .connection
            .query_row(
                "SELECT payload FROM publications WHERE run_id=?1 ORDER BY created_at DESC, candidate_hash LIMIT 1",
                params![run_id],
                |row| row.get(0),
            )
            .optional()?;
        payload
            .map(|payload| Ok(serde_json::from_str(&payload)?))
            .transpose()
    }

    /// Persist the record as it now stands and, when `event` is given, a
    /// durable run event in the same transaction.
    pub fn update_publication(
        &mut self,
        record: &mut PublicationRecord,
        event: Option<(&str, Value)>,
    ) -> Result<()> {
        record.updated_at = now();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = tx.execute(
            "UPDATE publications SET state=?3, payload=?4, updated_at=?5 WHERE run_id=?1 AND candidate_hash=?2",
            params![
                record.run_id,
                record.candidate_hash,
                state_text(&record.publication_state)?,
                serde_json::to_string(record)?,
                record.updated_at
            ],
        )?;
        if changed == 0 {
            return Err(StorageError::NotFound(format!(
                "publication of candidate {} for run {}",
                record.candidate_hash, record.run_id
            )));
        }
        if let Some((event_type, payload)) = event {
            append(&tx, &record.run_id, event_type, payload)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Record that an external write is about to be attempted. An existing
    /// intent under the same key is returned unchanged: the caller decides
    /// from its state whether the write already took effect.
    pub fn record_publication_intent(
        &mut self,
        intent: &PublicationIntent,
    ) -> Result<PublicationIntent> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing: Option<String> = tx
            .query_row(
                "SELECT payload FROM publication_intents WHERE key=?1",
                params![intent.key],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(existing) = existing {
            tx.commit()?;
            return Ok(serde_json::from_str(&existing)?);
        }
        tx.execute(
            "INSERT INTO publication_intents(key,run_id,candidate_hash,repository_id,step,state,payload,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                intent.key,
                intent.run_id,
                intent.candidate_hash,
                intent.repository_id,
                intent.step,
                intent_state_text(&intent.state)?,
                serde_json::to_string(intent)?,
                intent.created_at,
                intent.updated_at
            ],
        )?;
        tx.commit()?;
        Ok(intent.clone())
    }

    /// Record the outcome of an intended external write.
    pub fn settle_publication_intent(
        &mut self,
        key: &str,
        state: IntentState,
        outcome: Value,
    ) -> Result<PublicationIntent> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let payload: String = tx
            .query_row(
                "SELECT payload FROM publication_intents WHERE key=?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| StorageError::NotFound(format!("publication intent {key}")))?;
        let mut intent: PublicationIntent = serde_json::from_str(&payload)?;
        intent.state = state;
        intent.outcome = outcome;
        intent.updated_at = now();
        tx.execute(
            "UPDATE publication_intents SET state=?2, payload=?3, updated_at=?4 WHERE key=?1",
            params![
                key,
                intent_state_text(&intent.state)?,
                serde_json::to_string(&intent)?,
                intent.updated_at
            ],
        )?;
        tx.commit()?;
        Ok(intent)
    }

    /// Every intent recorded for a publication, oldest first.
    pub fn publication_intents(
        &self,
        run_id: &str,
        candidate_hash: &str,
    ) -> Result<Vec<PublicationIntent>> {
        let mut statement = self.connection.prepare(
            "SELECT payload FROM publication_intents WHERE run_id=?1 AND candidate_hash=?2 ORDER BY created_at, key",
        )?;
        let rows = statement.query_map(params![run_id, candidate_hash], |row| {
            row.get::<_, String>(0)
        })?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(run_id: &str) -> PublicationRecord {
        let mut repositories = BTreeMap::new();
        repositories.insert(
            "app".to_owned(),
            RepositoryPublication {
                branch: "luuna/ticket-1/0123456789ab".into(),
                commit: "a".repeat(40),
                remote: "https://github.com/octo/app.git".into(),
                owner: "octo".into(),
                repo: "app".into(),
                base_branch: "main".into(),
                push: StepState::Pending,
                pull_request_step: StepState::Pending,
                pull_request: None,
                reason: None,
                ci: CiObservation::default(),
                merge: MergeObservation::default(),
            },
        );
        PublicationRecord {
            schema_version: SCHEMA_VERSION.into(),
            run_id: run_id.into(),
            project_id: "p".into(),
            ticket_id: "ticket-1".into(),
            candidate_hash: format!("sha256:{}", "b".repeat(64)),
            idempotency_key: "key-1".into(),
            publication_state: PublicationState::Pending,
            repositories,
            reason: None,
            created_at: now(),
            updated_at: now(),
            observed_at: None,
        }
    }

    #[test]
    fn publication_records_and_intents_are_durable_and_idempotent() {
        let mut store = Store::open(":memory:").unwrap();
        store
            .create_run("run-1", "p", serde_json::json!({"kind":"workflow"}))
            .unwrap();
        let mut first = record("run-1");
        store.create_publication(&first).unwrap();
        assert!(matches!(
            store.create_publication(&first),
            Err(StorageError::AlreadyExists(_))
        ));
        let stored = store
            .get_publication("run-1", &first.candidate_hash)
            .unwrap()
            .unwrap();
        assert_eq!(stored, first);
        assert_eq!(
            stored.contract().publication_state,
            PublicationState::Pending
        );
        assert_eq!(stored.contract().pull_request_urls.len(), 0);
        let events = store.events_after("run-1", 0).unwrap();
        assert_eq!(events.last().unwrap().event_type, "publication.requested");

        let key = intent_key(
            "run-1",
            &first.candidate_hash,
            "app",
            "push",
            "luuna/ticket-1/0123456789ab",
            &"a".repeat(40),
        );
        let intent = PublicationIntent {
            key: key.clone(),
            run_id: "run-1".into(),
            candidate_hash: first.candidate_hash.clone(),
            repository_id: "app".into(),
            step: "push".into(),
            branch: "luuna/ticket-1/0123456789ab".into(),
            commit: "a".repeat(40),
            state: IntentState::Intended,
            outcome: Value::Null,
            created_at: now(),
            updated_at: now(),
        };
        assert_eq!(
            store.record_publication_intent(&intent).unwrap().state,
            IntentState::Intended
        );
        let settled = store
            .settle_publication_intent(
                &key,
                IntentState::Succeeded,
                serde_json::json!({"remote":"at commit"}),
            )
            .unwrap();
        assert_eq!(settled.state, IntentState::Succeeded);
        // Re-recording the same key returns the settled intent, never a fresh one.
        let replay = store.record_publication_intent(&intent).unwrap();
        assert_eq!(replay.state, IntentState::Succeeded);
        assert_eq!(
            store
                .publication_intents("run-1", &first.candidate_hash)
                .unwrap()
                .len(),
            1
        );

        first.publication_state = PublicationState::PrOpen;
        first.repositories.get_mut("app").unwrap().pull_request = Some(PullRequestRef {
            number: 7,
            url: "https://github.com/octo/app/pull/7".into(),
        });
        store
            .update_publication(
                &mut first,
                Some(("publication.pr_opened", serde_json::json!({"number":7}))),
            )
            .unwrap();
        let latest = store.latest_publication("run-1").unwrap().unwrap();
        assert_eq!(latest.publication_state, PublicationState::PrOpen);
        assert_eq!(
            latest.contract().pull_request_urls["app"],
            "https://github.com/octo/app/pull/7"
        );
        assert!(store.latest_publication("run-2").unwrap().is_none());
    }
}
