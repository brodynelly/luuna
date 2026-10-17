//! M2c: tickets, immutable plan revisions, exact-hash approvals and one scoped
//! writer. Scheduling revalidates the ticket, manifest, base commit and
//! baseline evidence through `Store::begin_implementation`; the writer runs Pi
//! inside a Luuna-owned detached worktree under the private data directory,
//! never the developer checkout, with the scope guard loaded and the diff
//! judged by the runtime afterwards. Native execution keeps host permissions:
//! nothing here is an operating-system sandbox.
use crate::{
    baselines::{artifact_dir, probe_fingerprint},
    internal, not_found,
    projects::storage_error,
    ApiError, AppState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{SecondsFormat, Utc};
use luuna_domain::{
    check_scope, valid_project_id, Approval, AttemptState, BudgetUsage, Budgets, CandidateSet,
    CheckRecipe, CheckStatus, ExecutionProfile, LeaseState, Operation, Permissions, PlanRevision,
    PlanTask, RunState, Ticket, TicketSource, WorktreeLease, CANONICALIZATION, SCHEMA_VERSION,
};
use luuna_engine_pi::{
    install_scope_guard, PiConfig, PiProcess, SessionProfile, WriterProfile, PI_VERSION,
};
use luuna_storage::{AttemptRecord, RepositoryRegistration, RunRecord, StorageError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::{Path as FsPath, PathBuf},
    time::Duration,
};
use tokio::sync::watch;

/// Longest string kept inside a persisted Pi event; tool arguments and results
/// beyond this are truncated in the durable stream (the worktree is the record).
const MAX_EVENT_STRING: usize = 4096;

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn unprocessable(message: impl Into<String>) -> ApiError {
    ApiError(StatusCode::UNPROCESSABLE_ENTITY, message.into())
}
fn conflict(message: impl Into<String>) -> ApiError {
    ApiError(StatusCode::CONFLICT, message.into())
}
fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateTicket {
    /// Repeating a delivery with the same key returns the same ticket.
    pub idempotency_key: String,
    pub title: String,
    pub intent: String,
    pub acceptance_criteria: Vec<String>,
    pub repository_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanTaskRequest {
    #[serde(default = "default_task_id")]
    pub id: String,
    pub repository_id: String,
    /// Relative paths or prefixes the writer may change; `.` means the repository.
    pub paths: Vec<String>,
    pub operations: Vec<Operation>,
    /// Defaults to the ticket's acceptance criteria.
    #[serde(default)]
    pub acceptance_criteria: Vec<String>,
}
fn default_task_id() -> String {
    "implement".into()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BudgetRequest {
    #[serde(default = "default_attempts")]
    pub max_attempts: u32,
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
    #[serde(default = "default_cost")]
    pub cost_usd_micros: u64,
}
fn default_attempts() -> u32 {
    2
}
fn default_timeout() -> u64 {
    600
}
fn default_cost() -> u64 {
    1_000_000
}
impl Default for BudgetRequest {
    fn default() -> Self {
        Self {
            max_attempts: default_attempts(),
            timeout_seconds: default_timeout(),
            cost_usd_micros: default_cost(),
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreatePlan {
    pub task: PlanTaskRequest,
    /// Permitted path prefixes per repository; defaults to the task's paths.
    #[serde(default)]
    pub permissions: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub budgets: BudgetRequest,
}

#[derive(Serialize)]
pub struct PlanOpened {
    pub plan: PlanRevision,
    pub run: RunRecord,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApprovePlan {
    pub plan_revision: u64,
    /// The exact hash the approver saw; anything else is a stale approval.
    pub plan_hash: String,
    pub approved_by: String,
}

#[derive(Serialize)]
pub struct PlanApproved {
    pub approval: Approval,
    pub run: RunRecord,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct Implement {
    pub task_id: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
}

fn project_not_found() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "project not found".into())
}
fn ticket_not_found() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "ticket not found".into())
}

pub async fn create_ticket(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<CreateTicket>,
) -> Result<(StatusCode, Json<Ticket>), ApiError> {
    if !valid_project_id(&id) {
        return Err(project_not_found());
    }
    let timestamp = now();
    let ticket = Ticket {
        schema_version: SCHEMA_VERSION.into(),
        id: format!("ticket-{}", uuid::Uuid::new_v4()),
        project_id: id.clone(),
        revision: 1,
        source: TicketSource::LuunaSqliteTemporary,
        title: request.title,
        intent: request.intent,
        acceptance_criteria: request.acceptance_criteria,
        repository_ids: request.repository_ids,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    };
    ticket
        .validate()
        .map_err(|e| unprocessable(e.to_string()))?;
    let mut store = state.store.lock().map_err(internal)?;
    store
        .get_project(&id)
        .map_err(internal)?
        .ok_or_else(project_not_found)?;
    let (stored, created) = store
        .create_ticket(&ticket, &request.idempotency_key)
        .map_err(|e| match e {
            StorageError::AlreadyExists(detail) => conflict(detail),
            other => storage_error(other),
        })?;
    Ok((
        if created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        Json(stored),
    ))
}

pub async fn list_tickets(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<Ticket>>, ApiError> {
    if !valid_project_id(&id) {
        return Err(project_not_found());
    }
    let store = state.store.lock().map_err(internal)?;
    store
        .get_project(&id)
        .map_err(internal)?
        .ok_or_else(project_not_found)?;
    Ok(Json(store.tickets(&id).map_err(internal)?))
}

pub async fn get_ticket(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Ticket>, ApiError> {
    if !valid_id(&id) {
        return Err(ticket_not_found());
    }
    let store = state.store.lock().map_err(internal)?;
    Ok(Json(
        store
            .get_ticket(&id)
            .map_err(internal)?
            .ok_or_else(ticket_not_found)?,
    ))
}

pub async fn list_plans(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<PlanRevision>>, ApiError> {
    if !valid_id(&id) {
        return Err(ticket_not_found());
    }
    let store = state.store.lock().map_err(internal)?;
    store
        .get_ticket(&id)
        .map_err(internal)?
        .ok_or_else(ticket_not_found)?;
    Ok(Json(store.plans_for_ticket(&id).map_err(internal)?))
}

/// Record an immutable plan revision for a ticket. The runtime, not the client,
/// binds it to the ticket revision, the current manifest hash, that manifest's
/// recorded base commits and its required recipes, then seals the hash.
pub async fn create_plan(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<CreatePlan>,
) -> Result<(StatusCode, Json<PlanOpened>), ApiError> {
    if !valid_id(&id) {
        return Err(ticket_not_found());
    }
    let mut store = state.store.lock().map_err(internal)?;
    let ticket = store
        .get_ticket(&id)
        .map_err(internal)?
        .ok_or_else(ticket_not_found)?;
    let manifest = store
        .current_manifest(&ticket.project_id)
        .map_err(internal)?
        .ok_or_else(|| unprocessable("confirm a manifest before planning"))?;
    let task = &request.task;
    if !ticket.repository_ids.contains(&task.repository_id) {
        return Err(unprocessable(format!(
            "repository {} is not part of ticket {}",
            task.repository_id, ticket.id
        )));
    }
    let repository = manifest
        .manifest
        .repositories
        .iter()
        .find(|r| r.id == task.repository_id)
        .ok_or_else(|| unprocessable("repository is not part of the confirmed manifest"))?;
    if repository.execution == ExecutionProfile::Container {
        return Err(unprocessable(
            "container execution profile is not implemented; only native execution runs",
        ));
    }
    let base = manifest
        .base_commits
        .get(&task.repository_id)
        .cloned()
        .ok_or_else(|| unprocessable("manifest recorded no base commit for this repository"))?;
    let required_checks: Vec<CheckRecipe> = repository
        .checks
        .iter()
        .map(|check| CheckRecipe::from_manifest(repository, check))
        .collect();
    let mut permissions = request.permissions.clone();
    permissions
        .entry(task.repository_id.clone())
        .or_insert_with(|| task.paths.clone());
    let acceptance_criteria = if task.acceptance_criteria.is_empty() {
        ticket.acceptance_criteria.clone()
    } else {
        task.acceptance_criteria.clone()
    };
    let plan_id = format!("plan-{}", ticket.id);
    let revision = store
        .latest_plan(&plan_id)
        .map_err(internal)?
        .map(|p| p.revision + 1)
        .unwrap_or(1);
    let plan = PlanRevision {
        schema_version: SCHEMA_VERSION.into(),
        canonicalization: CANONICALIZATION.into(),
        id: plan_id,
        revision,
        project_id: ticket.project_id.clone(),
        ticket_id: ticket.id.clone(),
        ticket_revision: ticket.revision,
        manifest_hash: manifest.hash.clone(),
        base_commits: BTreeMap::from([(task.repository_id.clone(), base)]),
        candidate_hash: None,
        permissions: Permissions {
            repositories: permissions,
            operations: {
                let mut ops = task.operations.clone();
                ops.sort();
                ops.dedup();
                ops
            },
        },
        tasks: vec![PlanTask {
            id: task.id.clone(),
            repository_id: task.repository_id.clone(),
            role: "implementer".into(),
            depends_on: vec![],
            paths: task.paths.clone(),
            operations: task.operations.clone(),
            acceptance_criteria,
            execution_profile: "native".into(),
        }],
        required_checks,
        budgets: Budgets {
            max_workers: 1,
            max_attempts: request.budgets.max_attempts,
            timeout_seconds: request.budgets.timeout_seconds,
            cost_usd_micros: request.budgets.cost_usd_micros,
        },
        hash: String::new(),
    }
    .seal()
    .map_err(|e| unprocessable(e.to_string()))?;
    let run_id = format!("workflow-{}", uuid::Uuid::new_v4());
    let run = store
        .open_plan_workflow(&run_id, &plan)
        .map_err(storage_error)?;
    Ok((StatusCode::CREATED, Json(PlanOpened { plan, run })))
}

pub async fn get_plan(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<PlanRevision>, ApiError> {
    if !valid_id(&id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "plan not found".into()));
    }
    let store = state.store.lock().map_err(internal)?;
    Ok(Json(store.latest_plan(&id).map_err(internal)?.ok_or(
        ApiError(StatusCode::NOT_FOUND, "plan not found".into()),
    )?))
}

/// Approve exactly one plan revision by hash. Permissions are copied from the
/// plan: a client cannot widen them, and a different hash is a stale approval.
pub async fn approve_plan(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<ApprovePlan>,
) -> Result<(StatusCode, Json<PlanApproved>), ApiError> {
    if !valid_id(&id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "plan not found".into()));
    }
    if request.approved_by.trim().is_empty() || request.approved_by.len() > 200 {
        return Err(unprocessable("approved_by must name the approver"));
    }
    let mut store = state.store.lock().map_err(internal)?;
    let plan = store
        .get_plan(&id, request.plan_revision)
        .map_err(internal)?
        .ok_or(ApiError(
            StatusCode::NOT_FOUND,
            "plan revision not found".into(),
        ))?;
    if plan.hash != request.plan_hash {
        return Err(conflict(
            "plan hash does not match the revision being approved; reload the plan",
        ));
    }
    let run = store
        .run_for_plan(&id, request.plan_revision)
        .map_err(internal)?
        .ok_or_else(|| unprocessable("no workflow run is bound to this plan revision"))?;
    let approval = Approval {
        schema_version: SCHEMA_VERSION.into(),
        id: format!("approval-{}", uuid::Uuid::new_v4()),
        plan_id: plan.id.clone(),
        plan_revision: plan.revision,
        plan_hash: plan.hash.clone(),
        approved_by: request.approved_by,
        approved_at: now(),
        permissions: plan.permissions.clone(),
    };
    let run = store
        .approve_plan(&run.id, run.revision, &approval)
        .map_err(|e| match e {
            StorageError::Domain(luuna_domain::DomainError::StaleApproval) => {
                conflict("approval does not authorize the current plan revision; it is stale")
            }
            StorageError::Domain(luuna_domain::DomainError::InvalidTransition { .. }) => {
                conflict("the workflow is not waiting for approval")
            }
            other => storage_error(other),
        })?;
    Ok((StatusCode::CREATED, Json(PlanApproved { approval, run })))
}

pub async fn list_worktrees(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<WorktreeLease>>, ApiError> {
    let store = state.store.lock().map_err(internal)?;
    store
        .get_run(&id)
        .map_err(internal)?
        .ok_or_else(not_found)?;
    Ok(Json(store.worktree_leases(&id).map_err(internal)?))
}

pub async fn list_attempts(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<AttemptRecord>>, ApiError> {
    let store = state.store.lock().map_err(internal)?;
    store
        .get_run(&id)
        .map_err(internal)?
        .ok_or_else(not_found)?;
    Ok(Json(store.attempts(&id).map_err(internal)?))
}

struct WriterJob {
    run_id: String,
    attempt: AttemptRecord,
    plan: PlanRevision,
    task: PlanTask,
    ticket: Ticket,
    registration: RepositoryRegistration,
    provider: Option<String>,
    model: Option<String>,
    previous_candidate: Option<CandidateSet>,
    repair_feedback: Option<String>,
}

/// Schedule the approved workflow's writer. Everything that can be refused is
/// refused here, before any state changes: the gate runs transactionally with
/// the host's recomputed environment fingerprint, the repository must still be
/// at the planned base, no other writer may hold the repository, and the
/// attempt budget must have room.
pub async fn implement(
    State(state): State<AppState>,
    Path(id): Path<String>,
    request: Option<Json<Implement>>,
) -> Result<(StatusCode, Json<RunRecord>), ApiError> {
    schedule_writer(
        state,
        id,
        request.map(|Json(r)| r).unwrap_or_default(),
        None,
        None,
    )
    .await
}

pub async fn repair(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<crate::candidates::CandidateRequest>,
) -> Result<(StatusCode, Json<RunRecord>), ApiError> {
    schedule_writer(
        state,
        id,
        Implement {
            task_id: None,
            provider: request.provider,
            model: request.model,
        },
        Some(request.candidate_hash),
        None,
    )
    .await
}

async fn schedule_writer(
    state: AppState,
    id: String,
    request: Implement,
    repair_hash: Option<String>,
    inline_cancel: Option<watch::Receiver<bool>>,
) -> Result<(StatusCode, Json<RunRecord>), ApiError> {
    let (previous_candidate, repair_feedback) = if let Some(ref hash) = repair_hash {
        let evidence = {
            let store = state.store.lock().map_err(internal)?;
            store
                .can_candidate_repair(&id, hash)
                .map_err(storage_error)?;
            store
                .current_candidate(&id)
                .map_err(internal)?
                .ok_or_else(|| conflict("candidate missing"))?
        };
        let artifact_dir = crate::baselines::artifact_dir(&state, &id);
        let secrets = known_secrets(&state);
        let results = evidence.results.clone();
        let check_output = tokio::task::spawn_blocking(move || {
            repair_check_output(&artifact_dir, &results, &secrets)
        })
        .await
        .map_err(|e| internal(e.to_string()))?;
        (
            Some(evidence.candidate.clone()),
            Some(format!(
                "Repair feedback: {}",
                serde_json::to_string(&json!({"reason":evidence.reason,"checks":evidence.results,"check_output":check_output,"review":evidence.review}))
                    .map_err(internal)?
            )),
        )
    } else {
        (None, None)
    };
    let (run, plan, task, ticket, registration, manifest) = {
        let store = state.store.lock().map_err(internal)?;
        let run = store
            .get_run(&id)
            .map_err(internal)?
            .ok_or_else(not_found)?;
        if run.metadata["kind"] != "workflow" {
            return Err(unprocessable("only a plan workflow can be implemented"));
        }
        if repair_hash.is_none() && run.state != RunState::Approved {
            return Err(conflict(format!(
                "workflow is {:?}; an exact approval is required before implementation",
                run.state
            )));
        }
        let plan_id = run.metadata["plan_id"].as_str().unwrap_or_default();
        let plan_revision = run.metadata["plan_revision"].as_u64().unwrap_or_default();
        let plan = store
            .get_plan(plan_id, plan_revision)
            .map_err(internal)?
            .ok_or_else(|| unprocessable("the workflow's plan revision is missing"))?;
        let task = match &request.task_id {
            Some(task_id) => plan.tasks.iter().find(|t| &t.id == task_id).cloned(),
            None => plan.tasks.first().cloned(),
        }
        .ok_or_else(|| unprocessable("task is not part of the plan"))?;
        let ticket = store
            .get_ticket(&plan.ticket_id)
            .map_err(internal)?
            .ok_or_else(ticket_not_found)?;
        let registration = store
            .repositories(&plan.project_id)
            .map_err(internal)?
            .into_iter()
            .find(|r| r.repository_id == task.repository_id)
            .ok_or_else(|| unprocessable("task repository is not registered"))?;
        let manifest = store
            .current_manifest(&plan.project_id)
            .map_err(internal)?
            .ok_or_else(|| unprocessable("the project has no confirmed manifest"))?;
        if store.attempts(&run.id).map_err(internal)?.len() as u32 >= plan.budgets.max_attempts {
            return Err(unprocessable(format!(
                "attempt budget exhausted: max_attempts {} already used; re-plan to continue",
                plan.budgets.max_attempts
            )));
        }
        if store
            .active_worktree_leases()
            .map_err(internal)?
            .iter()
            .any(|l| l.project_id == plan.project_id && l.repository_id == task.repository_id)
        {
            return Err(conflict(format!(
                "repository {} already has an active writer; one writer per repository",
                task.repository_id
            )));
        }
        (run, plan, task, ticket, registration, manifest)
    };
    let provider = request
        .provider
        .or_else(|| state.config.provider.clone())
        .filter(|s| !s.is_empty() && s.len() <= 128);
    let model = request
        .model
        .or_else(|| state.config.model.clone())
        .filter(|s| !s.is_empty() && s.len() <= 256);
    if provider.is_none() || model.is_none() {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "an explicit provider and model are required".into(),
        ));
    }
    // The repository must still be at the planned base; a moved HEAD means the
    // developer has new work the plan never saw. Dirty files are allowed: the
    // writer never touches this checkout.
    let root = PathBuf::from(&registration.local_path);
    let observation = state
        .git
        .inspect(&root)
        .await
        .map_err(|e| unprocessable(format!("repository inspection failed: {e}")))?;
    registration
        .observation
        .identity
        .matches(&observation.identity)
        .map_err(|e| {
            conflict(format!(
                "repository identity changed since registration: {e}"
            ))
        })?;
    let base = plan
        .base_commits
        .get(&task.repository_id)
        .cloned()
        .unwrap_or_default();
    if observation.head_commit != base {
        return Err(conflict(format!(
            "repository HEAD {} is no longer the planned base {}; re-confirm the manifest and re-plan",
            observation.head_commit, base
        )));
    }
    let repository = manifest
        .manifest
        .repositories
        .iter()
        .find(|r| r.id == task.repository_id)
        .cloned()
        .ok_or_else(|| unprocessable("repository is not part of the confirmed manifest"))?;
    let recipes: Vec<_> = repository
        .checks
        .iter()
        .filter(|c| c.required)
        .cloned()
        .collect();
    let fingerprint = probe_fingerprint(
        &state,
        &registration.local_path,
        &recipes,
        &artifact_dir(&state, &run.id),
    )
    .await;
    let (tx, rx) = watch::channel(false);
    if inline_cancel
        .as_ref()
        .is_some_and(|cancel| *cancel.borrow())
    {
        return Err(conflict("cancelled before automatic repair startup"));
    }
    let (run, attempt) = {
        let mut active = state.active.lock().map_err(internal)?;
        if inline_cancel.is_none() && active.contains_key(&run.id) {
            return Err(conflict("this workflow already has an active writer"));
        }
        if inline_cancel.is_none() && active.len() >= 4 {
            return Err(ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "four runs are already active".into(),
            ));
        }
        let (run, attempt) = {
            let mut store = state.store.lock().map_err(internal)?;
            let run = if let Some(ref hash) = repair_hash {
                store.begin_candidate_repair(&run.id, run.revision, hash, &fingerprint)
            } else {
                store.begin_implementation(&run.id, run.revision, &fingerprint)
            }
            .map_err(|e| match e {
                StorageError::Domain(luuna_domain::DomainError::BaselineRequired(detail)) => {
                    unprocessable(format!("implementation refused: {detail}"))
                }
                StorageError::Domain(luuna_domain::DomainError::StaleApproval) => conflict(
                    "implementation refused: the approval is stale for the current plan revision",
                ),
                StorageError::Invalid(detail) => {
                    unprocessable(format!("implementation refused: {detail}"))
                }
                StorageError::RevisionConflict { .. } => {
                    conflict("the workflow changed; reload and retry")
                }
                other => storage_error(other),
            })?;
            let attempt = store
            .start_attempt(
                &format!("attempt-{}", uuid::Uuid::new_v4()),
                &run.id,
                &task.id,
                plan.budgets.max_attempts,
                json!({"provider": provider, "model": model, "environment_fingerprint": fingerprint, "pi_version": PI_VERSION}),
            )
            .map_err(storage_error)?;
            (run, attempt)
        };
        if inline_cancel.is_none() {
            active.insert(run.id.clone(), tx);
        }
        (run, attempt)
    };
    let job = WriterJob {
        run_id: run.id.clone(),
        attempt,
        plan,
        task,
        ticket,
        registration,
        provider,
        model,
        previous_candidate,
        repair_feedback,
    };
    if let Some(cancel) = inline_cancel {
        writer_worker(state, job, cancel).await;
        return Ok((StatusCode::ACCEPTED, Json(run)));
    }
    let worker_state = state.clone();
    let run_id = run.id.clone();
    tokio::spawn(async move {
        writer_worker(worker_state.clone(), job, rx).await;
        if let Ok(mut active) = worker_state.active.lock() {
            active.remove(&run_id);
        }
    });
    Ok((StatusCode::ACCEPTED, Json(run)))
}

pub(crate) async fn automatic_repair(
    state: AppState,
    id: String,
    hash: String,
    provider: Option<String>,
    model: Option<String>,
    cancel: watch::Receiver<bool>,
) -> Result<(), ApiError> {
    schedule_writer(
        state,
        id,
        Implement {
            task_id: None,
            provider,
            model,
        },
        Some(hash),
        Some(cancel),
    )
    .await
    .map(|_| ())
}

/// Every Pi event is persisted, with long strings truncated: the worktree and
/// the candidate commit are the authoritative record of what was written.
fn bounded(value: Value) -> Value {
    match value {
        Value::String(s) if s.len() > MAX_EVENT_STRING => {
            let mut cut = MAX_EVENT_STRING;
            while !s.is_char_boundary(cut) {
                cut -= 1;
            }
            Value::String(format!(
                "{}… [truncated {} bytes]",
                &s[..cut],
                s.len() - cut
            ))
        }
        Value::Array(items) => Value::Array(items.into_iter().map(bounded).collect()),
        Value::Object(map) => {
            Value::Object(map.into_iter().map(|(k, v)| (k, bounded(v))).collect())
        }
        other => other,
    }
}

/// Bytes of each failed check log quoted back to a repair writer. The writer
/// has no shell and cannot read private artifacts, so the feedback must carry
/// the failure itself, not only an exit code and artifact identities.
const REPAIR_OUTPUT_TAIL_BYTES: usize = 2048;
/// Upper bound on all quoted check output in one repair prompt, measured after
/// JSON encoding so escaped binary output cannot exceed it; manifests do not
/// bound their recipe count, so per-artifact limits alone cannot keep the
/// prompt within a provider's context window.
const REPAIR_OUTPUT_TOTAL_BYTES: usize = 16 * 1024;
/// Bounds on the verification work itself: at most this many artifacts are
/// opened and at most this many bytes are read and hashed per repair, whatever
/// is ultimately quoted.
const REPAIR_ARTIFACT_LIMIT: usize = 32;
const REPAIR_READ_BUDGET_BYTES: u64 = 64 * 1024 * 1024;

/// The tail of every failed required check's recorded stdout/stderr, keyed by
/// artifact identity. Missing or empty logs are omitted; nothing outside the
/// run's private artifact directory is ever read. Runs on a blocking thread.
fn repair_check_output(
    artifact_dir: &FsPath,
    results: &[luuna_domain::CheckResult],
    secrets: &[String],
) -> serde_json::Map<String, Value> {
    let mut output = serde_json::Map::new();
    let mut quoted = 0usize;
    let mut opened = 0usize;
    let mut read_budget = REPAIR_READ_BUDGET_BYTES;
    'results: for result in results
        .iter()
        .filter(|result| result.status != CheckStatus::Passed)
    {
        for reference in &result.artifact_refs {
            if quoted >= REPAIR_OUTPUT_TOTAL_BYTES
                || opened >= REPAIR_ARTIFACT_LIMIT
                || read_budget == 0
            {
                output.insert(
                    "truncated".into(),
                    Value::String(
                        "further failed check output omitted: the aggregate feedback budget is spent"
                            .into(),
                    ),
                );
                break 'results;
            }
            let safe = !reference.is_empty()
                && reference.len() <= 128
                && !reference.contains("..")
                && reference
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.');
            if !safe {
                continue;
            }
            let Some(expected) = result.artifact_hashes.get(reference) else {
                continue;
            };
            opened += 1;
            let Some(verified) = read_verified_tail(
                &artifact_dir.join(format!("{reference}.log")),
                expected,
                &mut read_budget,
            ) else {
                continue;
            };
            let tail = redact_secrets(String::from_utf8_lossy(&verified.tail).trim(), secrets);
            if !tail.is_empty() {
                let mut text = if verified.truncated {
                    format!("…{tail}")
                } else {
                    tail
                };
                if verified.capped {
                    text.push_str(
                        " [artifact capped at the executor limit; output after the cap was not retained]",
                    );
                }
                // Budget the encoded form: escaped control bytes expand several-fold.
                quoted += serde_json::to_string(&text)
                    .map(|s| s.len())
                    .unwrap_or(text.len());
                output.insert(reference.clone(), Value::String(text));
            }
        }
    }
    output
}

/// Every configured provider credential value plus the service token: the
/// values the runtime itself holds and must never forward.
fn known_secrets(state: &AppState) -> Vec<String> {
    let mut secrets: Vec<String> = luuna_engine_pi::PROVIDER_KEY_VARIABLES
        .iter()
        .flat_map(|name| {
            [
                std::env::var(format!("LUUNA_PI_{name}")).ok(),
                std::env::var(name).ok(),
            ]
        })
        .flatten()
        .filter(|secret| secret.len() >= 8)
        .collect();
    secrets.push(state.config.token.clone());
    secrets
}

/// Replaces the runtime's own credential values and common secret shapes a
/// host-permission check could echo (PEM private key blocks, bearer headers,
/// well-known API token prefixes) before check output leaves the private
/// artifact store for a model prompt. This is best effort: native checks run
/// with host permissions and no isolation is claimed, so the manifest the
/// developer confirmed remains the boundary on what a check may read.
fn redact_secrets(text: &str, known: &[String]) -> String {
    let mut output = text.to_owned();
    for secret in known.iter().filter(|secret| secret.len() >= 8) {
        if output.contains(secret.as_str()) {
            output = output.replace(secret.as_str(), "[redacted credential]");
        }
    }
    output = redact_pem_blocks(&output);
    output
        .split('\n')
        .map(|line| {
            if line_carries_token(line) {
                "[redacted token-like line]"
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Removes every `-----BEGIN … PRIVATE KEY-----` block through its matching
/// `-----END … PRIVATE KEY-----` line, or to the end of the text when the
/// block is cut off by the quoted tail.
fn redact_pem_blocks(text: &str) -> String {
    const MARKER: &str = "PRIVATE KEY-----";
    let mut output = text.to_owned();
    let mut cursor = 0;
    while let Some(begin) = output[cursor..].find("-----BEGIN ") {
        let start = cursor + begin;
        let Some(header) = output[start..].find(MARKER) else {
            break;
        };
        let header_end = start + header + MARKER.len();
        let end = output[header_end..]
            .find("-----END ")
            .and_then(|e| {
                let footer = header_end + e;
                output[footer..]
                    .find(MARKER)
                    .map(|m| footer + m + MARKER.len())
            })
            .unwrap_or(output.len());
        const REPLACEMENT: &str = "[redacted private key]";
        output.replace_range(start..end, REPLACEMENT);
        cursor = start + REPLACEMENT.len();
    }
    output
}

/// Whether a line looks like it carries a credential: a bearer header, a
/// private-key assignment, or a well-known token prefix at a word boundary
/// followed by a long run of token characters.
fn line_carries_token(line: &str) -> bool {
    const PREFIXES: [&str; 9] = [
        "sk-",
        "AKIA",
        "ghp_",
        "gho_",
        "github_pat_",
        "glpat-",
        "xoxb-",
        "xoxp-",
        "AIza",
    ];
    let lowered = line.to_ascii_lowercase();
    if lowered.contains("authorization: bearer ") || lowered.contains("private_key") {
        return true;
    }
    PREFIXES.iter().any(|prefix| {
        line.match_indices(prefix).any(|(at, _)| {
            let boundary = line[..at]
                .chars()
                .next_back()
                .is_none_or(|c| !c.is_ascii_alphanumeric());
            let run = line[at + prefix.len()..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
                .count();
            boundary && run >= 20
        })
    })
}

struct VerifiedTail {
    tail: Vec<u8>,
    /// Earlier content exists beyond the quoted tail.
    truncated: bool,
    /// The artifact reached the executor's size cap, so the command's real end
    /// of output was never stored.
    capped: bool,
}

/// The last `REPAIR_OUTPUT_TAIL_BYTES` of a private artifact whose current
/// content still matches the digest recorded with the check result. A symlink,
/// a non-file, an oversized file or a digest mismatch yields nothing: native
/// checks run with host permissions, so bytes that no longer match the durable
/// evidence must not reach a model prompt.
fn read_verified_tail(
    path: &FsPath,
    expected_hash: &str,
    read_budget: &mut u64,
) -> Option<VerifiedTail> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > luuna_executor::MAX_ARTIFACT_BYTES
        || metadata.len() > *read_budget
    {
        return None;
    }
    *read_budget -= metadata.len();
    let bytes = std::fs::read(path).ok()?;
    if luuna_executor::sha256_hex(&bytes) != expected_hash {
        return None;
    }
    let capped = bytes.len() as u64 == luuna_executor::MAX_ARTIFACT_BYTES;
    let start = bytes.len().saturating_sub(REPAIR_OUTPUT_TAIL_BYTES);
    Some(VerifiedTail {
        tail: bytes[start..].to_vec(),
        truncated: start > 0,
        capped,
    })
}

fn writer_system_prompt(job: &WriterJob, worktree: &FsPath) -> String {
    let operations: Vec<String> = job
        .task
        .operations
        .iter()
        .map(|op| format!("{op:?}").to_lowercase())
        .collect();
    format!(
        "You are the Luuna writer for task `{task}` in repository `{repo}`.\n\
         Your working directory `{worktree}` is a Luuna-owned detached worktree at commit {base}; it is not the developer's checkout.\n\
         You may only create or change files under these paths, relative to the working directory: {paths}.\n\
         Permitted operations: {operations}. You have no shell. Every tool call outside the allowed paths is blocked and the attempt is rejected if the final diff leaves them.\n\
         Acceptance criteria: {criteria}\n\
         Make the smallest change that satisfies the acceptance criteria, then stop with a short summary of what you changed. Do not describe work you did not do.",
        task = job.task.id,
        repo = job.task.repository_id,
        worktree = worktree.display(),
        base = job.plan.base_commits.get(&job.task.repository_id).cloned().unwrap_or_default(),
        paths = job.task.paths.join(", "),
        operations = operations.join(", "),
        criteria = job.task.acceptance_criteria.join(" | "),
    )
}

fn writer_prompt(job: &WriterJob) -> String {
    let criteria: Vec<String> = job
        .task
        .acceptance_criteria
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{}. {c}", i + 1))
        .collect();
    format!(
        "Ticket: {title}\n\n{intent}\n\nAcceptance criteria:\n{criteria}",
        title = job.ticket.title,
        intent = format_args!(
            "{}\n\n{}",
            job.ticket.intent,
            job.repair_feedback.as_deref().unwrap_or("")
        ),
        criteria = criteria.join("\n")
    )
}

enum Outcome {
    Settled,
    Failed(String),
    Cancelled,
    Timeout,
}

async fn writer_worker(state: AppState, job: WriterJob, mut cancel: watch::Receiver<bool>) {
    let run_id = job.run_id.clone();
    let attempt_id = job.attempt.id.clone();
    let repository_id = job.task.repository_id.clone();
    let base = job
        .previous_candidate
        .as_ref()
        .and_then(|candidate| candidate.repository_commits.get(&repository_id))
        .or_else(|| job.plan.base_commits.get(&repository_id))
        .cloned()
        .unwrap_or_default();
    let settle = |state: &AppState,
                  attempt_state: AttemptState,
                  run_state: RunState,
                  lease: Option<(&str, LeaseState, Option<&str>)>,
                  reason: &str,
                  extra: Value| {
        let mut payload = json!({"reason": reason});
        if let (Value::Object(target), Value::Object(extra)) = (&mut payload, extra) {
            target.extend(extra);
        }
        if let Ok(mut store) = state.store.lock() {
            if let Some((lease_id, lease_state, candidate)) = lease {
                let _ =
                    store.release_worktree_lease(lease_id, lease_state, candidate, Some(reason));
            }
            let _ = store.finish_attempt(&attempt_id, attempt_state, payload.clone());
        }
        let _ = state.finish(&run_id, run_state, payload);
    };
    if *cancel.borrow() {
        settle(
            &state,
            AttemptState::Cancelled,
            RunState::Cancelled,
            None,
            "cancelled before startup",
            json!({}),
        );
        return;
    }
    // Lease first so the path is reserved durably, then create the worktree.
    let attempt_dir = state.config.data_dir.join("attempts").join(&job.attempt.id);
    let worktree = state
        .config
        .data_dir
        .join("worktrees")
        .join(&job.run_id)
        .join(&job.attempt.id)
        .join(&repository_id);
    let lease = WorktreeLease {
        id: format!("lease-{}", uuid::Uuid::new_v4()),
        run_id: job.run_id.clone(),
        project_id: job.plan.project_id.clone(),
        repository_id: repository_id.clone(),
        path: worktree.to_string_lossy().into_owned(),
        base_commit: base.clone(),
        state: LeaseState::Active,
        candidate_commit: None,
        created_at: now(),
        released_at: None,
        reason: None,
    };
    let leased = state
        .store
        .lock()
        .map_err(|_| "store poisoned".to_owned())
        .and_then(|mut store| {
            store
                .acquire_worktree_lease(&lease)
                .map_err(|e| e.to_string())
        });
    if let Err(error) = leased {
        settle(
            &state,
            AttemptState::Failed,
            RunState::Failed,
            None,
            &format!("worktree lease refused: {error}"),
            json!({}),
        );
        return;
    }
    let lease_id = lease.id.clone();
    let root = PathBuf::from(&job.registration.local_path);
    if let Err(error) = state
        .git
        .add_detached_worktree(&root, &worktree, &base)
        .await
    {
        settle(
            &state,
            AttemptState::Failed,
            RunState::Failed,
            Some((&lease_id, LeaseState::Released, None)),
            &format!("cannot create worktree: {error}"),
            json!({}),
        );
        return;
    }
    let _ = state.event(
        &job.run_id,
        "worktree.created",
        json!({"lease_id": lease_id, "repository_id": repository_id, "path": lease.path, "base_commit": base}),
    );
    let guard = match install_scope_guard(&attempt_dir.join("pi")) {
        Ok(path) => path,
        Err(error) => {
            settle(
                &state,
                AttemptState::Failed,
                RunState::Failed,
                Some((&lease_id, LeaseState::Released, None)),
                &format!("cannot install scope guard: {error}"),
                json!({}),
            );
            return;
        }
    };
    let mut tools: Vec<String> = Vec::new();
    if job.task.operations.contains(&Operation::Read) {
        tools.extend(["read", "grep", "find", "ls"].map(String::from));
    }
    if job.task.operations.contains(&Operation::Write) {
        tools.extend(["edit", "write"].map(String::from));
    }
    let scope = json!({
        "root": worktree.to_string_lossy(),
        "paths": job.task.paths,
        "operations": job.task.operations,
    });
    let config = PiConfig {
        program: state.config.pi_program.clone(),
        launcher_args: state.config.pi_launcher_args.clone(),
        cwd: worktree.clone(),
        config_dir: attempt_dir.join("pi"),
        provider: job.provider.clone(),
        model: job.model.clone(),
        profile: SessionProfile::Writer(WriterProfile {
            tools: tools.clone(),
            system_prompt: writer_system_prompt(&job, &worktree),
            extensions: vec![guard.clone()],
            environment: vec![("LUUNA_SCOPE_JSON".into(), scope.to_string())],
        }),
    };
    let spawned = tokio::select! {
        biased;
        _ = cancel.changed() => {
            settle(&state, AttemptState::Cancelled, RunState::Cancelled, Some((&lease_id, LeaseState::Released, None)), "cancelled during startup; worktree preserved", json!({}));
            return;
        }
        spawned = PiProcess::spawn(&config) => spawned,
    };
    let mut process = match spawned {
        Ok(process) => process,
        Err(error) => {
            settle(
                &state,
                AttemptState::Failed,
                RunState::Failed,
                Some((&lease_id, LeaseState::Released, None)),
                &format!("cannot start Pi: {error}"),
                json!({}),
            );
            return;
        }
    };
    let _ = state.event(
        &job.run_id,
        "pi.spawned",
        json!({"pid": process.pid(), "pi_version": PI_VERSION, "tools": tools, "scope_guard": guard.to_string_lossy(), "scope": scope, "provider_credentials": luuna_engine_pi::configured_provider_keys()}),
    );
    let started = std::time::Instant::now();
    let budgets = job.plan.budgets.clone();
    let previous_usage = match state
        .store
        .lock()
        .map_err(|e| e.to_string())
        .and_then(|store| store.workflow_usage(&run_id).map_err(|e| e.to_string()))
    {
        Ok(usage) => usage,
        Err(error) => {
            let _ = process.stop().await;
            settle(
                &state,
                AttemptState::Failed,
                RunState::Failed,
                Some((&lease_id, LeaseState::Released, None)),
                &format!("cannot load durable usage: {error}"),
                json!({}),
            );
            return;
        }
    };
    let mut usage = BudgetUsage {
        attempts: job.attempt.number,
        workers: 1,
        elapsed_seconds: previous_usage.elapsed_seconds,
        cost_usd_micros: previous_usage.cost_usd_micros,
    };
    let remaining_seconds = budgets
        .timeout_seconds
        .saturating_sub(previous_usage.elapsed_seconds);
    let mut writer_cost = 0u64;
    let mut session_usage = luuna_engine_pi::SessionUsage::default();
    let operation = async {
        process
            .command("state-1", "get_state", json!({}))
            .await
            .map_err(|e| e.to_string())?;
        let handshake = tokio::time::timeout(Duration::from_secs(15), process.next())
            .await
            .map_err(|_| "Pi startup timed out".to_owned())?
            .map_err(|e| e.to_string())?;
        if handshake.kind != "response"
            || handshake.raw["id"] != "state-1"
            || handshake.raw["success"] != true
        {
            return Err("Pi startup handshake rejected".to_owned());
        }
        process
            .command(
                "prompt-1",
                "prompt",
                json!({"message": writer_prompt(&job)}),
            )
            .await
            .map_err(|e| e.to_string())?;
        let mut failure: Option<String> = None;
        let mut accepted = false;
        loop {
            let record = process.next().await.map_err(|e| e.to_string())?;
            if record.kind == "extension_error" {
                return Err("scope extension failed; session refused".to_owned());
            }
            state
                .event(
                    &job.run_id,
                    &format!("pi.{}", record.kind),
                    bounded(record.raw.clone()),
                )
                .map_err(|_| "cannot persist event".to_owned())?;
            writer_cost = session_usage.observe(&record);
            usage.cost_usd_micros = previous_usage.cost_usd_micros.saturating_add(writer_cost);
            usage.elapsed_seconds = previous_usage
                .elapsed_seconds
                .saturating_add(started.elapsed().as_secs());
            if let Err(error) = budgets.check(usage) {
                return Err(error.to_string());
            }
            if record.kind == "response" && record.raw["id"] == "prompt-1" {
                if record.raw["success"] != true {
                    return Err(record.raw["error"]
                        .as_str()
                        .unwrap_or("prompt rejected")
                        .to_owned());
                }
                if record.raw["data"]["disposition"] == "handled" {
                    return Err("prompt was handled without starting model work".to_owned());
                }
                accepted = true;
            }
            if record.kind == "extension_ui_request" {
                return Err("writer requested interactive input; refused".to_owned());
            }
            if record.kind == "message_end" && record.raw["message"]["role"] == "assistant" {
                failure = record.model_error();
            }
            if record.kind == "agent_end" && record.raw["willRetry"] != true {
                if let Some(error) = record.model_error() {
                    failure = Some(error);
                }
            }
            if record.kind == "agent_settled" {
                if !accepted {
                    return Err("model settled before prompt acknowledgement".to_owned());
                }
                if record.raw["aborted"] == true {
                    return Err("provider run aborted".to_owned());
                }
                return failure.map_or(Ok(()), Err);
            }
        }
    };
    let outcome = tokio::select! {
        biased;
        _ = cancel.changed() => Outcome::Cancelled,
        result = tokio::time::timeout(Duration::from_secs(remaining_seconds), operation) => match result {
            Ok(Ok(())) => Outcome::Settled,
            Ok(Err(error)) => Outcome::Failed(error),
            Err(_) => Outcome::Timeout,
        },
    };
    // The child is stopped and reaped before any verdict is persisted.
    let stopped = process.stop().await;
    let usage_json = json!({"elapsed_seconds": started.elapsed().as_secs(), "cost_usd_micros": writer_cost, "attempt": job.attempt.number});
    if let Err(error) = stopped {
        settle(
            &state,
            AttemptState::Failed,
            RunState::Failed,
            Some((&lease_id, LeaseState::Released, None)),
            &format!("process cleanup failed: {error}"),
            usage_json,
        );
        return;
    }
    if *cancel.borrow() {
        settle(
            &state,
            AttemptState::Cancelled,
            RunState::Cancelled,
            Some((&lease_id, LeaseState::Released, None)),
            "cancelled before candidate judgement; worktree preserved",
            usage_json,
        );
        return;
    }
    match outcome {
        Outcome::Cancelled => {
            settle(
                &state,
                AttemptState::Cancelled,
                RunState::Cancelled,
                Some((&lease_id, LeaseState::Released, None)),
                "abort requested; Pi reaped, worktree preserved",
                usage_json,
            );
            return;
        }
        Outcome::Timeout => {
            settle(
                &state,
                AttemptState::Failed,
                RunState::Failed,
                Some((&lease_id, LeaseState::Released, None)),
                &format!(
                    "budget exceeded: timeout_seconds {} elapsed; worktree preserved",
                    budgets.timeout_seconds
                ),
                usage_json,
            );
            return;
        }
        Outcome::Failed(reason) => {
            settle(
                &state,
                AttemptState::Failed,
                RunState::Failed,
                Some((&lease_id, LeaseState::Released, None)),
                &format!("{reason}; worktree preserved"),
                usage_json,
            );
            return;
        }
        Outcome::Settled => {}
    }
    // Judge what actually changed, as the repository reports it.
    let changes = match state.git.changed_paths(&worktree).await {
        Ok(changes) => changes,
        Err(error) => {
            settle(
                &state,
                AttemptState::Failed,
                RunState::Failed,
                Some((&lease_id, LeaseState::Released, None)),
                &format!("cannot inspect worktree changes: {error}; worktree preserved"),
                usage_json,
            );
            return;
        }
    };
    let _ = state.event(
        &job.run_id,
        "worktree.changes",
        json!({"lease_id": lease_id, "changes": changes}),
    );
    if let Err(violation) = check_scope(&changes, &job.task, &job.plan.permissions) {
        settle(
            &state,
            AttemptState::Failed,
            RunState::Failed,
            Some((&lease_id, LeaseState::Released, None)),
            &format!("{violation}; no candidate recorded, worktree preserved for inspection"),
            json!({"changes": changes, "usage": usage_json}),
        );
        return;
    }
    if changes.is_empty() {
        settle(
            &state,
            AttemptState::Failed,
            RunState::Failed,
            Some((&lease_id, LeaseState::Released, None)),
            "writer settled without changing any file",
            usage_json,
        );
        return;
    }
    let message = format!(
        "Luuna candidate for ticket {} task {} (plan {}@{})",
        job.ticket.id, job.task.id, job.plan.id, job.plan.revision
    );
    let commit = match state.git.commit_all(&worktree, &message).await {
        Ok(commit) => commit,
        Err(error) => {
            settle(
                &state,
                AttemptState::Failed,
                RunState::Failed,
                Some((&lease_id, LeaseState::Released, None)),
                &format!("cannot record candidate commit: {error}; worktree preserved"),
                usage_json,
            );
            return;
        }
    };
    let candidate = CandidateSet {
        schema_version: SCHEMA_VERSION.into(),
        id: job
            .previous_candidate
            .as_ref()
            .map(|c| c.id.clone())
            .unwrap_or_else(|| format!("candidate-{}", uuid::Uuid::new_v4())),
        revision: job
            .previous_candidate
            .as_ref()
            .map(|c| c.revision + 1)
            .unwrap_or(1),
        plan_hash: job.plan.hash.clone(),
        repository_commits: BTreeMap::from([(repository_id.clone(), commit.clone())]),
        dependency_bindings: BTreeMap::new(),
        hash: String::new(),
    };
    let candidate = match candidate.computed_hash() {
        Ok(hash) => CandidateSet { hash, ..candidate },
        Err(error) => {
            settle(
                &state,
                AttemptState::Failed,
                RunState::Failed,
                Some((&lease_id, LeaseState::Released, Some(&commit))),
                &format!("cannot hash candidate: {error}"),
                usage_json,
            );
            return;
        }
    };
    let tree = match state.git.commit_tree(&worktree, &commit).await {
        Ok(tree) => tree,
        Err(error) => {
            settle(
                &state,
                AttemptState::Failed,
                RunState::Failed,
                Some((&lease_id, LeaseState::Released, Some(&commit))),
                &format!("cannot identify candidate tree: {error}"),
                usage_json,
            );
            return;
        }
    };
    if *cancel.borrow() {
        settle(
            &state,
            AttemptState::Cancelled,
            RunState::Cancelled,
            Some((&lease_id, LeaseState::Released, Some(&commit))),
            "cancelled before candidate verdict; committed worktree preserved",
            usage_json,
        );
        return;
    }
    let recorded = (|| -> Result<(), String> {
        let mut store = state.store.lock().map_err(|e| e.to_string())?;
        store
            .release_worktree_lease(
                &lease_id,
                LeaseState::Released,
                Some(&commit),
                Some("candidate preserved for checks and review"),
            )
            .map_err(|e| e.to_string())?;
        store
            .finish_attempt(
                &attempt_id,
                AttemptState::Completed,
                json!({"candidate_hash":candidate.hash,"commit":commit,"usage":usage_json}),
            )
            .map_err(|e| e.to_string())?;
        let run = store
            .get_run(&run_id)
            .map_err(|e| e.to_string())?
            .ok_or("run missing")?;
        store
            .record_candidate(
                &run_id,
                run.revision,
                &candidate,
                &BTreeMap::from([(repository_id, tree)]),
                &attempt_id,
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(error) = recorded {
        let _ = state.finish(
            &run_id,
            RunState::Failed,
            json!({"reason":format!("cannot persist candidate: {error}")}),
        );
    }
}

#[cfg(test)]
mod redaction_tests {
    use super::*;

    #[test]
    fn known_values_pem_blocks_and_token_lines_are_removed() {
        let known = vec!["configured-provider-value".to_owned()];
        let text = "ok line\nkey=configured-provider-value\n-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\nAuthorization: Bearer abc\ntoken sk-abcdefghijklmnopqrstuvwxyz0123\ndisk-usage report line";
        let out = redact_secrets(text, &known);
        assert_eq!(
            out,
            "ok line\nkey=[redacted credential]\n[redacted private key]\n[redacted token-like line]\n[redacted token-like line]\ndisk-usage report line"
        );
    }

    #[test]
    fn a_cut_off_pem_block_is_removed_to_the_end() {
        let out = redact_secrets("x\n-----BEGIN PRIVATE KEY-----\nMIIE", &[]);
        assert_eq!(out, "x\n[redacted private key]");
    }

    fn failed_result(
        artifact_dir: &FsPath,
        index: usize,
        body: &[u8],
    ) -> luuna_domain::CheckResult {
        let reference = format!("c1-g1-check{index}");
        std::fs::write(artifact_dir.join(format!("{reference}.log")), body).unwrap();
        luuna_domain::CheckResult {
            schema_version: "0.1".into(),
            id: format!("result-{index}"),
            run_id: "run".into(),
            repository_id: "app".into(),
            recipe_id: format!("check{index}"),
            candidate_hash: "sha256:0".into(),
            commit: "0".repeat(40),
            environment_fingerprint: "env".into(),
            command: vec!["true".into()],
            status: CheckStatus::Failed,
            exit_code: Some(1),
            artifact_refs: vec![reference.clone()],
            cwd: ".".into(),
            started_at: None,
            finished_at: None,
            reason: Some("exit code 1".into()),
            artifact_hashes: [(reference, luuna_executor::sha256_hex(body))].into(),
            tests_detected: None,
        }
    }

    #[test]
    fn the_aggregate_feedback_budget_is_measured_after_json_encoding() {
        let dir = tempfile::tempdir().unwrap();
        // Each tail is 2 KiB of NUL bytes, which encode six-fold as `\u0000`.
        let results: Vec<_> = (0..REPAIR_ARTIFACT_LIMIT)
            .map(|i| failed_result(dir.path(), i, &[b'x', 0u8].repeat(REPAIR_OUTPUT_TAIL_BYTES)))
            .collect();
        let output = repair_check_output(dir.path(), &results, &[]);
        let encoded = serde_json::to_string(&output).unwrap();
        assert!(output.contains_key("truncated"), "{encoded:.200}");
        // The budget plus at most one over-running entry and the marker.
        let bound = REPAIR_OUTPUT_TOTAL_BYTES + 8 * REPAIR_OUTPUT_TAIL_BYTES + 512;
        assert!(encoded.len() <= bound, "{} > {bound}", encoded.len());
        assert!(output.len() < REPAIR_ARTIFACT_LIMIT);
    }

    #[test]
    fn artifact_verification_stops_at_the_artifact_limit_even_for_empty_tails() {
        let dir = tempfile::tempdir().unwrap();
        let results: Vec<_> = (0..REPAIR_ARTIFACT_LIMIT + 5)
            .map(|i| failed_result(dir.path(), i, b"   "))
            .collect();
        let output = repair_check_output(dir.path(), &results, &[]);
        assert_eq!(output.len(), 1, "{output:?}");
        assert!(output.contains_key("truncated"));
    }

    #[test]
    fn short_prefix_matches_are_left_alone() {
        assert!(!line_carries_token("sk-1 is a label"));
        assert!(!line_carries_token("task-abcdefghijklmnopqrstuvwxyz"));
        assert!(line_carries_token("AKIAABCDEFGHIJKLMNOPQRST"));
    }
}
