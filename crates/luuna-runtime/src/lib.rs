//! Authenticated loopback-only, tool-free Pi connectivity foundation.
//! This does not authorize repository changes, execute plans, or publish code.
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive},
        IntoResponse, Response, Sse,
    },
    routing::{get, post},
    Json, Router,
};
use fs2::FileExt;
use luuna_domain::RunState;
use luuna_engine_pi::{PiConfig, PiProcess, PI_VERSION};
use luuna_executor::Executor;
use luuna_git::GitInspector;
use luuna_storage::{RunRecord, Store};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    convert::Infallible,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{watch, Notify, RwLock};
use tower_http::cors::CorsLayer;

#[derive(Clone)]
pub struct RuntimeConfig {
    pub data_dir: PathBuf,
    pub pi_program: PathBuf,
    /// Host `git` used for read-only repository inspection.
    pub git_program: PathBuf,
    pub pi_launcher_args: Vec<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub token: String,
    pub max_run_seconds: u64,
}

#[derive(Clone)]
pub struct AppState {
    store: Arc<Mutex<Store>>,
    active: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    config: Arc<RuntimeConfig>,
    git: Arc<GitInspector>,
    executor: Arc<Executor>,
    components: Option<Arc<luuna_components::Components>>,
    component_locks: Arc<tokio::sync::Mutex<()>>,
    /// Set by explicit shutdown before owned work is signalled to stop.
    shutting_down: Arc<std::sync::atomic::AtomicBool>,
    shutdown_requested: Arc<Notify>,
    admission: Arc<RwLock<()>>,
    _owner_lock: Arc<RuntimeOwnership>,
}

/// The final logical runtime owner releases its lock explicitly. On Unix a
/// concurrent fork may briefly inherit the open file description before exec
/// closes its CLOEXEC descriptor; merely closing our file could otherwise
/// retain the lock until that unrelated child completes exec.
struct RuntimeOwnership(std::fs::File);

impl Drop for RuntimeOwnership {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.0);
    }
}

mod baselines;
mod candidates;
mod integrations;
mod missions;
mod projects;
mod writer;
pub use baselines::{ArtifactId, StartBaseline};
pub use projects::{ConfirmManifest, ProjectView, RegisterProject, RegisterRepository};
pub use writer::{
    ApprovePlan, BudgetRequest, CreatePlan, CreateTicket, Implement, PlanApproved, PlanOpened,
    PlanTaskRequest,
};

fn discovered_components() -> Option<Arc<luuna_components::Components>> {
    static COMPONENTS: std::sync::OnceLock<Option<Arc<luuna_components::Components>>> =
        std::sync::OnceLock::new();
    COMPONENTS
        .get_or_init(|| luuna_components::Components::discover().ok().map(Arc::new))
        .clone()
}

