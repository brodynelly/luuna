//! M2a: register an existing repository, discover a proposed map read-only, and
//! confirm an immutable manifest revision. Nothing here writes to a repository
//! or executes a proposed command. A registered repository whose checkout moved
//! or whose identity changed is re-pointed only by an explicit rebind request.
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
use luuna_git::{strip_verbatim_prefix, GitError};
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

/// An explicit request to re-point a registered repository. Sending it is the
/// developer's confirmation that the observed checkout and identity are intended.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RebindRepository {
    /// New absolute repository root; omitted to re-observe the registered path
    /// (for example after its origin URL was changed on purpose).
    pub local_path: Option<String>,
}

#[derive(Serialize)]
pub struct ProjectView {
    pub project: ProjectRecord,
    pub repositories: Vec<RepositoryRegistration>,
    pub manifest: Option<ManifestRecord>,
    pub discovery: Option<Discovery>,
}

fn bad_request(message: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, message.into())
}

pub(crate) fn storage_error(error: StorageError) -> ApiError {
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
    match error {
        GitError::Timeout(_) | GitError::Io(_) => ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("repository {repository_id}: {error}"),
        ),
        GitError::Oversized => ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("repository {repository_id}: {error}; inspection lists every changed and untracked path, so commit, stash or ignore generated files and try again"),
        ),
        _ => ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("repository {repository_id}: {error}"),
        ),
    }
}

fn validate_root_path(path: &str) -> Result<(), ApiError> {
    if path.len() > MAX_PATH_BYTES || !PathBuf::from(path).is_absolute() || path.contains('\0') {
        return Err(bad_request(
            "repository path must be an absolute path to the repository root",
        ));
    }
    Ok(())
}

/// Luuna's private data directory (SQLite, artifacts, owned worktrees) must not
/// be inside a registered checkout, and a registered checkout must not be inside
/// it: a developer checkout is never one of Luuna's own worktrees.
fn reject_data_dir_overlap(
    state: &AppState,
    repository_id: &str,
    observation: &RepositoryObservation,
) -> Result<(), ApiError> {
    let data_dir = std::fs::canonicalize(&state.config.data_dir)
        .map(|path| strip_verbatim_prefix(&path))
        .map_err(internal)?;
    let root = PathBuf::from(&observation.local_path);
    if root.starts_with(&data_dir) {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!(
                "repository {repository_id}: {} is inside Luuna's data directory {} (LUUNA_DATA_DIR), which holds Luuna-owned worktrees; register the developer checkout instead",
                root.display(),
                data_dir.display()
            ),
        ));
    }
    if data_dir.starts_with(&root) {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!(
                "repository {repository_id}: Luuna's data directory {} (LUUNA_DATA_DIR) is inside this checkout and would put its private database and worktrees in the repository; restart the runtime with LUUNA_DATA_DIR outside {}",
                data_dir.display(),
                root.display()
            ),
        ));
    }
    Ok(())
}

fn already_registered(path: &str, project_id: &str, repository_id: &str) -> ApiError {
    ApiError(
        StatusCode::CONFLICT,
        format!(
            "checkout {path} is already registered as repository {repository_id} of project {project_id}; use that project, or rebind that repository to another checkout first"
        ),
    )
}

/// An identity mismatch with the recovery route spelled out for this repository.
pub(crate) fn identity_changed(
    project_id: &str,
    repository_id: &str,
    error: DomainError,
) -> ApiError {
    let detail = error
        .to_string()
        .replace("{id}", project_id)
        .replace("{repository_id}", repository_id);
    ApiError(
        StatusCode::CONFLICT,
        format!("repository {repository_id} identity changed since registration: {detail}"),
    )
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
    let mut id = if id.is_empty() || !id.as_bytes()[0].is_ascii_lowercase() {
        format!("p-{id}")
    } else {
        id
    };
    // The prefix may push a 64-character slug past the ID limit.
    id.truncate(64);
    id.trim_end_matches('-').to_owned()
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
            .map_err(|e| match e {
                GitError::InvalidPath => ApiError(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    format!(
                        "repository {repository}: the registered checkout {} no longer exists; move it back, or rebind the repository to its new location with POST /api/v1/projects/{id}/repositories/{repository}/rebind and a local_path",
                        registration.local_path,
                        repository = registration.repository_id
                    ),
                ),
                other => git_error(&registration.repository_id, other),
            })?;
        registration
            .observation
            .identity
            .matches(&observation.identity)
            .map_err(|e| identity_changed(id, &registration.repository_id, e))?;
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
        validate_root_path(&repository.path)?;
    }
    let mut observations = Vec::new();
    for repository in &request.repositories {
        let observation = state
            .git
            .inspect_for_registration(&PathBuf::from(&repository.path))
            .await
            .map_err(|e| git_error(&repository.id, e))?;
        reject_data_dir_overlap(&state, &repository.id, &observation)?;
        if observations
            .iter()
            .any(|(_, existing): &(String, RepositoryObservation)| {
                existing.local_path == observation.local_path
            })
        {
            return Err(bad_request(
                "each repository must be a distinct checkout; two IDs point at the same root",
            ));
        }
        observations.push((repository.id.clone(), observation));
    }
    {
        let mut store = state.store.lock().map_err(internal)?;
        if store.get_project(&id).map_err(internal)?.is_some() {
            return Err(storage_error(StorageError::AlreadyExists(id)));
        }
        // One registration per checkout: two projects would otherwise run
        // baselines in, and lease writers against, the same repository.
        for (_, observation) in &observations {
            if let Some((project, repository)) = store
                .registration_at_path(&observation.local_path)
                .map_err(internal)?
            {
                return Err(already_registered(
                    &observation.local_path,
                    &project,
                    &repository,
                ));
            }
        }
        store
            .register_project(&id, &name, &observations)
            .map_err(storage_error)?;
    }
    Ok((StatusCode::CREATED, Json(view(&state, &id)?)))
}

