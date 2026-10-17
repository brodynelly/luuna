//! M2a: register an existing repository, discover a proposed map read-only, and
//! confirm an immutable manifest revision. Nothing here writes to a repository
//! or executes a proposed command.
use crate::{internal, ApiError, AppState};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{SecondsFormat, Utc};
use luuna_discovery::{DiscoveryRequest, RepositoryInput};
use luuna_domain::{
    valid_project_id, Discovery, DomainError, EventEnvelope, ProjectManifest, RepositoryObservation,
};
use luuna_git::GitError;
use luuna_storage::{ManifestRecord, ProjectRecord, RepositoryRegistration, StorageError};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
};

const MAX_REPOSITORIES: usize = 32;
const MAX_PATH_BYTES: usize = 4096;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterRepository {
    pub id: String,
    /// Absolute path to the repository root on this machine. Never stored in the manifest.
    pub path: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterProject {
    pub id: Option<String>,
    pub name: String,
    pub repositories: Vec<RegisterRepository>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmManifest {
    pub expected_revision: u64,
    pub manifest: ProjectManifest,
}

#[derive(Serialize)]
pub struct ProjectView {
    pub project: ProjectRecord,
    pub repositories: Vec<RepositoryRegistration>,
    pub manifest: Option<ManifestRecord>,
    pub discovery: Option<Discovery>,
}

#[derive(Deserialize)]
pub struct Cursor {
    #[serde(default)]
    after: u64,
}

fn bad_request(message: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, message.into())
}

fn storage_error(error: StorageError) -> ApiError {
    match error {
        StorageError::NotFound(_) => ApiError(StatusCode::NOT_FOUND, "project not found".into()),
        StorageError::AlreadyExists(id) => ApiError(
            StatusCode::CONFLICT,
            format!("project {id} is already registered"),
        ),
        StorageError::RevisionConflict { expected, actual } => ApiError(
            StatusCode::CONFLICT,
            format!("revision conflict: expected {expected}, current {actual}"),
        ),
        StorageError::Domain(DomainError::IdentityMismatch(detail)) => ApiError(
            StatusCode::CONFLICT,
            format!("repository identity changed since registration: {detail}"),
        ),
        StorageError::Domain(error) => {
            ApiError(StatusCode::UNPROCESSABLE_ENTITY, error.to_string())
        }
        StorageError::Invalid(detail) => ApiError(StatusCode::UNPROCESSABLE_ENTITY, detail),
        other => internal(other),
    }
}

fn git_error(repository_id: &str, error: GitError) -> ApiError {
    let status = match error {
        GitError::Timeout(_) | GitError::Io(_) | GitError::Oversized => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
        _ => StatusCode::UNPROCESSABLE_ENTITY,
    };
    ApiError(status, format!("repository {repository_id}: {error}"))
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn derive_project_id(name: &str) -> String {
    let mut id = String::new();
    for ch in name.chars().take(64) {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_lowercase() || lower.is_ascii_digit() {
            id.push(lower);
        } else if !id.is_empty() && !id.ends_with('-') {
            id.push('-');
        }
    }
    let id = id.trim_end_matches('-').to_owned();
    if id.is_empty() || !id.as_bytes()[0].is_ascii_lowercase() {
        format!("p-{id}").trim_end_matches('-').to_owned()
    } else {
        id
    }
}

fn view(state: &AppState, id: &str) -> Result<ProjectView, ApiError> {
    let store = state.store.lock().map_err(internal)?;
    let project = store
        .get_project(id)
        .map_err(internal)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "project not found".into()))?;
    Ok(ProjectView {
        repositories: store.repositories(id).map_err(internal)?,
        manifest: store.current_manifest(id).map_err(internal)?,
        discovery: store.latest_discovery(id).map_err(internal)?,
        project,
    })
}

/// Re-observe every registered repository read-only and verify it is still the
/// repository that was registered. Nothing is cached: confirmation always binds
/// to the current state of the checkout.
async fn observe_registered(
    state: &AppState,
    id: &str,
) -> Result<
    (
        Vec<RepositoryRegistration>,
        BTreeMap<String, RepositoryObservation>,
    ),
    ApiError,
> {
    let registrations = {
        let store = state.store.lock().map_err(internal)?;
        store
            .get_project(id)
            .map_err(internal)?
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "project not found".into()))?;
        store.repositories(id).map_err(internal)?
    };
    let mut observations = BTreeMap::new();
    for registration in &registrations {
        let observation = state
            .git
            .inspect(&PathBuf::from(&registration.local_path))
            .await
            .map_err(|e| git_error(&registration.repository_id, e))?;
        registration
            .observation
            .identity
            .matches(&observation.identity)
            .map_err(|e| {
                ApiError(
                    StatusCode::CONFLICT,
                    format!(
                        "repository {} identity changed since registration: {e}",
                        registration.repository_id
                    ),
                )
            })?;
        observations.insert(registration.repository_id.clone(), observation);
    }
    Ok((registrations, observations))
}