impl AppState {
    pub fn open(config: RuntimeConfig) -> Result<Self, Box<dyn std::error::Error>> {
        if config.token.len() < 32 {
            return Err("LUUNA_API_TOKEN must contain at least 32 bytes".into());
        }
        if config.max_run_seconds == 0 {
            return Err("run timeout must be positive".into());
        }
        let mut builder = std::fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&config.data_dir)?;
        let mut options = std::fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let owner_lock = options.open(config.data_dir.join("runtime.lock"))?;
        owner_lock
            .try_lock_exclusive()
            .map_err(|_| "another Luuna runtime already owns this data directory")?;
        // Own the acquired lease before fallible state initialization too.
        let owner_lock = RuntimeOwnership(owner_lock);
        let mut store = Store::open(config.data_dir.join("luuna.sqlite3"))?;
        baselines::reap_orphaned_checks(&mut store)?;
        store.interrupt_active_runs()?;
        let git = GitInspector {
            program: config.git_program.clone(),
            ..GitInspector::default()
        };
        Ok(Self {
            store: Arc::new(Mutex::new(store)),
            active: Arc::new(Mutex::new(HashMap::new())),
            config: Arc::new(config),
            git: Arc::new(git),
            executor: Arc::new(Executor::default()),
            components: discovered_components(),
            component_locks: Arc::new(tokio::sync::Mutex::new(())),
            shutting_down: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            shutdown_requested: Arc::new(Notify::new()),
            admission: Arc::new(RwLock::new(())),
            _owner_lock: Arc::new(owner_lock),
        })
    }

    /// Override the component toolchain in isolated adapter tests.
    pub fn with_components(mut self, components: luuna_components::Components) -> Self {
        self.components = Some(Arc::new(components));
        self
    }

    pub fn cancel_active(&self) {
        if let Ok(active) = self.active.lock() {
            for signal in active.values() {
                let _ = signal.send(true);
            }
        }
    }

    /// True once explicit shutdown has begun. Owned work then settles as
    /// `interrupted` (resumable after restart) rather than `cancelled`: the
    /// developer did not cancel it, the service stopped (ADR 0004).
    pub(crate) fn shutting_down(&self) -> bool {
        self.shutting_down.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// The terminal run state for work stopped by the cancellation signal.
    pub(crate) fn stop_run_state(&self) -> RunState {
        if self.shutting_down() {
            RunState::Interrupted
        } else {
            RunState::Cancelled
        }
    }

    pub(crate) fn stop_attempt_state(&self) -> luuna_domain::AttemptState {
        if self.shutting_down() {
            luuna_domain::AttemptState::Interrupted
        } else {
            luuna_domain::AttemptState::Cancelled
        }
    }

    /// The recorded reason for work stopped by the cancellation signal.
    pub(crate) fn stop_reason(&self, reason: &str) -> String {
        if self.shutting_down() {
            format!("interrupted by runtime shutdown: {reason}")
        } else {
            reason.to_owned()
        }
    }

    pub async fn shutdown(&self) {
        {
            // Drain admitted scheduling requests before stopping their workers.
            let _admission = self.admission.write().await;
            self.shutting_down
                .store(true, std::sync::atomic::Ordering::SeqCst);
            self.cancel_active();
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            let empty = self
                .active
                .lock()
                .map(|active| active.is_empty())
                .unwrap_or(true);
            if empty || tokio::time::Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    /// One main-process waiter; Notify retains an early request until it waits.
    pub async fn wait_for_shutdown_request(&self) {
        self.shutdown_requested.notified().await;
    }

    fn event(&self, id: &str, kind: &str, payload: Value) -> Result<(), ApiError> {
        self.store
            .lock()
            .map_err(internal)?
            .append_event(id, kind, payload)
            .map_err(internal)?;
        Ok(())
    }

    fn finish(&self, id: &str, state: RunState, payload: Value) -> Result<(), ApiError> {
        let mut store = self.store.lock().map_err(internal)?;
        let current = store.get_run(id).map_err(internal)?.ok_or_else(not_found)?;
        if !current.state.is_terminal() {
            let kind = format!(
                "run.{}",
                serde_json::to_value(state)
                    .map_err(internal)?
                    .as_str()
                    .unwrap_or("failed")
            );
            store
                .transition_run(id, current.revision, state, &kind, payload)
                .map_err(internal)?;
        }
        Ok(())
    }
}

pub fn router(state: AppState) -> Router {
    let protected = Router::new()
        .route(
            "/api/v1/projects/{id}/components",
            get(integrations::status).post(integrations::enable),
        )
        .route(
            "/api/v1/projects/{id}/memory",
            get(integrations::list_memory).post(integrations::create_memory),
        )
        .route(
            "/api/v1/projects/{id}/memory/{memory_id}",
            axum::routing::delete(integrations::delete_memory),
        )
        .route(
            "/api/v1/projects/{id}/prompts",
            get(integrations::list_prompts).post(integrations::create_prompt),
        )
        .route(
            "/api/v1/projects/{id}/prompts/{name}/render",
            get(integrations::render_prompt),
        )
        .route("/api/v1/tickets/{id}/source", get(writer::ticket_source))
        .route(
            "/api/v1/tickets/{id}/reconcile",
            post(writer::reconcile_ticket),
        )
        .route("/api/v1/shutdown", post(request_shutdown))
        .route("/api/v1/runs", get(list_runs).post(start_run))
        .route("/api/v1/runs/{id}", get(get_run))
        .route("/api/v1/runs/{id}/events", get(events))
        .route("/api/v1/runs/{id}/stream", get(stream))
        .route("/api/v1/runs/{id}/cancel", post(cancel))
        .route("/api/v1/runs/{id}/implement", post(writer::implement))
        .route("/api/v1/runs/{id}/candidate", get(candidates::candidate))
        .route("/api/v1/runs/{id}/diff", get(candidates::diff))
        .route("/api/v1/runs/{id}/validate", post(candidates::validate))
        .route("/api/v1/runs/{id}/repair", post(writer::repair))
        .route("/api/v1/runs/{id}/worktrees", get(writer::list_worktrees))
        .route("/api/v1/runs/{id}/attempts", get(writer::list_attempts))
        .route(
            "/api/v1/projects/{id}/tickets",
            get(writer::list_tickets).post(writer::create_ticket),
        )
        .route("/api/v1/tickets/{id}", get(writer::get_ticket))
        .route(
            "/api/v1/tickets/{id}/plans",
            get(writer::list_plans).post(writer::create_plan),
        )
        .route("/api/v1/plans/{id}", get(writer::get_plan))
        .route("/api/v1/plans/{id}/approvals", post(writer::approve_plan))
        .route(
            "/api/v1/projects",
            get(projects::list_projects).post(projects::register_project),
        )
        .route("/api/v1/projects/{id}", get(projects::get_project))
        .route("/api/v1/projects/{id}/discover", post(projects::discover))
        .route(
            "/api/v1/projects/{id}/repositories/{repository_id}/rebind",
            post(projects::rebind_repository),
        )
        .route(
            "/api/v1/projects/{id}/manifest",
            axum::routing::put(projects::confirm_manifest),
        )
        .route(
            "/api/v1/projects/{id}/events",
            get(projects::project_events),
        )
        .route(
            "/api/v1/projects/{id}/baselines",
            get(baselines::list_baselines).post(baselines::start_baseline),
        )
        .route(
            "/api/v1/runs/{id}/artifacts/{artifact_id}",
            get(baselines::artifact),
        )
        .route_layer(middleware::from_fn_with_state(state.clone(), authenticate));
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:1420".parse().unwrap(),
            "http://127.0.0.1:1420".parse().unwrap(),
            "tauri://localhost".parse().unwrap(),
            "http://tauri.localhost".parse().unwrap(),
            "https://tauri.localhost".parse().unwrap(),
        ])
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
            axum::http::Method::DELETE,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::HeaderName::from_static("last-event-id"),
        ]);
    Router::new()
        .merge(protected)
        .route("/health", get(health))
        .route("/api/v1/health", get(health))
        .layer(axum::extract::DefaultBodyLimit::max(256 * 1024))
        .layer(cors)
        .with_state(state)
}

