//! M2b: run a repository's confirmed check recipes as a supervised baseline and
//! persist deterministic evidence bound to the manifest, commit, tree and host.
//! A baseline is a run: it shares creation, events, replay, SSE, cancellation
//! and restart interruption with every other run the runtime owns.
use crate::{internal, not_found, ApiError, AppState};
use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{SecondsFormat, Utc};
use luuna_domain::{
    valid_project_id, BaselineEvidence, BaselineIdentity, BaselineStatus, CheckResult, CheckStatus,
    ExecutionProfile, ManifestCheck, RunState, SCHEMA_VERSION,
};
use luuna_executor::{artifact_hashes, artifact_ref, CommandSpec, Executor, Probe, Progress};
use luuna_storage::{ManifestRecord, RepositoryRegistration, RunRecord};
use serde::Deserialize;
use serde_json::json;
use std::{path::PathBuf, time::Duration};
use tokio::sync::{mpsc, watch};

/// Output events per check kept in the durable stream; artifacts hold everything.
const MAX_OUTPUT_EVENTS: usize = 200;
const MAX_ARTIFACT_RESPONSE: usize = 16 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StartBaseline {
    pub repository_id: String,
    /// Also run recipes the manifest marks optional; they never affect the verdict.
    #[serde(default)]
    pub include_optional: bool,
}

#[derive(Deserialize)]
pub struct ArtifactId {
    pub id: String,
    pub artifact_id: String,
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn project_not_found() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "project not found".into())
}

pub async fn list_baselines(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<BaselineEvidence>>, ApiError> {
    if !valid_project_id(&id) {
        return Err(project_not_found());
    }
    let store = state.store.lock().map_err(internal)?;
    store
        .get_project(&id)
        .map_err(internal)?
        .ok_or_else(project_not_found)?;
    Ok(Json(store.baselines(&id).map_err(internal)?))
}

pub async fn start_baseline(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<StartBaseline>,
) -> Result<(StatusCode, Json<RunRecord>), ApiError> {
    if !valid_project_id(&id) {
        return Err(project_not_found());
    }
    let (manifest, registration) = {
        let store = state.store.lock().map_err(internal)?;
        store
            .get_project(&id)
            .map_err(internal)?
            .ok_or_else(project_not_found)?;
        let manifest = store
            .current_manifest(&id)
            .map_err(internal)?
            .ok_or(ApiError(
                StatusCode::UNPROCESSABLE_ENTITY,
                "confirm a manifest before running a baseline".into(),
            ))?;
        let registration = store
            .repositories(&id)
            .map_err(internal)?
            .into_iter()
            .find(|r| r.repository_id == request.repository_id)
            .ok_or(ApiError(
                StatusCode::UNPROCESSABLE_ENTITY,
                "repository is not registered in this project".into(),
            ))?;
        (manifest, registration)
    };
    let repository = manifest
        .manifest
        .repositories
        .iter()
        .find(|r| r.id == request.repository_id)
        .cloned()
        .ok_or(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "repository is not part of the confirmed manifest".into(),
        ))?;
    let recipes: Vec<ManifestCheck> = repository
        .checks
        .iter()
        .filter(|c| c.required || request.include_optional)
        .cloned()
        .collect();
    let required: Vec<String> = repository
        .checks
        .iter()
        .filter(|c| c.required)
        .map(|c| c.id.clone())
        .collect();
    let run_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = watch::channel(false);
    let mut active = state.active.lock().map_err(internal)?;
    if active.len() >= 4 {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "four runs are already active".into(),
        ));
    }
    let metadata = json!({
        "kind": "baseline",
        "project_id": id,
        "repository_id": request.repository_id,
        "manifest_revision": manifest.revision,
        "manifest_hash": manifest.hash,
        "recipes": recipes.iter().map(|c| c.id.clone()).collect::<Vec<_>>(),
        "required_checks": required,
        "include_optional": request.include_optional,
    });
    let run = state
        .store
        .lock()
        .map_err(internal)?
        .create_run(&run_id, &id, metadata)
        .map_err(internal)?;
    active.insert(run_id.clone(), tx);
    drop(active);
    let worker_state = state.clone();
    let job = BaselineJob {
        run_id: run_id.clone(),
        project_id: id,
        manifest,
        registration,
        execution: repository.execution,
        recipes,
        required,
    };
    tokio::spawn(async move {
        baseline_worker(worker_state.clone(), job, rx).await;
        if let Ok(mut active) = worker_state.active.lock() {
            active.remove(&run_id);
        }
    });
    Ok((StatusCode::ACCEPTED, Json(run)))
}

