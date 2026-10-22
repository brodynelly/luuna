//! M4: the task-graph scheduler. A plan with several tasks runs each task as
//! one writer attempt in its own Luuna-owned worktree of its repository, in
//! dependency order, concurrently up to the plan's `max_workers` and never
//! more than one writer per repository. A consumer task's writer and its
//! repository's checks receive every completed producer's candidate worktree
//! and commit as `LUUNA_DEPENDENCY_<REPOSITORY>_PATH`/`…_COMMIT`. When every
//! task has completed, one candidate set freezes every repository's exact
//! commit and the producer bindings, and the run waits in `validating` as a
//! single-repository run does. Per-task state is durable (migration 10), so a
//! restart shows the graph and an interrupted or failed task is resumed by
//! `POST /api/v1/runs/{id}/implement` naming `task_id`.
use crate::{
    baselines::{artifact_dir, probe_fingerprint},
    internal, not_found,
    projects::storage_error,
    writer::{GraphContext, Implement, TaskOutcome, WriterJob},
    ApiError, AppState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use luuna_domain::{
    dependency_binding_key, CandidateSet, PlanRevision, RunState, TaskRole, TaskState,
    SCHEMA_VERSION,
};
use luuna_engine_pi::PI_VERSION;
use luuna_storage::{RepositoryRegistration, RunRecord, StorageError, TaskRecord};
use serde_json::json;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
};
use tokio::sync::watch;

fn unprocessable(message: impl Into<String>) -> ApiError {
    ApiError(StatusCode::UNPROCESSABLE_ENTITY, message.into())
}
fn conflict(message: impl Into<String>) -> ApiError {
    ApiError(StatusCode::CONFLICT, message.into())
}