async fn health() -> Json<Value> {
    Json(
        json!({"status":"ok","pi_version":PI_VERSION,"pi_version_status":"required; checked on every run","demo_only":true,"build_identity":env!("LUUNA_BUILD_IDENTITY"),"build_rustc":env!("LUUNA_BUILD_RUSTC"),"build_rustc_sha256":env!("LUUNA_BUILD_RUSTC_SHA256"),"build_rustc_wrapper":env!("LUUNA_BUILD_RUSTC_WRAPPER"),"build_flags":env!("LUUNA_BUILD_FLAGS")}),
    )
}

async fn authenticate(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let supplied = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if !supplied.is_some_and(|value| {
        constant_time_eq::constant_time_eq(value.as_bytes(), state.config.token.as_bytes())
    }) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"authentication required"})),
        )
            .into_response();
    }
    if request.method() != axum::http::Method::GET && request.uri().path() != "/api/v1/shutdown" {
        let _admission = state.admission.read().await;
        if state.shutting_down() {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error":"runtime is shutting down; restart it before starting new work"})),
            ).into_response();
        }
        next.run(request).await
    } else {
        next.run(request).await
    }
}

/// Authenticated, idempotent service stop. Client disconnect is never shutdown.
async fn request_shutdown(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    let _admission = state.admission.write().await;
    state
        .shutting_down
        .store(true, std::sync::atomic::Ordering::SeqCst);
    state.shutdown_requested.notify_one();
    (
        StatusCode::ACCEPTED,
        Json(json!({"status":"shutting_down"})),
    )
}