struct BaselineJob {
    run_id: String,
    project_id: String,
    manifest: ManifestRecord,
    registration: RepositoryRegistration,
    execution: ExecutionProfile,
    recipes: Vec<ManifestCheck>,
    required: Vec<String>,
}

fn spec_for(
    job: &BaselineJob,
    recipe: &ManifestCheck,
    artifact_dir: &std::path::Path,
) -> CommandSpec {
    recipe_spec(&job.registration.local_path, recipe, artifact_dir)
}

pub(crate) fn recipe_spec(
    local_path: &str,
    recipe: &ManifestCheck,
    artifact_dir: &std::path::Path,
) -> CommandSpec {
    CommandSpec {
        recipe_id: recipe.id.clone(),
        executable: recipe.executable.clone(),
        args: recipe.args.clone(),
        repository_root: PathBuf::from(local_path),
        cwd: recipe.cwd.clone(),
        timeout: Duration::from_secs(recipe.timeout_seconds),
        capabilities: recipe.capabilities.clone(),
        artifact_dir: artifact_dir.to_path_buf(),
    }
}

pub(crate) fn artifact_dir(state: &AppState, run_id: &str) -> PathBuf {
    state.config.data_dir.join("artifacts").join(run_id)
}

/// The host's environment fingerprint for required recipes: resolved
/// executables and versions, probed without running any recipe. Baselines
/// record it; scheduling recomputes it so evidence from another host or
/// toolchain never authorizes a writer.
pub(crate) async fn probe_fingerprint(
    state: &AppState,
    local_path: &str,
    recipes: &[ManifestCheck],
    artifact_dir: &std::path::Path,
) -> String {
    let mut parts = Vec::new();
    for recipe in recipes {
        let part = match state
            .executor
            .probe(&recipe_spec(local_path, recipe, artifact_dir))
            .await
        {
            Probe::Resolved { fingerprint, .. } => fingerprint,
            Probe::Unavailable(reason) => format!("unavailable:{}:{reason}", recipe.id),
        };
        if recipe.required {
            parts.push(part);
        }
    }
    Executor::combine_fingerprints(&parts)
}

