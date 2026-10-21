//! Synthetic transport integration; these tests make no provider call.
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use luuna_domain::RunState;
use luuna_runtime::{router, AppState, RuntimeConfig};
use luuna_storage::RunRecord;
use serde_json::{json, Value};
use std::{path::PathBuf, time::Duration};
use tower::ServiceExt;

const TOKEN: &str = "synthetic-test-token-with-at-least-32-bytes";

struct Harness {
    app: Router,
    state: AppState,
    root: PathBuf,
}
impl Harness {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("luuna-runtime-test-{}", uuid::Uuid::new_v4()));
        let config = configuration(root.clone());
        let state = AppState::open(config).unwrap();
        Self {
            app: router(state.clone()),
            state,
            root,
        }
    }
    async fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
        auth: bool,
    ) -> (StatusCode, Value) {
        let mut request = Request::builder().method(method).uri(path);
        if auth {
            request = request.header("Authorization", format!("Bearer {TOKEN}"));
        }
        if body.is_some() {
            request = request.header("Content-Type", "application/json");
        }
        let response = self
            .app
            .clone()
            .oneshot(
                request
                    .body(Body::from(body.map(|b| b.to_string()).unwrap_or_default()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }
    async fn start(&self, scenario: &str) -> RunRecord {
        let (status, body) = self
            .request(
                "POST",
                "/api/v1/runs",
                Some(json!({"prompt":scenario,"provider":"test","model":"synthetic"})),
                true,
            )
            .await;
        assert_eq!(status, StatusCode::ACCEPTED);
        serde_json::from_value(body).unwrap()
    }
    async fn terminal(&self, id: &str) -> RunRecord {
        for _ in 0..100 {
            let (_, value) = self
                .request("GET", &format!("/api/v1/runs/{id}"), None, true)
                .await;
            let record: RunRecord = serde_json::from_value(value).unwrap();
            if record.state.is_terminal() {
                return record;
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
        panic!("run did not terminate");
    }
}
fn configuration(root: PathBuf) -> RuntimeConfig {
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/pi-rpc/mock_pi.py")
        .canonicalize()
        .unwrap();
    RuntimeConfig {
        data_dir: root,
        pi_program: if cfg!(windows) { "python" } else { "python3" }.into(),
        pi_launcher_args: vec![script.to_string_lossy().into_owned()],
        git_program: "git".into(),
        provider: None,
        model: None,
        token: TOKEN.into(),
        max_run_seconds: 10,
    }
}
impl Drop for Harness {
    fn drop(&mut self) {
        self.state.cancel_active();
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[tokio::test]
async fn health_public_run_data_authenticated_and_input_constrained() {
    let harness = Harness::new();
    assert_eq!(
        harness.request("GET", "/health", None, false).await.0,
        StatusCode::OK
    );
    assert_eq!(
        harness.request("GET", "/api/v1/runs", None, false).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        harness
            .request(
                "POST",
                "/api/v1/runs",
                Some(json!({"prompt":"/bash secret"})),
                true
            )
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        harness
            .request(
                "POST",
                "/api/v1/runs",
                Some(json!({"prompt":"hello"})),
                true
            )
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        harness
            .request("GET", "/api/v1/runs/missing/events", None, true)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn persistence_replay_unknown_events_and_successful_completion() {
    let harness = Harness::new();
    let run = harness.start("success").await;
    let terminal = harness.terminal(&run.id).await;
    assert_eq!(terminal.state, RunState::Completed);
    let (_, events) = harness
        .request(
            "GET",
            &format!("/api/v1/runs/{}/events", run.id),
            None,
            true,
        )
        .await;
    let events = events.as_array().unwrap();
    assert!(events.iter().any(|e| e["type"] == "pi.future_event"));
    let settled = events
        .iter()
        .position(|e| e["type"] == "pi.agent_settled")
        .unwrap();
    let completed = events
        .iter()
        .position(|e| e["type"] == "run.completed")
        .unwrap();
    assert!(settled < completed);
    let after = events[settled]["sequence"].as_u64().unwrap();
    let (_, replay) = harness
        .request(
            "GET",
            &format!("/api/v1/runs/{}/events?after={after}", run.id),
            None,
            true,
        )
        .await;
    assert!(replay
        .as_array()
        .unwrap()
        .iter()
        .all(|e| e["sequence"].as_u64().unwrap() > after));
    assert_eq!(
        luuna_storage::Store::open(harness.root.join("luuna.sqlite3"))
            .unwrap()
            .get_run(&run.id)
            .unwrap()
            .unwrap()
            .state,
        RunState::Completed
    );
}

#[tokio::test]
async fn failures_do_not_report_success() {
    let harness = Harness::new();
    for scenario in [
        "provider_error",
        "malformed",
        "wrong_id",
        "rejected",
        "crash",
    ] {
        let run = harness.start(scenario).await;
        assert_eq!(
            harness.terminal(&run.id).await.state,
            RunState::Failed,
            "{scenario}"
        );
    }
}

#[tokio::test]
async fn retry_can_recover_before_agent_settled() {
    let harness = Harness::new();
    let run = harness.start("retry_success").await;
    assert_eq!(harness.terminal(&run.id).await.state, RunState::Completed);
}

#[tokio::test]
async fn malformed_known_completion_fails_closed_after_prompt_acceptance() {
    let harness = Harness::new();
    for scenario in [
        "malformed_settled",
        "invalid_settled_aborted",
        "malformed_agent_end",
        "malformed_message_end",
    ] {
        let run = harness.start(scenario).await;
        assert_eq!(
            harness.terminal(&run.id).await.state,
            RunState::Failed,
            "{scenario}"
        );
        let (_, events) = harness
            .request(
                "GET",
                &format!("/api/v1/runs/{}/events", run.id),
                None,
                true,
            )
            .await;
        let events = events.as_array().unwrap();
        assert!(
            events.iter().any(|event| event["type"] == "pi.response"
                && event["payload"]["id"] == "prompt-1"
                && event["payload"]["success"] == true),
            "prompt acceptance must precede the malformed completion: {scenario}"
        );
        assert!(
            events.iter().any(|event| event["type"] == "run.failed"
                && event["payload"]["reason"]
                    .as_str()
                    .unwrap()
                    .contains("invalid Pi RPC record")),
            "{scenario}"
        );
        assert!(
            !events.iter().any(|event| event["type"] == "run.completed"),
            "{scenario}"
        );
    }
}

#[tokio::test]
async fn low_level_agent_end_does_not_finish_run_and_cancel_reaps() {
    let harness = Harness::new();
    let run = harness.start("end_without_settled").await;
    let mut saw_low_end = false;
    for _ in 0..100 {
        let (_, events) = harness
            .request(
                "GET",
                &format!("/api/v1/runs/{}/events", run.id),
                None,
                true,
            )
            .await;
        if events
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "pi.agent_end")
        {
            saw_low_end = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(saw_low_end);
    let (_, record) = harness
        .request("GET", &format!("/api/v1/runs/{}", run.id), None, true)
        .await;
    assert_eq!(record["state"], "running");
    assert_eq!(
        harness
            .request(
                "POST",
                &format!("/api/v1/runs/{}/cancel", run.id),
                None,
                true
            )
            .await
            .0,
        StatusCode::ACCEPTED
    );
    assert_eq!(harness.terminal(&run.id).await.state, RunState::Cancelled);
}

#[tokio::test]
async fn sse_replays_with_last_event_id_and_closes_after_terminal() {
    let harness = Harness::new();
    let run = harness.start("success").await;
    harness.terminal(&run.id).await;
    let request = Request::builder()
        .uri(format!("/api/v1/runs/{}/stream", run.id))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .header("Last-Event-ID", "1")
        .body(Body::empty())
        .unwrap();
    let response = harness.app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = String::from_utf8(
        to_bytes(response.into_body(), 2 * 1024 * 1024)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(body.contains("event: run_event"));
    assert!(body.contains("run.completed"));
    assert!(!body.contains("run.created"));
}

#[test]
fn data_directory_ownership_precedes_recovery() {
    let harness = Harness::new();
    let mut storage = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    let run = storage
        .create_run("still-owned", "demo", json!({}))
        .unwrap();
    storage
        .transition_run(
            &run.id,
            run.revision,
            RunState::Running,
            "run.running",
            json!({}),
        )
        .unwrap();
    assert!(AppState::open(configuration(harness.root.clone())).is_err());
    assert_eq!(
        storage.get_run(&run.id).unwrap().unwrap().state,
        RunState::Running
    );
}

#[tokio::test]
async fn provider_key_aliases_reach_the_child_by_standard_name_only() {
    // Synthetic names/values; the fixture reports variable names, never values.
    std::env::set_var("LUUNA_PI_ANTHROPIC_API_KEY", "synthetic-alias-secret-value");
    std::env::set_var("GROQ_API_KEY", "synthetic-direct-secret-value");
    let harness = Harness::new();
    let run = harness.start("env_names").await;
    assert_eq!(harness.terminal(&run.id).await.state, RunState::Completed);
    let (_, events) = harness
        .request(
            "GET",
            &format!("/api/v1/runs/{}/events", run.id),
            None,
            true,
        )
        .await;
    let serialized = events.to_string();
    assert!(
        !serialized.contains("secret-value"),
        "values must never persist"
    );
    let events = events.as_array().unwrap();
    let names: Vec<&str> = events
        .iter()
        .find(|e| e["type"] == "pi.fixture_env")
        .and_then(|e| e["payload"]["names"].as_array())
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect();
    assert!(names.contains(&"ANTHROPIC_API_KEY"), "{names:?}");
    assert!(names.contains(&"GROQ_API_KEY"), "{names:?}");
    assert!(
        !names.iter().any(|n| n.starts_with("LUUNA_PI_")),
        "{names:?}"
    );
    let spawned = events
        .iter()
        .find(|e| e["type"] == "pi.spawned")
        .expect("spawn event");
    let configured: Vec<&str> = spawned["payload"]["provider_credentials"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect();
    assert!(configured.contains(&"ANTHROPIC_API_KEY") && configured.contains(&"GROQ_API_KEY"));
    assert!(spawned["payload"]["pid"].as_u64().is_some());
}

#[cfg(unix)]
#[tokio::test]
async fn cancelled_run_records_pid_and_child_is_reaped_before_terminal_event() {
    let harness = Harness::new();
    let run = harness.start("slow").await;
    let mut pid = None;
    for _ in 0..100 {
        let (_, events) = harness
            .request(
                "GET",
                &format!("/api/v1/runs/{}/events", run.id),
                None,
                true,
            )
            .await;
        if let Some(found) = events
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["type"] == "pi.spawned")
            .and_then(|e| e["payload"]["pid"].as_u64())
        {
            pid = Some(found);
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let pid = pid.expect("pi.spawned must record the child PID");
    let alive = |pid: u64| {
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    };
    assert!(alive(pid), "fixture child should be running before cancel");
    assert_eq!(
        harness
            .request(
                "POST",
                &format!("/api/v1/runs/{}/cancel", run.id),
                None,
                true
            )
            .await
            .0,
        StatusCode::ACCEPTED
    );
    assert_eq!(harness.terminal(&run.id).await.state, RunState::Cancelled);
    assert!(
        !alive(pid),
        "child must be reaped before run.cancelled persists"
    );
}

#[tokio::test]
async fn explicit_shutdown_interrupts_a_demo_run_and_reaps_its_child() {
    let harness = Harness::new();
    let run = harness.start("slow").await;
    let mut pid = None;
    for _ in 0..100 {
        let (_, events) = harness
            .request(
                "GET",
                &format!("/api/v1/runs/{}/events", run.id),
                None,
                true,
            )
            .await;
        if let Some(found) = events
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["type"] == "pi.spawned")
            .and_then(|e| e["payload"]["pid"].as_u64())
        {
            pid = Some(found);
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let pid = pid.expect("pi.spawned must record the child PID");
    harness.state.shutdown().await;
    let terminal = harness.terminal(&run.id).await;
    assert_eq!(terminal.state, RunState::Interrupted);
    let alive = std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    assert!(
        !alive,
        "child must be reaped before run.interrupted persists"
    );
    let (_, events) = harness
        .request(
            "GET",
            &format!("/api/v1/runs/{}/events", run.id),
            None,
            true,
        )
        .await;
    let terminal = events
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["type"] == "run.interrupted")
        .expect("run.interrupted persisted");
    assert!(terminal["payload"]["reason"]
        .as_str()
        .unwrap()
        .starts_with("interrupted by runtime shutdown"));
}
