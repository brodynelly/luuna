//! Project registry, immutable manifest revisions, machine-local repository
//! registrations and the project-scoped durable event stream.
//!
//! The manifest is machine-independent and hashed; local paths and observed
//! commits live only in this private registry. Confirmation re-checks the
//! registered identity and the expected revision inside one transaction.
use crate::{append_envelope, now, Result, StorageError, Store};
use luuna_domain::{
    valid_project_id, Discovery, EventEnvelope, ProjectManifest, RepositoryObservation,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    /// Confirmed manifest revision; 0 until the first confirmation.
    pub revision: u64,
    pub manifest_hash: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Machine-registry entry: where a registered repository lives on this host and
/// the identity it had when registered.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepositoryRegistration {
    pub project_id: String,
    pub repository_id: String,
    pub local_path: String,
    pub observation: RepositoryObservation,
    pub registered_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ManifestRecord {
    pub project_id: String,
    pub revision: u64,
    pub hash: String,
    pub manifest: ProjectManifest,
    /// Exact HEAD commit of each repository when this revision was confirmed.
    pub base_commits: BTreeMap<String, String>,
    pub confirmed_at: String,
}

pub fn project_stream_id(project_id: &str) -> String {
    format!("project:{project_id}")
}

impl Store {
    /// Register a project and its repositories from fresh read-only observations.
    pub fn register_project(
        &mut self,
        id: &str,
        name: &str,
        repositories: &[(String, RepositoryObservation)],
    ) -> Result<ProjectRecord> {
        if !valid_project_id(id) {
            return Err(StorageError::Invalid(
                "project ID must match ^[a-z][a-z0-9-]{0,63}$".into(),
            ));
        }
        if name.trim().is_empty() || name.len() > 200 {
            return Err(StorageError::Invalid(
                "project name must be 1..200 bytes".into(),
            ));
        }
        if repositories.is_empty() || repositories.len() > 32 {
            return Err(StorageError::Invalid(
                "register between one and 32 repositories".into(),
            ));
        }
        let mut ids = BTreeSet::new();
        for (repository_id, observation) in repositories {
            if !valid_project_id(repository_id) || !ids.insert(repository_id.as_str()) {
                return Err(StorageError::Invalid(
                    "repository IDs must be unique and match ^[a-z][a-z0-9-]*$".into(),
                ));
            }
            observation.validate()?;
        }
        let now = now();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if get_project(&tx, id)?.is_some() {
            return Err(StorageError::AlreadyExists(id.into()));
        }
        tx.execute(
            "INSERT INTO projects(id,name,revision,manifest_hash,created_at,updated_at) VALUES (?1,?2,0,NULL,?3,?3)",
            params![id, name, now],
        )?;
        append_project_event(
            &tx,
            id,
            "project.registered",
            json!({"name":name,"repositories":ids}),
        )?;
        for (repository_id, observation) in repositories {
            tx.execute(
                "INSERT INTO repositories(project_id,id,local_path,observation,registered_at) VALUES (?1,?2,?3,?4,?5)",
                params![
                    id,
                    repository_id,
                    observation.local_path,
                    serde_json::to_string(observation)?,
                    now
                ],
            )?;
            append_project_event(
                &tx,
                id,
                "repository.registered",
                json!({"repository_id":repository_id,"observation":observation}),
            )?;
        }
        tx.commit()?;
        self.get_project(id)?
            .ok_or_else(|| StorageError::NotFound(id.into()))
    }

    pub fn get_project(&self, id: &str) -> Result<Option<ProjectRecord>> {
        get_project(&self.connection, id)
    }

    pub fn projects(&self) -> Result<Vec<ProjectRecord>> {
        let mut query = self
            .connection
            .prepare("SELECT id FROM projects ORDER BY created_at DESC,id")?;
        let ids = query
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        ids.iter()
            .map(|id| {
                self.get_project(id)?
                    .ok_or_else(|| StorageError::NotFound(id.clone()))
            })
            .collect()
    }

    pub fn repositories(&self, project_id: &str) -> Result<Vec<RepositoryRegistration>> {
        repositories(&self.connection, project_id)
    }

    /// Persist a proposal. It is evidence for the developer, not a confirmation.
    pub fn record_discovery(&mut self, discovery: &Discovery) -> Result<()> {
        if discovery.id.trim().is_empty() {
            return Err(StorageError::Invalid("discovery ID is required".into()));
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        get_project(&tx, &discovery.project_id)?
            .ok_or_else(|| StorageError::NotFound(discovery.project_id.clone()))?;
        tx.execute(
            "INSERT INTO discoveries(id,project_id,created_at,payload) VALUES (?1,?2,?3,?4)",
            params![
                discovery.id,
                discovery.project_id,
                discovery.created_at,
                serde_json::to_string(discovery)?
            ],
        )?;
        append_project_event(
            &tx,
            &discovery.project_id,
            "discovery.proposed",
            json!({
                "discovery_id": discovery.id,
                "proposed_manifest_hash": discovery.proposed_manifest.computed_hash()?,
                "manifest_problems": discovery.manifest_problems,
                "questions": discovery.questions.len(),
                "repositories": discovery.repositories.iter().map(|r| json!({
                    "repository_id": r.repository_id,
                    "head_commit": r.observation.head_commit,
                    "profiles": r.profiles,
                    "proposed_checks": r.proposed_checks.iter().map(|c| c.check.id.clone()).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            }),
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn latest_discovery(&self, project_id: &str) -> Result<Option<Discovery>> {
        let payload: Option<String> = self
            .connection
            .query_row(
                "SELECT payload FROM discoveries WHERE project_id=?1 ORDER BY created_at DESC, rowid DESC LIMIT 1",
                [project_id],
                |r| r.get(0),
            )
            .optional()?;
        payload
            .map(|value| serde_json::from_str(&value).map_err(Into::into))
            .transpose()
    }

    /// Confirm a manifest revision. `observations` are fresh read-only
    /// observations for every registered repository; identity, remote and
    /// default branch must agree with them and the project revision must match.
    pub fn confirm_manifest(
        &mut self,
        project_id: &str,
        expected_revision: u64,
        manifest: &ProjectManifest,
        observations: &BTreeMap<String, RepositoryObservation>,
    ) -> Result<ProjectRecord> {
        manifest.validate()?;
        if manifest.id != project_id {
            return Err(StorageError::Invalid(
                "manifest ID must equal the project ID".into(),
            ));
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let project = get_project(&tx, project_id)?
            .ok_or_else(|| StorageError::NotFound(project_id.into()))?;
        if project.revision != expected_revision {
            return Err(StorageError::RevisionConflict {
                expected: expected_revision,
                actual: project.revision,
            });
        }
        if manifest.revision != expected_revision + 1 {
            return Err(StorageError::RevisionConflict {
                expected: expected_revision + 1,
                actual: manifest.revision,
            });
        }
        let registered = repositories(&tx, project_id)?;
        let registered_ids: BTreeSet<&str> = registered
            .iter()
            .map(|r| r.repository_id.as_str())
            .collect();
        if registered_ids != manifest.repository_ids() {
            return Err(StorageError::Invalid(
                "manifest repositories must equal the registered repositories".into(),
            ));
        }
        let mut base_commits = BTreeMap::new();
        for registration in &registered {
            let repository = manifest
                .repositories
                .iter()
                .find(|r| r.id == registration.repository_id)
                .expect("ids verified equal");
            let observed = observations
                .get(&registration.repository_id)
                .ok_or_else(|| {
                    StorageError::Invalid(format!(
                        "no fresh observation for repository {}",
                        registration.repository_id
                    ))
                })?;
            registration
                .observation
                .identity
                .matches(&observed.identity)?;
            match &observed.identity.remote {
                Some(remote) if &repository.remote != remote => {
                    return Err(StorageError::Invalid(format!(
                        "repository {} remote {} does not match the observed origin",
                        repository.id, repository.remote
                    )));
                }
                None if !repository.remote.starts_with("local:") => {
                    return Err(StorageError::Invalid(format!(
                        "repository {} has no origin remote; its manifest identity must start with local:",
                        repository.id
                    )));
                }
                _ => {}
            }
            if !observed.has_branch(&repository.default_branch) {
                return Err(StorageError::Invalid(format!(
                    "default branch {} is not a local or origin branch of repository {}",
                    repository.default_branch, repository.id
                )));
            }
            base_commits.insert(repository.id.clone(), observed.head_commit.clone());
        }
        let hash = manifest.computed_hash()?;
        let confirmed_at = now();
        tx.execute(
            "INSERT INTO manifest_revisions(project_id,revision,hash,payload,base_commits,confirmed_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                project_id,
                manifest.revision,
                hash,
                serde_json::to_string(manifest)?,
                serde_json::to_string(&base_commits)?,
                confirmed_at
            ],
        )?;
        // The project record follows the confirmed manifest so both names agree.
        tx.execute(
            "UPDATE projects SET revision=?1,manifest_hash=?2,updated_at=?3,name=?4 WHERE id=?5 AND revision=?6",
            params![
                manifest.revision,
                hash,
                confirmed_at,
                manifest.name,
                project_id,
                expected_revision
            ],
        )?;
        append_project_event(
            &tx,
            project_id,
            "manifest.confirmed",
            json!({
                "revision": manifest.revision,
                "manifest_hash": hash,
                "manifest": manifest,
                "base_commits": base_commits,
                "dirty": observations.iter().map(|(id, o)| (id.clone(), json!({
                    "clean": o.dirty.is_clean(),
                    "staged": o.dirty.staged,
                    "unstaged": o.dirty.unstaged,
                    "untracked": o.dirty.untracked,
                    "conflicted": o.dirty.conflicted,
                }))).collect::<BTreeMap<_, _>>(),
            }),
        )?;
        tx.commit()?;
        self.get_project(project_id)?
            .ok_or_else(|| StorageError::NotFound(project_id.into()))
    }

    pub fn get_manifest(&self, project_id: &str, revision: u64) -> Result<Option<ManifestRecord>> {
        let row = self
            .connection
            .query_row(
                "SELECT hash,payload,base_commits,confirmed_at FROM manifest_revisions WHERE project_id=?1 AND revision=?2",
                params![project_id, revision],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?;
        row.map(|(hash, payload, base_commits, confirmed_at)| {
            Ok(ManifestRecord {
                project_id: project_id.into(),
                revision,
                hash,
                manifest: serde_json::from_str(&payload)?,
                base_commits: serde_json::from_str(&base_commits)?,
                confirmed_at,
            })
        })
        .transpose()
    }

    pub fn current_manifest(&self, project_id: &str) -> Result<Option<ManifestRecord>> {
        match self.get_project(project_id)? {
            Some(project) if project.revision > 0 => {
                self.get_manifest(project_id, project.revision)
            }
            _ => Ok(None),
        }
    }

    pub fn project_events_after(
        &self,
        project_id: &str,
        cursor: u64,
    ) -> Result<Vec<EventEnvelope>> {
        if self.get_project(project_id)?.is_none() {
            return Err(StorageError::NotFound(project_id.into()));
        }
        let mut statement = self.connection.prepare(
            "SELECT envelope FROM project_events WHERE project_id=?1 AND sequence>?2 ORDER BY sequence",
        )?;
        let rows =
            statement.query_map(params![project_id, cursor], |row| row.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }
}

pub(crate) fn get_project_in(connection: &Connection, id: &str) -> Result<Option<ProjectRecord>> {
    get_project(connection, id)
}

fn get_project(connection: &Connection, id: &str) -> Result<Option<ProjectRecord>> {
    connection
        .query_row(
            "SELECT id,name,revision,manifest_hash,created_at,updated_at FROM projects WHERE id=?1",
            [id],
            |r| {
                Ok(ProjectRecord {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    revision: r.get(2)?,
                    manifest_hash: r.get(3)?,
                    created_at: r.get(4)?,
                    updated_at: r.get(5)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

pub(crate) fn repositories_in(
    connection: &Connection,
    project_id: &str,
) -> Result<Vec<RepositoryRegistration>> {
    repositories(connection, project_id)
}

fn repositories(connection: &Connection, project_id: &str) -> Result<Vec<RepositoryRegistration>> {
    let mut statement = connection.prepare(
        "SELECT id,local_path,observation,registered_at FROM repositories WHERE project_id=?1 ORDER BY id",
    )?;
    let rows = statement.query_map([project_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
        ))
    })?;
    rows.map(|row| {
        let (repository_id, local_path, observation, registered_at) = row?;
        Ok(RepositoryRegistration {
            project_id: project_id.into(),
            repository_id,
            local_path,
            observation: serde_json::from_str(&observation)?,
            registered_at,
        })
    })
    .collect()
}

pub(crate) fn append_project_event(
    tx: &Transaction<'_>,
    project_id: &str,
    event_type: &str,
    payload: Value,
) -> Result<EventEnvelope> {
    let sequence: u64 = tx.query_row(
        "SELECT COALESCE(MAX(sequence),0)+1 FROM project_events WHERE project_id=?1",
        [project_id],
        |r| r.get(0),
    )?;
    let stream = project_stream_id(project_id);
    let event = append_envelope(project_id, &stream, sequence, event_type, payload)?;
    tx.execute(
        "INSERT INTO project_events(project_id,sequence,event_id,envelope) VALUES (?1,?2,?3,?4)",
        params![
            project_id,
            sequence,
            event.event_id,
            serde_json::to_string(&event)?
        ],
    )?;
    Ok(event)
}