async fn baseline_worker(state: AppState, job: BaselineJob, cancel: watch::Receiver<bool>) {
    let run_id = job.run_id.clone();
    let fail = |state: &AppState, reason: String, baseline_status: Option<BaselineStatus>| {
        let _ = state.finish(
            &run_id,
            RunState::Failed,
            json!({"reason": reason, "baseline_status": baseline_status}),
        );
    };
    if *cancel.borrow() {
        let _ = state.finish(
            &job.run_id,
            state.stop_run_state(),
            json!({"reason": state.stop_reason("cancelled before startup")}),
        );
        return;
    }
    let running = (|| -> Result<(), ApiError> {
        let mut store = state.store.lock().map_err(internal)?;
        let run = store
            .get_run(&job.run_id)
            .map_err(internal)?
            .ok_or_else(not_found)?;
        store
            .transition_run(
                &job.run_id,
                run.revision,
                RunState::Running,
                "run.running",
                json!({"kind":"baseline","repository_id":job.registration.repository_id}),
            )
            .map_err(internal)?;
        Ok(())
    })();
    if running.is_err() {
        fail(&state, "cannot persist startup".into(), None);
        return;
    }

    // Fresh read-only observation: identity, exact commit and tree, dirty state.
    let root = PathBuf::from(&job.registration.local_path);
    let observation = match state.git.inspect(&root).await {
        Ok(observation) => observation,
        Err(error) => {
            fail(
                &state,
                format!("repository inspection failed: {error}"),
                None,
            );
            return;
        }
    };
    if let Err(error) = job
        .registration
        .observation
        .identity
        .matches(&observation.identity)
    {
        fail(
            &state,
            format!("repository identity changed since registration: {error}"),
            None,
        );
        return;
    }
    let tree = match state.git.commit_tree(&root, &observation.head_commit).await {
        Ok(tree) => tree,
        Err(error) => {
            fail(&state, format!("cannot resolve commit tree: {error}"), None);
            return;
        }
    };
    let identity = BaselineIdentity {
        manifest_hash: job.manifest.hash.clone(),
        repository_id: job.registration.repository_id.clone(),
        commit: observation.head_commit.clone(),
        tree,
    };
    let candidate_hash = match identity.hash() {
        Ok(hash) => hash,
        Err(error) => {
            fail(&state, format!("invalid baseline identity: {error}"), None);
            return;
        }
    };

    // A baseline binds to an exact commit; a dirty checkout is not that commit.
    // Decided before any probe so nothing repository-controlled runs for a
    // checkout or profile the baseline would refuse anyway.
    let blocked_reason = if job.execution == ExecutionProfile::Container {
        Some(
            "container execution profile is not implemented; only native execution runs".to_owned(),
        )
    } else if !observation.dirty.is_clean() {
        let dirty = &observation.dirty;
        Some(format!(
            "checkout is not at an exact commit: {} staged, {} unstaged, {} untracked and {} conflicted paths; commit or stash developer changes before running a baseline",
            dirty.staged, dirty.unstaged, dirty.untracked, dirty.conflicted
        ))
    } else if job.required.is_empty() {
        Some("manifest declares no required check for this repository".to_owned())
    } else {
        None
    };

    // Probe every recipe, but bind the aggregate to required checks only so
    // optional checks do not change scheduling's environment identity. It is fixed
    // before any command runs.
    let artifacts = artifact_dir(&state, &job.run_id);
    let mut parts = Vec::new();
    let probed: &[ManifestCheck] = if blocked_reason.is_none() {
        &job.recipes
    } else {
        &[]
    };
    for recipe in probed {
        let part = match state
            .executor
            .probe(&spec_for(&job, recipe, &artifacts))
            .await
        {
            Probe::Resolved { fingerprint, .. } => fingerprint,
            Probe::Unavailable(reason) => format!("unavailable:{}:{reason}", recipe.id),
        };
        if recipe.required {
            parts.push(part);
        }
    }
    let environment_fingerprint = Executor::combine_fingerprints(&parts);
    let baseline_id = uuid::Uuid::new_v4().to_string();
    let evidence = BaselineEvidence {
        id: baseline_id.clone(),
        run_id: job.run_id.clone(),
        project_id: job.project_id.clone(),
        manifest_revision: job.manifest.revision,
        identity: identity.clone(),
        environment_fingerprint: environment_fingerprint.clone(),
        status: BaselineStatus::Running,
        required_checks: job.required.clone(),
        results: Vec::new(),
        started_at: now(),
        finished_at: None,
        reason: None,
    };
    if let Err(error) = state
        .store
        .lock()
        .map_err(|_| "store poisoned".to_owned())
        .and_then(|mut store| store.start_baseline(&evidence).map_err(|e| e.to_string()))
    {
        fail(&state, format!("cannot persist baseline: {error}"), None);
        return;
    }
    let _ = state.event(
        &job.run_id,
        "baseline.started",
        json!({
            "baseline_id": baseline_id,
            "repository_id": identity.repository_id,
            "manifest_hash": identity.manifest_hash,
            "manifest_revision": job.manifest.revision,
            "commit": identity.commit,
            "tree": identity.tree,
            "environment_fingerprint": environment_fingerprint,
            "required_checks": job.required,
            "recipes": job.recipes.iter().map(|c| c.id.clone()).collect::<Vec<_>>(),
        }),
    );

    if let Some(reason) = blocked_reason {
        let _ = state.store.lock().map(|mut store| {
            store.finish_baseline(&baseline_id, BaselineStatus::Blocked, Some(&reason))
        });
        let _ = state.event(
            &job.run_id,
            "baseline.finished",
            json!({"baseline_id": baseline_id, "status": BaselineStatus::Blocked, "reason": reason}),
        );
        fail(&state, reason, Some(BaselineStatus::Blocked));
        return;
    }

    let mut results: Vec<CheckResult> = Vec::new();
    let mut cancelled = false;
    for recipe in &job.recipes {
        if *cancel.borrow() {
            cancelled = true;
            break;
        }
        let spec = spec_for(&job, recipe, &artifacts);
        let mut command = vec![spec.executable.clone()];
        command.extend(spec.args.iter().cloned());
        let _ = state.event(
            &job.run_id,
            "check.started",
            json!({"recipe_id": recipe.id, "command": command, "cwd": recipe.cwd, "required": recipe.required, "timeout_seconds": recipe.timeout_seconds}),
        );
        let (progress, mut updates) = mpsc::unbounded_channel::<Progress>();
        let relay_state = state.clone();
        let relay_run = job.run_id.clone();
        let relay_recipe = recipe.id.clone();
        let relay = tokio::spawn(async move {
            let mut emitted = 0usize;
            while let Some(update) = updates.recv().await {
                match update {
                    Progress::Started { pid, command } => {
                        let _ = relay_state.event(
                            &relay_run,
                            "check.spawned",
                            json!({"recipe_id": relay_recipe, "pid": pid, "command": command}),
                        );
                    }
                    Progress::Output { stream, chunk } => {
                        if emitted < MAX_OUTPUT_EVENTS {
                            emitted += 1;
                            let _ = relay_state.event(
                                &relay_run,
                                "check.output",
                                json!({"recipe_id": relay_recipe, "stream": stream, "chunk": chunk, "truncated_stream": emitted == MAX_OUTPUT_EVENTS}),
                            );
                        }
                    }
                }
            }
        });
        let execution = state
            .executor
            .execute(&spec, cancel.clone(), Some(progress))
            .await;
        let _ = relay.await;
        let execution = match execution {
            Ok(execution) => execution,
            Err(error) => {
                fail(
                    &state,
                    format!("executor failure: {error}"),
                    Some(BaselineStatus::Failed),
                );
                let _ = state.store.lock().map(|mut store| {
                    store.finish_baseline(
                        &baseline_id,
                        BaselineStatus::Failed,
                        Some(&error.to_string()),
                    )
                });
                return;
            }
        };
        let result = CheckResult {
            schema_version: SCHEMA_VERSION.into(),
            id: uuid::Uuid::new_v4().to_string(),
            run_id: job.run_id.clone(),
            repository_id: identity.repository_id.clone(),
            recipe_id: recipe.id.clone(),
            candidate_hash: candidate_hash.clone(),
            commit: identity.commit.clone(),
            environment_fingerprint: execution.environment_fingerprint.clone(),
            command: execution.command.clone(),
            status: execution.status,
            exit_code: execution.exit_code,
            artifact_refs: execution
                .artifacts
                .iter()
                .map(|a| artifact_ref(&job.run_id, &recipe.id, &a.name))
                .collect(),
            cwd: recipe.cwd.clone(),
            started_at: Some(execution.started_at.clone()),
            finished_at: Some(execution.finished_at.clone()),
            reason: execution.reason.clone(),
            artifact_hashes: artifact_hashes(&execution),
            tests_detected: execution.tests_detected,
            truncated_artifacts: execution
                .artifacts
                .iter()
                .filter(|a| a.truncated)
                .map(|a| artifact_ref(&job.run_id, &recipe.id, &a.name))
                .collect(),
        };
        let recorded = state
            .store
            .lock()
            .map_err(|_| "store poisoned".to_owned())
            .and_then(|mut store| {
                store
                    .record_check_result(&baseline_id, &result)
                    .map_err(|e| e.to_string())
            });
        if let Err(error) = recorded {
            fail(
                &state,
                format!("cannot persist check result: {error}"),
                Some(BaselineStatus::Failed),
            );
            return;
        }
        let _ = state.event(
            &job.run_id,
            "check.finished",
            json!({
                "result": result,
                "pid": execution.pid,
                "tool_version": execution.tool_version,
                "stdout_excerpt": execution.stdout_excerpt,
                "stderr_excerpt": execution.stderr_excerpt,
                "artifacts": execution.artifacts.iter().map(|a| json!({"name": a.name, "sha256": a.sha256, "bytes": a.bytes, "truncated": a.truncated})).collect::<Vec<_>>(),
            }),
        );
        let was_cancelled = result.status == CheckStatus::Cancelled;
        results.push(result);
        if was_cancelled {
            cancelled = true;
            break;
        }
    }
    let required_results: Vec<CheckResult> = results
        .iter()
        .filter(|r| job.required.contains(&r.recipe_id))
        .cloned()
        .collect();
    let mut status = if cancelled && state.shutting_down() {
        BaselineStatus::Interrupted
    } else if cancelled {
        BaselineStatus::Cancelled
    } else {
        BaselineStatus::from_results(&required_results, job.required.len())
    };
    // Checks ran against the working tree. A pass is evidence for the recorded
    // commit only if the checkout is still that commit, clean, with the same
    // identity, once every check has finished.
    let mut drift = None;
    if status == BaselineStatus::Passed {
        match state.git.inspect(&root).await {
            Ok(after) => {
                if after.head_commit != identity.commit {
                    drift = Some(format!(
                        "HEAD moved from {} to {} while checks ran",
                        identity.commit, after.head_commit
                    ));
                } else if after.dirty.staged + after.dirty.unstaged + after.dirty.conflicted > 0 {
                    let dirty = &after.dirty;
                    drift = Some(format!(
                        "tracked files were modified while checks ran: {} staged, {} unstaged and {} conflicted paths",
                        dirty.staged, dirty.unstaged, dirty.conflicted
                    ));
                } else if let Err(error) = job
                    .registration
                    .observation
                    .identity
                    .matches(&after.identity)
                {
                    drift = Some(format!(
                        "repository identity changed while checks ran: {error}"
                    ));
                } else if after.dirty.untracked > 0 {
                    // Build caches and reports are untracked by definition and do not
                    // change the recorded commit or tree; they are recorded, not judged.
                    let _ = state.event(
                        &job.run_id,
                        "checkout.untracked",
                        json!({"untracked": after.dirty.untracked, "paths": after.dirty.paths, "truncated": after.dirty.truncated}),
                    );
                }
            }
            Err(error) => {
                drift = Some(format!(
                    "repository could not be re-inspected after the checks: {error}"
                ));
            }
        }
        if drift.is_some() {
            status = BaselineStatus::Failed;
        }
    }
    let reason = match status {
        _ if drift.is_some() => drift.map(|d| format!("checkout changed during the baseline: {d}")),
        BaselineStatus::Passed => None,
        BaselineStatus::Cancelled => {
            Some("cancelled before every required check finished".to_owned())
        }
        BaselineStatus::Interrupted => {
            Some("interrupted by runtime shutdown before every required check finished".to_owned())
        }
        _ => Some(
            required_results
                .iter()
                .filter(|r| r.status != CheckStatus::Passed)
                .map(|r| {
                    format!(
                        "{}: {:?}{}",
                        r.recipe_id,
                        r.status,
                        r.reason
                            .as_deref()
                            .map(|x| format!(" ({x})"))
                            .unwrap_or_default()
                    )
                })
                .collect::<Vec<_>>()
                .join("; "),
        ),
    };
    let finished = state
        .store
        .lock()
        .map_err(|_| "store poisoned".to_owned())
        .and_then(|mut store| {
            store
                .finish_baseline(&baseline_id, status, reason.as_deref())
                .map_err(|e| e.to_string())
        });
    let _ = state.event(
        &job.run_id,
        "baseline.finished",
        json!({"baseline_id": baseline_id, "status": status, "reason": reason, "results": results.len()}),
    );
    match (finished, status) {
        (Err(error), _) => fail(
            &state,
            format!("cannot persist baseline: {error}"),
            Some(status),
        ),
        (Ok(_), BaselineStatus::Passed) => {
            let _ = state.finish(
                &job.run_id,
                RunState::Completed,
                json!({"reason":"every required check passed at the recorded commit","baseline_id":baseline_id,"baseline_status":status}),
            );
        }
        (Ok(_), BaselineStatus::Cancelled) => {
            let _ = state.finish(
                &job.run_id,
                RunState::Cancelled,
                json!({"reason":"abort requested; check process group reaped","baseline_id":baseline_id}),
            );
        }
        (Ok(_), BaselineStatus::Interrupted) => {
            let _ = state.finish(
                &job.run_id,
                RunState::Interrupted,
                json!({"reason":"interrupted by runtime shutdown; check process group reaped","baseline_id":baseline_id}),
            );
        }
        (Ok(_), other) => fail(
            &state,
            reason.unwrap_or_else(|| "baseline did not pass".into()),
            Some(other),
        ),
    }
}