/// `GET /api/v1/runs/{id}/tasks`: every task of the run's plan graph with its
/// durable state. A single-task workflow started before its graph state
/// existed, or one that never entered implementation, lists nothing.
pub async fn list_tasks(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<TaskRecord>>, ApiError> {
    let store = state.store.lock().map_err(internal)?;
    store
        .get_run(&id)
        .map_err(internal)?
        .ok_or_else(not_found)?;
    Ok(Json(store.run_tasks(&id).map_err(internal)?))
}

/// Schedule a plan's task graph, or resume it. Everything that can be refused
/// is refused before any state changes, as for a single writer: the
/// approval, ticket, manifest and baseline bindings are rechecked
/// transactionally with one host fingerprint per repository, every task
/// repository must still be at its planned base with no other writer, and
/// the remaining attempt budget must hold every task that will run.
pub(crate) async fn implement_graph(
    state: AppState,
    id: String,
    request: Implement,
) -> Result<(StatusCode, Json<RunRecord>), ApiError> {
    let (run, plan, ticket, registrations, manifest, resume) = {
        let store = state.store.lock().map_err(internal)?;
        let run = store
            .get_run(&id)
            .map_err(internal)?
            .ok_or_else(not_found)?;
        let plan = store
            .get_plan(
                run.metadata["plan_id"].as_str().unwrap_or_default(),
                run.metadata["plan_revision"].as_u64().unwrap_or_default(),
            )
            .map_err(internal)?
            .ok_or_else(|| unprocessable("the workflow's plan revision is missing"))?;
        if let Some(task_id) = &request.task_id {
            if !plan.tasks.iter().any(|t| &t.id == task_id) {
                return Err(unprocessable("task is not part of the plan"));
            }
        }
        let recorded = store.run_tasks(&id).map_err(internal)?;
        let resume = match run.state {
            RunState::Approved => None,
            RunState::Interrupted | RunState::Failed if !recorded.is_empty() => {
                let Some(task_id) = request.task_id.clone() else {
                    return Err(conflict(format!(
                        "workflow is {:?}; name the interrupted, failed or blocked task_id to resume its task graph (completed tasks keep their commits), or create the next plan revision",
                        run.state
                    )));
                };
                let task = recorded
                    .iter()
                    .find(|t| t.task_id == task_id)
                    .ok_or_else(|| unprocessable("task has no recorded state"))?;
                if !matches!(
                    task.state,
                    TaskState::Interrupted | TaskState::Failed | TaskState::Blocked
                ) {
                    return Err(conflict(format!(
                        "task {task_id} is {:?}; only an interrupted, failed or blocked task resumes the graph",
                        task.state
                    )));
                }
                Some(task_id)
            }
            other => {
                return Err(conflict(format!(
                    "workflow is {other:?}; an exact approval is required before implementation"
                )));
            }
        };
        let ticket = store
            .get_ticket(&plan.ticket_id)
            .map_err(internal)?
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "ticket not found".into()))?;
        let registered = store.repositories(&plan.project_id).map_err(internal)?;
        let mut registrations = BTreeMap::new();
        for task in &plan.tasks {
            let registration = registered
                .iter()
                .find(|r| r.repository_id == task.repository_id)
                .cloned()
                .ok_or_else(|| {
                    unprocessable(format!(
                        "task repository {} is not registered",
                        task.repository_id
                    ))
                })?;
            registrations.insert(task.repository_id.clone(), registration);
        }
        let manifest = store
            .current_manifest(&plan.project_id)
            .map_err(internal)?
            .ok_or_else(|| unprocessable("the project has no confirmed manifest"))?;
        // Every task that will run is one attempt against the plan budget.
        let to_run = if recorded.is_empty() {
            plan.tasks.len()
        } else {
            recorded
                .iter()
                .filter(|t| t.state != TaskState::Completed)
                .count()
        };
        let used = store.attempts(&run.id).map_err(internal)?.len();
        if used + to_run > plan.budgets.max_attempts as usize {
            return Err(unprocessable(format!(
                "attempt budget exhausted: {to_run} task(s) would run but max_attempts {} leaves {} attempt(s); re-plan to continue",
                plan.budgets.max_attempts,
                (plan.budgets.max_attempts as usize).saturating_sub(used)
            )));
        }
        // An attempt lost to a restart reserved the remaining approved time
        // and cost (ADR 0009 point 5): a graph with no headroom left is
        // refused here with its re-plan requirement rather than started.
        let usage = store.workflow_usage(&run.id).map_err(internal)?;
        if usage.elapsed_seconds >= plan.budgets.timeout_seconds
            || usage.cost_usd_micros >= plan.budgets.cost_usd_micros
        {
            return Err(unprocessable(format!(
                "workflow time or cost budget exhausted ({}s of {}s, {} of {} µUSD); an attempt interrupted by a restart reserves the remaining budget, so re-plan to continue",
                usage.elapsed_seconds, plan.budgets.timeout_seconds, usage.cost_usd_micros, plan.budgets.cost_usd_micros
            )));
        }
        let leases = store.active_worktree_leases().map_err(internal)?;
        for task in &plan.tasks {
            if leases
                .iter()
                .any(|l| l.project_id == plan.project_id && l.repository_id == task.repository_id)
            {
                return Err(conflict(format!(
                    "repository {} already has an active writer; one writer per repository",
                    task.repository_id
                )));
            }
        }
        (run, plan, ticket, registrations, manifest, resume)
    };
    let _components = state.component_locks.lock().await;
    crate::missions::ensure_current(&state, &ticket).await?;
    let component_resources = crate::integrations::resolve_approved(
        &state,
        &plan.project_id,
        plan.component_context.as_ref(),
    )
    .await?;
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
    // Every task repository must still be at its planned base, with its
    // registered identity; each repository's required recipes fingerprint
    // the host separately, as its baseline did.
    let mut fingerprints = BTreeMap::new();
    for (repository_id, registration) in &registrations {
        let root = PathBuf::from(&registration.local_path);
        let observation = state.git.inspect(&root).await.map_err(|e| {
            unprocessable(format!("repository {repository_id} inspection failed: {e}"))
        })?;
        registration
            .observation
            .identity
            .matches(&observation.identity)
            .map_err(|e| crate::projects::identity_changed(&plan.project_id, repository_id, e))?;
        let base = plan
            .base_commits
            .get(repository_id)
            .cloned()
            .unwrap_or_default();
        if observation.head_commit != base {
            return Err(conflict(format!(
                "repository {repository_id} HEAD {} is no longer the planned base {base}; re-confirm the manifest and re-plan",
                observation.head_commit
            )));
        }
        let repository = manifest
            .manifest
            .repositories
            .iter()
            .find(|r| &r.id == repository_id)
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
        fingerprints.insert(repository_id.clone(), fingerprint);
    }
    crate::missions::ensure_current(&state, &ticket).await?;
    crate::integrations::resolve_approved(
        &state,
        &plan.project_id,
        plan.component_context.as_ref(),
    )
    .await?;
    let (tx, rx) = watch::channel(false);
    let run = {
        let mut active = state.active.lock().map_err(internal)?;
        if active.contains_key(&run.id) {
            return Err(conflict("this workflow already has active work"));
        }
        if active.len() >= 4 {
            return Err(ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "four runs are already active".into(),
            ));
        }
        let (run, _) = state
            .store
            .lock()
            .map_err(internal)?
            .begin_graph_implementation(&run.id, run.revision, &fingerprints, resume.as_deref())
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
                StorageError::AlreadyExists(detail) => {
                    conflict(format!("implementation refused: {detail}"))
                }
                other => storage_error(other),
            })?;
        active.insert(run.id.clone(), tx);
        run
    };
    drop(_components);
    let scheduler = Scheduler {
        state: state.clone(),
        run_id: run.id.clone(),
        plan,
        ticket,
        registrations,
        provider,
        model,
        component_resources,
        fingerprints,
    };
    state.spawn_supervised(run.id.clone(), async move {
        scheduler.run(rx).await;
    });
    Ok((StatusCode::ACCEPTED, Json(run)))
}