#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub String);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
fn internal<T>(_: T) -> ApiError {
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "runtime storage or process operation failed; inspect local state".into(),
    )
}
fn not_found() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "run not found".into())
}

async fn list_runs(State(state): State<AppState>) -> Result<Json<Vec<RunRecord>>, ApiError> {
    Ok(Json(
        state
            .store
            .lock()
            .map_err(internal)?
            .runs()
            .map_err(internal)?,
    ))
}
async fn get_run(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<RunRecord>, ApiError> {
    Ok(Json(
        state
            .store
            .lock()
            .map_err(internal)?
            .get_run(&id)
            .map_err(internal)?
            .ok_or_else(not_found)?,
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StartRun {
    pub prompt: String,
    pub provider: Option<String>,
    pub model: Option<String>,
}

async fn start_run(
    State(state): State<AppState>,
    Json(request): Json<StartRun>,
) -> Result<(StatusCode, Json<RunRecord>), ApiError> {
    if request.prompt.trim().is_empty()
        || request.prompt.len() > 16_000
        || request.prompt.trim_start().starts_with('/')
    {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "prompt must be 1..16000 bytes and cannot invoke a slash command".into(),
        ));
    }
    let provider = request
        .provider
        .or_else(|| state.config.provider.clone())
        .filter(|s| !s.is_empty());
    let model = request
        .model
        .or_else(|| state.config.model.clone())
        .filter(|s| !s.is_empty());
    if model.is_none()
        || provider.is_none()
        || model.as_ref().is_some_and(|s| s.len() > 256)
        || provider.as_ref().is_some_and(|s| s.len() > 128)
    {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "an explicit provider and model are required".into(),
        ));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = watch::channel(false);
    let mut active = state.active.lock().map_err(internal)?;
    if active.len() >= 4 {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "four demo runs are already active".into(),
        ));
    }
    let metadata = json!({"prompt":request.prompt,"provider":provider,"model":model,"demo_only":true,"tools":[]});
    let run = state
        .store
        .lock()
        .map_err(internal)?
        .create_run(&id, "demo", metadata)
        .map_err(internal)?;
    active.insert(id.clone(), tx);
    drop(active);
    let worker_state = state.clone();
    tokio::spawn(async move {
        run_worker(
            worker_state.clone(),
            id.clone(),
            request.prompt,
            provider,
            model,
            rx,
        )
        .await;
        // An empty active map must mean worker ownership of the data directory
        // is released, so shutdown/reopen cannot race the task's final drop.
        let active_runs = worker_state.active.clone();
        drop(worker_state);
        if let Ok(mut active) = active_runs.lock() {
            active.remove(&id);
        };
    });
    Ok((StatusCode::ACCEPTED, Json(run)))
}

#[derive(Deserialize)]
struct Cursor {
    #[serde(default)]
    after: u64,
}
async fn events(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(cursor): Query<Cursor>,
) -> Result<Json<Vec<luuna_domain::EventEnvelope>>, ApiError> {
    let store = state.store.lock().map_err(internal)?;
    store
        .get_run(&id)
        .map_err(internal)?
        .ok_or_else(not_found)?;
    Ok(Json(
        store.events_after(&id, cursor.after).map_err(internal)?,
    ))
}