/// Private artifact access by record identity, never by request-supplied paths.
pub async fn artifact(
    State(state): State<AppState>,
    Path(ArtifactId { id, artifact_id }): Path<ArtifactId>,
) -> Result<Response, ApiError> {
    let valid_token = |value: &str| {
        !value.is_empty()
            && value.len() <= 128
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
            && !value.contains("..")
    };
    let Some((recipe_id, stream)) = artifact_id.rsplit_once('.') else {
        return Err(ApiError(StatusCode::NOT_FOUND, "artifact not found".into()));
    };
    if !valid_token(&id) || !valid_token(recipe_id) || !matches!(stream, "stdout" | "stderr") {
        return Err(ApiError(StatusCode::NOT_FOUND, "artifact not found".into()));
    }
    state
        .store
        .lock()
        .map_err(internal)?
        .get_run(&id)
        .map_err(internal)?
        .ok_or_else(not_found)?;
    let path = artifact_dir(&state, &id).join(format!("{recipe_id}.{stream}.log"));
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(_) => return Err(ApiError(StatusCode::NOT_FOUND, "artifact not found".into())),
    };
    let body = bytes
        .into_iter()
        .take(MAX_ARTIFACT_RESPONSE)
        .collect::<Vec<u8>>();
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        body,
    )
        .into_response())
}