struct Scheduler {
    state: AppState,
    run_id: String,
    plan: PlanRevision,
    ticket: luuna_domain::Ticket,
    registrations: BTreeMap<String, RepositoryRegistration>,
    provider: Option<String>,
    model: Option<String>,
    component_resources: Option<serde_json::Value>,
    fingerprints: BTreeMap<String, String>,
}

impl Scheduler {
    fn tasks(&self) -> Result<BTreeMap<String, TaskRecord>, String> {
        let store = self.state.store.lock().map_err(|e| e.to_string())?;
        Ok(store
            .run_tasks(&self.run_id)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|task| (task.task_id.clone(), task))
            .collect())
    }

    fn settle(
        &self,
        task_id: &str,
        state: TaskState,
        reason: Option<&str>,
        candidate: Option<(&str, &str)>,
    ) {
        if let Ok(mut store) = self.state.store.lock() {
            let _ = store.settle_task(&self.run_id, task_id, state, reason, candidate);
        }
    }

    /// The preserved worktree that holds a completed task's commit.
    fn worktree_of(&self, repository_id: &str, commit: &str) -> Option<String> {
        let store = self.state.store.lock().ok()?;
        store
            .worktree_leases(&self.run_id)
            .ok()?
            .into_iter()
            .rev()
            .find(|l| {
                l.repository_id == repository_id && l.candidate_commit.as_deref() == Some(commit)
            })
            .map(|l| l.path)
    }

    /// Dependency-ordered dispatch until every task settled or the run was
    /// stopped. Tasks run on the bounded blocking pool like any owned
    /// worker; the whole graph shares the run's cancellation signal.
    async fn run(self, mut cancel: watch::Receiver<bool>) {
        let mut children: tokio::task::JoinSet<(String, TaskOutcome)> = tokio::task::JoinSet::new();
        let mut running: BTreeSet<String> = BTreeSet::new();
        let order: Vec<String> = match self.plan.dependency_order() {
            Ok(order) => order.iter().map(|t| t.id.clone()).collect(),
            Err(cycle) => {
                // Sealed plans are acyclic; a stored plan that is not is refused
                // rather than scheduled.
                let _ = self.state.finish(
                    &self.run_id,
                    RunState::Failed,
                    json!({"reason": format!("plan task graph has a cycle: {}", cycle.join(" -> "))}),
                );
                return;
            }
        };
        loop {
            let tasks = match self.tasks() {
                Ok(tasks) => tasks,
                Err(error) => {
                    let _ = self.state.finish(
                        &self.run_id,
                        RunState::Failed,
                        json!({"reason": format!("cannot load task graph state: {error}")}),
                    );
                    return;
                }
            };
            let stopping = *cancel.borrow();
            if !stopping {
                // Block queued tasks whose dependency can no longer complete,
                // naming the dependency and its reason.
                for id in &order {
                    let Some(task) = tasks.get(id) else { continue };
                    if task.state != TaskState::Queued || running.contains(id) {
                        continue;
                    }
                    let failed = task.depends_on.iter().find_map(|dependency| {
                        tasks.get(dependency).filter(|d| {
                            matches!(
                                d.state,
                                TaskState::Failed
                                    | TaskState::Blocked
                                    | TaskState::Cancelled
                                    | TaskState::Interrupted
                            )
                        })
                    });
                    if let Some(dependency) = failed {
                        let reason = format!(
                            "dependency task {} {}: {}",
                            dependency.task_id,
                            serde_json::to_value(dependency.state)
                                .ok()
                                .and_then(|v| v.as_str().map(ToOwned::to_owned))
                                .unwrap_or_default(),
                            dependency.reason.as_deref().unwrap_or("no reason recorded")
                        );
                        self.settle(id, TaskState::Blocked, Some(&reason), None);
                    }
                }
                // Dispatch every ready task within max_workers.
                let tasks = match self.tasks() {
                    Ok(tasks) => tasks,
                    Err(_) => continue,
                };
                for id in &order {
                    if running.len() >= self.plan.budgets.max_workers as usize {
                        break;
                    }
                    let Some(task) = tasks.get(id) else { continue };
                    if task.state != TaskState::Queued || running.contains(id) {
                        continue;
                    }
                    let ready = task.depends_on.iter().all(|dependency| {
                        tasks
                            .get(dependency)
                            .is_some_and(|d| d.state == TaskState::Completed)
                    });
                    if !ready {
                        continue;
                    }
                    // Never two writers in one repository, within this run or
                    // across runs (the lease itself is the durable rule).
                    if running.iter().any(|r| {
                        tasks
                            .get(r)
                            .is_some_and(|t| t.repository_id == task.repository_id)
                    }) {
                        continue;
                    }
                    match self.dispatch(task, &tasks, cancel.clone()) {
                        Ok(child) => {
                            running.insert(id.clone());
                            let runtime = tokio::runtime::Handle::current();
                            children.spawn_blocking(move || runtime.block_on(child));
                        }
                        Err(reason) => {
                            self.settle(id, TaskState::Failed, Some(&reason), None);
                        }
                    }
                }
            }
            if running.is_empty() {
                self.conclude(stopping).await;
                return;
            }
            // Wait for a task to settle, or for the stop signal (which the
            // running writers share, so they settle on their own).
            let settled = if stopping {
                children.join_next().await
            } else {
                tokio::select! {
                    biased;
                    _ = cancel.changed() => continue,
                    settled = children.join_next() => settled,
                }
            };
            let Some(settled) = settled else {
                running.clear();
                continue;
            };
            match settled {
                Ok((task_id, outcome)) => {
                    running.remove(&task_id);
                    match outcome {
                        TaskOutcome::Completed { commit, tree, .. } => {
                            self.settle(
                                &task_id,
                                TaskState::Completed,
                                None,
                                Some((&commit, &tree)),
                            );
                        }
                        TaskOutcome::Advised(result) => {
                            let recorded =
                                self.state.store.lock().map_err(|e| e.to_string()).and_then(
                                    |mut store| {
                                        store
                                            .settle_advisory_task(&self.run_id, &task_id, &result)
                                            .map_err(|e| e.to_string())
                                    },
                                );
                            if let Err(error) = recorded {
                                self.settle(
                                    &task_id,
                                    TaskState::Failed,
                                    Some(&format!("cannot record advisory result: {error}")),
                                    None,
                                );
                            }
                        }
                        TaskOutcome::Failed(reason) => {
                            self.settle(&task_id, TaskState::Failed, Some(&reason), None);
                        }
                        TaskOutcome::Stopped(reason) => {
                            let state = if self.state.shutting_down() {
                                TaskState::Interrupted
                            } else {
                                TaskState::Cancelled
                            };
                            self.settle(&task_id, state, Some(&reason), None);
                        }
                    }
                }
                Err(error) => {
                    // A panicked task worker: the supervisor and restart
                    // recovery settle attempts and leases; once no child is
                    // left, every task still recorded running is failed by
                    // name so the graph never shows it running.
                    if children.is_empty() {
                        for task_id in std::mem::take(&mut running) {
                            let still_running = self
                                .tasks()
                                .ok()
                                .and_then(|tasks| tasks.get(&task_id).map(|t| t.state))
                                == Some(TaskState::Running);
                            if still_running {
                                self.settle(
                                    &task_id,
                                    TaskState::Failed,
                                    Some(&format!("task worker stopped unexpectedly: {error}")),
                                    None,
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    /// Start one task's writer attempt: the attempt counts against the plan
    /// budget, the task is recorded `running`, and the job carries the
    /// completed producers' bindings.
    fn dispatch(
        &self,
        task: &TaskRecord,
        tasks: &BTreeMap<String, TaskRecord>,
        cancel: watch::Receiver<bool>,
    ) -> Result<impl std::future::Future<Output = (String, TaskOutcome)> + Send + 'static, String>
    {
        let plan_task = self
            .plan
            .tasks
            .iter()
            .find(|t| t.id == task.task_id)
            .cloned()
            .ok_or("task is not part of the plan")?;
        let registration = self
            .registrations
            .get(&task.repository_id)
            .cloned()
            .ok_or("task repository is not registered")?;
        let mut producers = Vec::new();
        let mut advisories = Vec::new();
        for dependency in &task.depends_on {
            let producer = tasks
                .get(dependency)
                .ok_or_else(|| format!("dependency {dependency} has no recorded state"))?;
            // An advisory producer binds no commit; its recorded result is
            // reference data for the dependent task's prompt (ADR 0023).
            if TaskRole::parse(&producer.role).is_some_and(TaskRole::is_advisory) {
                let result = producer.advisory_result.clone().ok_or_else(|| {
                    format!("advisory dependency {dependency} completed without a recorded result")
                })?;
                advisories.push((producer.task_id.clone(), producer.role.clone(), result));
                continue;
            }
            let commit = producer
                .candidate_commit
                .clone()
                .ok_or_else(|| format!("dependency {dependency} completed without a commit"))?;
            let worktree = self
                .worktree_of(&producer.repository_id, &commit)
                .ok_or_else(|| {
                    format!("dependency {dependency} has no preserved worktree for commit {commit}")
                })?;
            producers.push((
                producer.repository_id.clone(),
                producer.task_id.clone(),
                commit,
                worktree,
            ));
        }
        let attempt = {
            let mut store = self.state.store.lock().map_err(|e| e.to_string())?;
            let attempt = store
                .start_attempt(
                    &format!("attempt-{}", uuid::Uuid::new_v4()),
                    &self.run_id,
                    &task.task_id,
                    self.plan.budgets.max_attempts,
                    json!({
                        "provider": self.provider,
                        "model": self.model,
                        "environment_fingerprint": self.fingerprints.get(&task.repository_id),
                        "pi_version": PI_VERSION,
                        "trigger": "implement",
                        "task_id": task.task_id,
                        "repository_id": task.repository_id,
                        "role": task.role,
                        "assigned_by": task.assigned_by,
                        "derived_from_task": task.derived_from_task,
                        "dependency_overrides": task.dependency_overrides,
                        "depends_on": task.depends_on,
                        "dependency_commits": producers.iter().map(|(repository, _, commit, _)| (repository.clone(), commit.clone())).collect::<BTreeMap<_, _>>(),
                        "advisory_dependencies": advisories.iter().map(|(task, _, _)| task.clone()).collect::<Vec<_>>(),
                    }),
                )
                .map_err(|e| e.to_string())?;
            store
                .schedule_task(&self.run_id, &task.task_id, &attempt.id)
                .map_err(|e| e.to_string())?;
            attempt
        };
        let job = WriterJob {
            run_id: self.run_id.clone(),
            attempt,
            plan: self.plan.clone(),
            task: plan_task,
            ticket: self.ticket.clone(),
            registration,
            provider: self.provider.clone(),
            model: self.model.clone(),
            previous_candidate: None,
            history_clean: false,
            repair_feedback: None,
            preparation_seconds: 0,
            component_resources: self.component_resources.clone(),
            graph: Some(GraphContext {
                producers,
                advisories,
            }),
        };
        let state = self.state.clone();
        let task_id = task.task_id.clone();
        Ok(async move {
            let outcome = crate::writer::writer_worker(state, job, cancel).await;
            (task_id, outcome)
        })
    }

    /// Every task settled: record the candidate set when all completed, or
    /// settle the run with the tasks that did not.
    async fn conclude(&self, stopping: bool) {
        let tasks = match self.tasks() {
            Ok(tasks) => tasks,
            Err(error) => {
                let _ = self.state.finish(
                    &self.run_id,
                    RunState::Failed,
                    json!({"reason": format!("cannot load task graph state: {error}")}),
                );
                return;
            }
        };
        if stopping {
            // Queued tasks never started; the running ones settled themselves.
            let stop_state = if self.state.shutting_down() {
                TaskState::Interrupted
            } else {
                TaskState::Cancelled
            };
            for task in tasks.values() {
                if task.state == TaskState::Queued {
                    self.settle(
                        &task.task_id,
                        stop_state,
                        Some(&self.state.stop_reason("stopped before the task started")),
                        None,
                    );
                }
            }
            let _ = self.state.finish(
                &self.run_id,
                self.state.stop_run_state(),
                json!({"reason": self.state.stop_reason("task graph stopped; completed tasks keep their commits and worktrees, interrupted tasks resume by task_id")}),
            );
            return;
        }
        let incomplete: Vec<&TaskRecord> = tasks
            .values()
            .filter(|t| t.state != TaskState::Completed)
            .collect();
        if !incomplete.is_empty() {
            let named: Vec<String> = incomplete
                .iter()
                .map(|t| {
                    format!(
                        "{} ({}): {}",
                        t.task_id,
                        serde_json::to_value(t.state)
                            .ok()
                            .and_then(|v| v.as_str().map(ToOwned::to_owned))
                            .unwrap_or_default(),
                        t.reason.as_deref().unwrap_or("no reason recorded")
                    )
                })
                .collect();
            let interrupted = incomplete.iter().any(|t| t.state == TaskState::Interrupted);
            let _ = self.state.finish(
                &self.run_id,
                if interrupted {
                    RunState::Interrupted
                } else {
                    RunState::Failed
                },
                json!({"reason": format!("task graph did not complete: {}; completed tasks keep their commits and worktrees; resume with implement naming task_id or create the next plan revision", named.join("; ")), "tasks": tasks.values().collect::<Vec<_>>()}),
            );
            return;
        }
        // Advisory tasks froze nothing: a plan of advisory tasks only
        // completes with their recorded results and no candidate (ADR 0023);
        // the next plan revision carries what the developer adopts.
        let advisory =
            |task: &&TaskRecord| TaskRole::parse(&task.role).is_some_and(TaskRole::is_advisory);
        if tasks.values().all(|task| advisory(&task)) {
            let _ = self.state.finish(
                &self.run_id,
                RunState::Completed,
                json!({"reason": "every task of this plan is advisory; their results are recorded on the tasks and no candidate exists, so create the next plan revision from the proposals you adopt (derived_from_task names the advisory task)", "tasks": tasks.values().collect::<Vec<_>>()}),
            );
            return;
        }
        let mut repository_commits = BTreeMap::new();
        let mut repository_trees = BTreeMap::new();
        let mut dependency_bindings = BTreeMap::new();
        let mut implementer = None;
        for task in tasks.values().filter(|task| !advisory(task)) {
            let (Some(commit), Some(tree)) = (&task.candidate_commit, &task.candidate_tree) else {
                let _ = self.state.finish(
                    &self.run_id,
                    RunState::Failed,
                    json!({"reason": format!("completed task {} has no recorded commit", task.task_id)}),
                );
                return;
            };
            repository_commits.insert(task.repository_id.clone(), commit.clone());
            repository_trees.insert(task.repository_id.clone(), tree.clone());
            implementer = task.attempt_id.clone().or(implementer);
            for dependency in &task.depends_on {
                if let Some(producer) = tasks.get(dependency).filter(|producer| !advisory(producer))
                {
                    if let Some(producer_commit) = &producer.candidate_commit {
                        dependency_bindings.insert(
                            dependency_binding_key(&task.repository_id, &producer.repository_id),
                            producer_commit.clone(),
                        );
                    }
                }
            }
        }
        let candidate = CandidateSet {
            schema_version: SCHEMA_VERSION.into(),
            id: format!("candidate-{}", uuid::Uuid::new_v4()),
            revision: 1,
            plan_hash: self.plan.hash.clone(),
            repository_commits,
            dependency_bindings,
            hash: String::new(),
        };
        let recorded = (|| -> Result<(), String> {
            let candidate = CandidateSet {
                hash: candidate.computed_hash().map_err(|e| e.to_string())?,
                ..candidate
            };
            let mut store = self.state.store.lock().map_err(|e| e.to_string())?;
            let run = store
                .get_run(&self.run_id)
                .map_err(|e| e.to_string())?
                .ok_or("run missing")?;
            store
                .record_candidate(
                    &self.run_id,
                    run.revision,
                    &candidate,
                    &repository_trees,
                    implementer.as_deref().ok_or("no completed attempt")?,
                )
                .map_err(|e| e.to_string())?;
            Ok(())
        })();
        if let Err(error) = recorded {
            let _ = self.state.finish(
                &self.run_id,
                RunState::Failed,
                json!({"reason": format!("cannot persist candidate set: {error}")}),
            );
        }
    }
}