pub async fn list_projects(
    State(state): State<AppState>,
) -> Result<Json<Vec<ProjectRecord>>, ApiError> {
    Ok(Json(
        state
            .store
            .lock()
            .map_err(internal)?
            .projects()
            .map_err(internal)?,
    ))
}

pub async fn get_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ProjectView>, ApiError> {
    if !valid_project_id(&id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "project not found".into()));
    }
    Ok(Json(view(&state, &id)?))
}

pub async fn register_project(
    State(state): State<AppState>,
    Json(request): Json<RegisterProject>,
) -> Result<(StatusCode, Json<ProjectView>), ApiError> {
    let name = request.name.trim().to_owned();
    if name.is_empty() || name.len() > 200 {
        return Err(bad_request("project name must be 1..200 bytes"));
    }
    let id = request
        .id
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| derive_project_id(&name));
    if !valid_project_id(&id) {
        return Err(bad_request("project ID must match ^[a-z][a-z0-9-]{0,63}$"));
    }
    if request.repositories.is_empty() || request.repositories.len() > MAX_REPOSITORIES {
        return Err(bad_request("register between one and 32 repositories"));
    }
    let mut ids = BTreeSet::new();
    for repository in &request.repositories {
        if !valid_project_id(&repository.id) || !ids.insert(repository.id.as_str()) {
            return Err(bad_request(
                "repository IDs must be unique and match ^[a-z][a-z0-9-]*$",
            ));
        }
        let path = PathBuf::from(&repository.path);
        if repository.path.len() > MAX_PATH_BYTES
            || !path.is_absolute()
            || repository.path.contains('\0')
        {
            return Err(bad_request(
                "repository path must be an absolute path to the repository root",
            ));
        }
    }
    let mut observations = Vec::new();
    for repository in &request.repositories {
        let observation = state
            .git
            .inspect(&PathBuf::from(&repository.path))
            .await
            .map_err(|e| git_error(&repository.id, e))?;
        observations.push((repository.id.clone(), observation));
    }
    state
        .store
        .lock()
        .map_err(internal)?
        .register_project(&id, &name, &observations)
        .map_err(storage_error)?;
    Ok((StatusCode::CREATED, Json(view(&state, &id)?)))
}

pub async fn discover(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<Discovery>), ApiError> {
    if !valid_project_id(&id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "project not found".into()));
    }
    let project = {
        let store = state.store.lock().map_err(internal)?;
        store
            .get_project(&id)
            .map_err(internal)?
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "project not found".into()))?
    };
    let (registrations, mut observations) = observe_registered(&state, &id).await?;
    let repositories = registrations
        .iter()
        .map(|registration| RepositoryInput {
            repository_id: registration.repository_id.clone(),
            root: PathBuf::from(&registration.local_path),
            observation: observations
                .remove(&registration.repository_id)
                .expect("observed every registration"),
        })
        .collect();
    let request = DiscoveryRequest {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: id.clone(),
        project_name: project.name.clone(),
        manifest_revision: project.revision + 1,
        created_at: now(),
        repositories,
    };
    let discovery = tokio::task::spawn_blocking(move || luuna_discovery::discover(request))
        .await
        .map_err(internal)?
        .map_err(|e| ApiError(StatusCode::UNPROCESSABLE_ENTITY, e.to_string()))?;
    state
        .store
        .lock()
        .map_err(internal)?
        .record_discovery(&discovery)
        .map_err(storage_error)?;
    Ok((StatusCode::CREATED, Json(discovery)))
}

pub async fn confirm_manifest(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<ConfirmManifest>,
) -> Result<Json<ProjectView>, ApiError> {
    if !valid_project_id(&id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "project not found".into()));
    }
    request
        .manifest
        .validate()
        .map_err(|e| ApiError(StatusCode::UNPROCESSABLE_ENTITY, e.to_string()))?;
    let (_, observations) = observe_registered(&state, &id).await?;
    state
        .store
        .lock()
        .map_err(internal)?
        .confirm_manifest(
            &id,
            request.expected_revision,
            &request.manifest,
            &observations,
        )
        .map_err(storage_error)?;
    Ok(Json(view(&state, &id)?))
}

pub async fn project_events(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(cursor): Query<Cursor>,
) -> Result<Json<Vec<EventEnvelope>>, ApiError> {
    if !valid_project_id(&id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "project not found".into()));
    }
    Ok(Json(
        state
            .store
            .lock()
            .map_err(internal)?
            .project_events_after(&id, cursor.after)
            .map_err(storage_error)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::derive_project_id;

    #[test]
    fn project_ids_derive_from_names_safely() {
        assert_eq!(derive_project_id("My App 2"), "my-app-2");
        assert_eq!(derive_project_id("42 things"), "p-42-things");
        assert_eq!(derive_project_id("***"), "p");
    }
}