/// `POST /api/v1/projects/{id}/repositories/{repository_id}/rebind`: re-observe
/// the registered path, or a new `local_path`, and bind the repository to that
/// checkout and identity. This is the only way past an identity mismatch; it is
/// refused while a run of the project may be executing in a checkout. Evidence
/// stays bound to exact commits, and a manifest whose remote no longer matches
/// must be confirmed again before it is accepted.
pub async fn rebind_repository(
    State(state): State<AppState>,
    Path((id, repository_id)): Path<(String, String)>,
    Json(request): Json<RebindRepository>,
) -> Result<Json<ProjectView>, ApiError> {
    if !valid_project_id(&id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "project not found".into()));
    }
    let registration = {
        let store = state.store.lock().map_err(internal)?;
        store
            .get_project(&id)
            .map_err(internal)?
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "project not found".into()))?;
        store
            .repositories(&id)
            .map_err(internal)?
            .into_iter()
            .find(|r| r.repository_id == repository_id)
            .ok_or_else(|| {
                ApiError(
                    StatusCode::NOT_FOUND,
                    "repository is not registered in this project".into(),
                )
            })?
    };
    let path = request
        .local_path
        .unwrap_or_else(|| registration.local_path.clone());
    validate_root_path(&path)?;
    let observation = state
        .git
        .inspect_for_registration(&PathBuf::from(&path))
        .await
        .map_err(|e| git_error(&repository_id, e))?;
    reject_data_dir_overlap(&state, &repository_id, &observation)?;
    {
        let mut store = state.store.lock().map_err(internal)?;
        if let Some(run) = store
            .active_checkout_runs(&id)
            .map_err(internal)?
            .into_iter()
            .next()
        {
            return Err(ApiError(
                StatusCode::CONFLICT,
                format!("run {run} of project {id} may be executing in a registered checkout; wait for it to finish or cancel it before rebinding"),
            ));
        }
        if let Some((project, repository)) = store
            .registration_at_path(&observation.local_path)
            .map_err(internal)?
            .filter(|(project, repository)| *project != id || *repository != repository_id)
        {
            return Err(already_registered(
                &observation.local_path,
                &project,
                &repository,
            ));
        }
        store
            .rebind_repository(&id, &repository_id, &observation)
            .map_err(storage_error)?;
    }
    Ok(Json(view(&state, &id)?))
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
    let (registrations, observations) = observe_registered(&state, &id).await?;
    // A default branch that exists only as `origin/<name>` (a fresh clone checks
    // out just one branch) is confirmed from an exact remote-tracking ref.
    let mut remote_branches = BTreeMap::new();
    for repository in &request.manifest.repositories {
        let (Some(registration), Some(observation)) = (
            registrations
                .iter()
                .find(|r| r.repository_id == repository.id),
            observations.get(&repository.id),
        ) else {
            continue;
        };
        if !observation.has_branch(&repository.default_branch)
            && state
                .git
                .has_remote_branch(
                    &PathBuf::from(&registration.local_path),
                    &repository.default_branch,
                )
                .await
                .map_err(|e| git_error(&repository.id, e))?
        {
            remote_branches.insert(
                repository.id.clone(),
                BTreeSet::from([repository.default_branch.clone()]),
            );
        }
    }
    state
        .store
        .lock()
        .map_err(internal)?
        .confirm_manifest_with_remote_branches(
            &id,
            request.expected_revision,
            &request.manifest,
            &observations,
            &remote_branches,
        )
        .map_err(storage_error)?;
    Ok(Json(view(&state, &id)?))
}

pub async fn project_events(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(page): Query<crate::EventPage>,
) -> Result<Json<Vec<EventEnvelope>>, ApiError> {
    if !valid_project_id(&id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "project not found".into()));
    }
    let (after, limit) = page.bounds()?;
    Ok(Json(
        state
            .store
            .lock()
            .map_err(internal)?
            .project_events_page(&id, after, limit.map(|limit| limit as u64))
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
        let digits = derive_project_id(&"7".repeat(80));
        assert_eq!(digits.len(), 64);
        assert!(luuna_domain::valid_project_id(&digits));
        let long = derive_project_id(&format!("{}-x", "a".repeat(63)));
        assert!(luuna_domain::valid_project_id(&long));
    }
}