async fn stream(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(cursor): Query<Cursor>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    state
        .store
        .lock()
        .map_err(internal)?
        .get_run(&id)
        .map_err(internal)?
        .ok_or_else(not_found)?;
    let mut after = headers
        .get("last-event-id")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(cursor.after);
    let records = async_stream::stream! {
        loop {
            let batch = {
                let store = state.store.lock();
                store.ok().and_then(|store| {
                    let run = store.get_run(&id).ok().flatten()?;
                    Some((store.events_after(&id, after).ok()?, run.state.is_terminal()))
                })
            };
            let Some((events, terminal)) = batch else { break; };
            for record in events {
                after = record.sequence;
                let event = Event::default().id(after.to_string()).event("run_event").json_data(record);
                match event { Ok(event) => yield Ok::<Event, Infallible>(event), Err(_) => break }
            }
            if terminal || state.shutting_down() { break; }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    };
    Ok(Sse::new(records).keep_alive(KeepAlive::new().interval(Duration::from_secs(10))))
}

async fn cancel(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<RunRecord>), ApiError> {
    let run = state
        .store
        .lock()
        .map_err(internal)?
        .get_run(&id)
        .map_err(internal)?
        .ok_or_else(not_found)?;
    let active = state.active.lock().map_err(internal)?;
    if let Some(sender) = active.get(&id) {
        sender.send(true).map_err(internal)?;
        return Ok((StatusCode::ACCEPTED, Json(run)));
    }
    if run.state.is_terminal() {
        return Ok((StatusCode::OK, Json(run)));
    }
    Err(ApiError(
        StatusCode::CONFLICT,
        "run has no active local process".into(),
    ))
}

async fn run_worker(
    state: AppState,
    id: String,
    prompt: String,
    provider: Option<String>,
    model: Option<String>,
    mut cancel: watch::Receiver<bool>,
) {
    if *cancel.borrow() {
        let _ = state.finish(
            &id,
            state.stop_run_state(),
            json!({"reason": state.stop_reason("cancelled before startup")}),
        );
        return;
    }
    let running = (|| -> Result<(), ApiError> {
        let mut store = state.store.lock().map_err(internal)?;
        let run = store
            .get_run(&id)
            .map_err(internal)?
            .ok_or_else(not_found)?;
        store
            .transition_run(
                &id,
                run.revision,
                RunState::Running,
                "run.running",
                json!({"pi_version":PI_VERSION}),
            )
            .map_err(internal)?;
        Ok(())
    })();
    if running.is_err() {
        let _ = state.finish(
            &id,
            RunState::Failed,
            json!({"reason":"cannot persist startup"}),
        );
        return;
    }
    let config = PiConfig {
        program: state.config.pi_program.clone(),
        launcher_args: state.config.pi_launcher_args.clone(),
        cwd: state
            .config
            .data_dir
            .join("attempts")
            .join(&id)
            .join("work"),
        config_dir: state.config.data_dir.join("attempts").join(&id).join("pi"),
        provider,
        model,
        profile: luuna_engine_pi::SessionProfile::ToolFree,
    };
    let spawned = tokio::select! {
        biased;
        _ = cancel.changed() => { let _ = state.finish(&id, state.stop_run_state(), json!({"reason": state.stop_reason("cancelled during startup")})); return; },
        spawned = PiProcess::spawn(&config) => spawned,
    };
    let mut process = match spawned {
        Ok(process) => process,
        Err(error) => {
            let _ = state.finish(&id, RunState::Failed, json!({"reason":error.to_string()}));
            return;
        }
    };
    // The owned child's PID lets operators and smoke tests verify it was reaped
    // after the terminal event. Credential names are recorded, never values.
    if state
        .event(
            &id,
            "pi.spawned",
            json!({"pid":process.pid(),"pi_version":PI_VERSION,"provider_credentials":luuna_engine_pi::configured_provider_keys()}),
        )
        .is_err()
    {
        let _ = process.stop().await;
        let _ = state.finish(
            &id,
            RunState::Failed,
            json!({"reason":"cannot persist process start"}),
        );
        return;
    }
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
        state
            .event(&id, "pi.response", handshake.raw)
            .map_err(|_| "cannot persist handshake".to_owned())?;
        process
            .command("prompt-1", "prompt", json!({"message":prompt}))
            .await
            .map_err(|e| e.to_string())?;
        let mut failure: Option<String> = None;
        let mut accepted = false;
        loop {
            let record = process.next().await.map_err(|e| e.to_string())?;
            state
                .event(&id, &format!("pi.{}", record.kind), record.raw.clone())
                .map_err(|_| "cannot persist event".to_owned())?;
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
            if record.kind == "message_end" && record.raw["message"]["role"] == "assistant" {
                failure = record.model_error();
            }
            if record.kind == "agent_end" && record.raw["willRetry"] != true {
                if let Some(error) = record.model_error() {
                    failure = Some(error);
                }
            }
            if record.kind == "extension_ui_request" {
                return Err("unexpected extension UI request in tool-free demo".to_owned());
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
    enum Outcome {
        Completed,
        Failed(String),
        Cancelled,
    }
    let outcome = tokio::select! {
        biased;
        _ = cancel.changed() => Outcome::Cancelled,
        result = tokio::time::timeout(Duration::from_secs(state.config.max_run_seconds), operation) => match result {
            Ok(Ok(())) => Outcome::Completed, Ok(Err(error)) => Outcome::Failed(error), Err(_) => Outcome::Failed("run deadline exceeded".into()),
        },
    };
    // The terminal event is persisted only after the child is stopped/reaped.
    let stopped = process.stop().await;
    let (terminal, payload) = match (outcome, stopped) {
        (_, Err(error)) => (
            RunState::Failed,
            json!({"reason":format!("process cleanup failed: {error}")}),
        ),
        (Outcome::Completed, _) => (
            RunState::Completed,
            json!({"reason":"Pi agent_settled; no repository validation performed"}),
        ),
        (Outcome::Failed(reason), _) => (RunState::Failed, json!({"reason":reason})),
        (Outcome::Cancelled, _) => (
            state.stop_run_state(),
            json!({"reason": state.stop_reason("abort requested; subprocess reaped")}),
        ),
    };
    let _ = state.finish(&id, terminal, payload);
}

#[cfg(test)]
mod integrations_tests;

#[cfg(test)]
mod ownership_tests {
    use super::*;

    fn config(root: &std::path::Path) -> RuntimeConfig {
        RuntimeConfig {
            data_dir: root.into(),
            pi_program: "node".into(),
            git_program: "git".into(),
            pi_launcher_args: vec![],
            provider: None,
            model: None,
            token: "synthetic-ownership-token-at-least-32-bytes".into(),
            max_run_seconds: 10,
        }
    }

    #[test]
    fn runtime_ownership_is_retained_until_the_last_state_clone_drops() {
        let root = tempfile::tempdir().unwrap();
        let settings = config(root.path());
        let state = AppState::open(settings.clone()).unwrap();
        let active_owner = state.clone();
        drop(state);
        assert!(AppState::open(settings.clone()).is_err());
        drop(active_owner);
        assert!(AppState::open(settings).is_ok());
    }

    #[test]
    #[cfg(unix)]
    fn runtime_final_drop_unlocks_even_when_a_fork_style_duplicate_stays_open() {
        let root = tempfile::tempdir().unwrap();
        let settings = config(root.path());
        let state = AppState::open(settings.clone()).unwrap();
        // dup/fork descriptors share the same open file description/flock.
        // Keep one alive deterministically instead of racing fork and exec.
        let inherited = state._owner_lock.0.try_clone().unwrap();
        assert!(AppState::open(settings.clone()).is_err());
        drop(state);
        let replacement = AppState::open(settings)
            .expect("a stale inherited descriptor must not extend logical runtime ownership");
        drop(inherited);
        drop(replacement);
    }
}
