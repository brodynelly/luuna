//! Service lifecycle through the real HTTP server (ADR 0004/0010): orderly
//! shutdown with open event streams, a bounded drain, admission during
//! shutdown, resumable workflow streams and startup configuration. The
//! synthetic Pi fixture stands in for every model; no provider is called.
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use luuna_runtime::{router, serve, AppState, RuntimeConfig, ServiceSettings, Stopped};
use serde_json::{json, Value};
use std::{ffi::OsString, net::SocketAddr, path::PathBuf, process::Command, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::JoinHandle,
};
use tower::ServiceExt;

const TOKEN: &str = "synthetic-lifecycle-token-with-at-least-32-bytes";

fn python() -> &'static str {
    if cfg!(windows) {
        "python"
    } else {
        "python3"
    }
}

fn configuration(data_dir: PathBuf) -> RuntimeConfig {
    RuntimeConfig {
        data_dir,
        pi_program: python().into(),
        pi_launcher_args: vec![PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/pi-rpc/mock_pi.py")
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned()],
        git_program: "git".into(),
        provider: None,
        model: None,
        token: TOKEN.into(),
        max_run_seconds: 10,
    }
}

/// One runtime served on an ephemeral loopback port, plus a router on the
/// same state for setup requests.
struct Service {
    app: Router,
    state: AppState,
    address: SocketAddr,
    server: Option<JoinHandle<std::io::Result<Stopped>>>,
    _root: tempfile::TempDir,
    repository: tempfile::TempDir,
}

impl Service {
    async fn start(drain: Duration) -> Self {
        let root = tempfile::tempdir().unwrap();
        let state = AppState::open(configuration(root.path().join("data"))).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(serve(listener, state.clone(), drain));
        Self {
            app: router(state.clone()),
            state,
            address,
            server: Some(server),
            _root: root,
            repository: tempfile::tempdir().unwrap(),
        }
    }

    async fn request(&self, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header("Authorization", format!("Bearer {TOKEN}"));
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
        let bytes = to_bytes(response.into_body(), 8 * 1024 * 1024)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn run(&self, id: &str) -> Value {
        self.request("GET", &format!("/api/v1/runs/{id}"), None)
            .await
            .1
    }

    async fn until_state(&self, id: &str, states: &[&str]) -> Value {
        for _ in 0..800 {
            let run = self.run(id).await;
            if states.contains(&run["state"].as_str().unwrap_or_default()) {
                return run;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!("run never reached {states:?}: {}", self.run(id).await);
    }

    async fn candidate(&self, id: &str) -> Value {
        self.request("GET", &format!("/api/v1/runs/{id}/candidate"), None)
            .await
            .1
    }

    /// Register a fixture repository and confirm a manifest whose one
    /// required check fails while `src/main.py` carries a seeded regression.
    async fn project(&self) {
        let dir = self.repository.path();
        let git = |args: &[&str]| {
            let output = Command::new("git")
                .arg("-C")
                .arg(dir)
                .args(args)
                .env("GIT_AUTHOR_NAME", "Fixture")
                .env("GIT_AUTHOR_EMAIL", "fixture@example.invalid")
                .env("GIT_COMMITTER_NAME", "Fixture")
                .env("GIT_COMMITTER_EMAIL", "fixture@example.invalid")
                .output()
                .unwrap();
            assert!(output.status.success(), "git {args:?}");
        };
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "commit.gpgsign", "false"]);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/main.py"), "print('fixture')\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-q", "-m", "initial"]);
        git(&[
            "remote",
            "add",
            "origin",
            "https://example.invalid/fixture.git",
        ]);
        let (status, view) = self
            .request(
                "POST",
                "/api/v1/projects",
                Some(json!({"id":"fixture","name":"Fixture","repositories":[{"id":"app","path":dir.to_string_lossy()}]})),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{view}");
        let check = json!({"id": "unit", "executable": python(), "required": true, "timeout_seconds": 30,
            "capabilities": ["python"], "cwd": ".",
            "args": ["-c", "from pathlib import Path; import sys; bad = 'seeded regression' in Path('src/main.py').read_text(); print('running 1 tests'); print('test result: ' + ('FAILED. 0 passed; 1 failed' if bad else 'ok. 1 passed; 0 failed; 0 ignored; 0 measured')); sys.exit(1 if bad else 0)"]});
        let manifest = json!({
            "schema_version": "0.1", "id": "fixture", "name": "Fixture", "revision": 1,
            "repositories": [{"id": "app", "remote": "https://example.invalid/fixture.git", "default_branch": "main",
                "profiles": ["python"], "execution": "native", "checks": [check]}],
            "relationships": [],
            "policy": {"approval": "plan", "testing_prerequisite": true, "publish": "automatic_pr", "merge": "human",
                "max_explorers": 1, "max_implementers": 1, "max_task_repairs": 2},
        });
        let (status, view) = self
            .request(
                "PUT",
                "/api/v1/projects/fixture/manifest",
                Some(json!({"expected_revision": 0, "manifest": manifest})),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{view}");
    }

    /// A workflow run waiting in `plan_ready` for the fixture `scenario`.
    async fn plan_ready(&self, scenario: &str) -> (String, Value) {
        let (status, ticket) = self
            .request(
                "POST",
                "/api/v1/projects/fixture/tickets",
                Some(json!({
                    "idempotency_key": format!("key-{scenario}"),
                    "title": "Implement the greeting",
                    "intent": "Make src/main.py print the greeting.",
                    "acceptance_criteria": [format!("fixture:{scenario}"), "main prints the greeting"],
                    "repository_ids": ["app"],
                })),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{ticket}");
        let (status, opened) = self
            .request(
                "POST",
                &format!("/api/v1/tickets/{}/plans", ticket["id"].as_str().unwrap()),
                Some(json!({"task": {"repository_id": "app", "paths": ["src"], "operations": ["read", "write"]}})),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{opened}");
        (
            opened["run"]["id"].as_str().unwrap().to_owned(),
            opened["plan"].clone(),
        )
    }

    /// Stop the service through its HTTP endpoint and return how it stopped.
    async fn stop(&mut self) -> Stopped {
        let mut client = connect(self.address).await;
        client
            .write_all(
                format!("POST /api/v1/shutdown HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {TOKEN}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    .as_bytes(),
            )
            .await
            .unwrap();
        let mut response = Vec::new();
        assert!(
            read_until(
                &mut client,
                &mut response,
                "HTTP/1.1 202",
                Duration::from_secs(15)
            )
            .await
        );
        self.stopped(Duration::from_secs(30)).await
    }

    async fn stopped(&mut self, within: Duration) -> Stopped {
        let server = self.server.take().unwrap();
        tokio::time::timeout(within, server)
            .await
            .expect("the service must stop within its bounds")
            .unwrap()
            .unwrap()
    }
}

async fn connect(address: SocketAddr) -> TcpStream {
    TcpStream::connect(address).await.unwrap()
}

/// Open `GET path` as an SSE follower on its own connection.
async fn follow(address: SocketAddr, path: &str) -> TcpStream {
    let mut stream = connect(address).await;
    stream
        .write_all(
            format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {TOKEN}\r\nAccept: text/event-stream\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await
        .unwrap();
    stream
}

/// Read until `needle` appears; false at end of stream or after `within`.
async fn read_until(
    stream: &mut TcpStream,
    buffer: &mut Vec<u8>,
    needle: &str,
    within: Duration,
) -> bool {
    let deadline = tokio::time::Instant::now() + within;
    loop {
        if String::from_utf8_lossy(buffer).contains(needle) {
            return true;
        }
        let mut chunk = [0u8; 8192];
        match tokio::time::timeout_at(deadline, stream.read(&mut chunk)).await {
            Ok(Ok(0)) | Ok(Err(_)) | Err(_) => return false,
            Ok(Ok(read)) => buffer.extend_from_slice(&chunk[..read]),
        }
    }
}

/// Whether the server closes the connection within `within`.
async fn closes(stream: &mut TcpStream, within: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + within;
    let mut chunk = [0u8; 8192];
    loop {
        match tokio::time::timeout_at(deadline, stream.read(&mut chunk)).await {
            Ok(Ok(0)) | Ok(Err(_)) => return true,
            Ok(Ok(_)) => continue,
            Err(_) => return false,
        }
    }
}

#[tokio::test]
async fn shutdown_completes_while_a_client_follows_an_idle_workflow() {
    let mut service = Service::start(Duration::from_secs(10)).await;
    service.project().await;
    let (id, _) = service.plan_ready("write_in_scope").await;
    assert_eq!(service.run(&id).await["state"], "plan_ready");
    let mut follower = follow(service.address, &format!("/api/v1/runs/{id}/stream")).await;
    let mut seen = Vec::new();
    assert!(
        read_until(
            &mut follower,
            &mut seen,
            "plan.ready",
            Duration::from_secs(10)
        )
        .await
    );
    // The idle workflow keeps its follower attached until shutdown.
    assert!(!closes(&mut follower, Duration::from_millis(600)).await);

    assert_eq!(service.stop().await, Stopped::Drained);
    assert!(closes(&mut follower, Duration::from_secs(5)).await);
    // Durable state is untouched: the idle workflow was never owned work.
    assert_eq!(service.run(&id).await["state"], "plan_ready");
}

#[tokio::test]
async fn a_stalled_request_cannot_hold_an_orderly_stop_open() {
    let mut service = Service::start(Duration::from_millis(500)).await;
    // An admitted mutation whose body never finishes.
    let mut stalled = connect(service.address).await;
    stalled
        .write_all(
            format!("POST /api/v1/runs HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {TOKEN}\r\nContent-Type: application/json\r\nContent-Length: 200\r\n\r\n{{\"prompt\":")
                .as_bytes(),
        )
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    let started = std::time::Instant::now();
    service.state.request_shutdown();
    assert_eq!(
        service.stopped(Duration::from_secs(20)).await,
        Stopped::DeadlineExceeded
    );
    // Admission drain (5 s) and the drain deadline bound the stop.
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "{:?}",
        started.elapsed()
    );
    // Admission closed regardless of the stalled request.
    let (status, body) = service
        .request(
            "POST",
            "/api/v1/runs",
            Some(json!({"prompt":"success","provider":"test","model":"synthetic"})),
        )
        .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body, json!({"error": "runtime is shutting down"}));
}

#[tokio::test]
async fn work_creating_requests_are_refused_once_shutdown_begins() {
    let mut service = Service::start(Duration::from_secs(10)).await;
    service.project().await;
    let (id, _) = service.plan_ready("write_in_scope").await;
    assert_eq!(service.stop().await, Stopped::Drained);
    let hash = json!({"candidate_hash": format!("sha256:{}", "0".repeat(64))});
    for (path, body) in [
        (
            "/api/v1/runs".to_owned(),
            json!({"prompt":"success","provider":"test","model":"synthetic"}),
        ),
        (
            "/api/v1/projects/fixture/baselines".to_owned(),
            json!({"repository_id":"app"}),
        ),
        (
            "/api/v1/projects/fixture/tickets".to_owned(),
            json!({"idempotency_key":"late","title":"t","intent":"i","acceptance_criteria":["a"],"repository_ids":["app"]}),
        ),
        (format!("/api/v1/runs/{id}/implement"), json!({})),
        (format!("/api/v1/runs/{id}/validate"), hash.clone()),
        (format!("/api/v1/runs/{id}/repair"), hash.clone()),
    ] {
        let (status, refused) = service.request("POST", &path, Some(body)).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{path}");
        assert_eq!(
            refused,
            json!({"error": "runtime is shutting down"}),
            "{path}"
        );
    }
    // Reads stay available while interruption is persisted.
    assert_eq!(service.run(&id).await["state"], "plan_ready");
}

#[tokio::test]
async fn a_failed_workflow_keeps_streaming_through_its_repair() {
    let mut service = Service::start(Duration::from_secs(10)).await;
    service.project().await;
    let (status, baseline) = service
        .request(
            "POST",
            "/api/v1/projects/fixture/baselines",
            Some(json!({"repository_id": "app"})),
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{baseline}");
    let baseline_id = baseline["id"].as_str().unwrap();
    assert_eq!(
        service
            .until_state(baseline_id, &["completed", "failed"])
            .await["state"],
        "completed"
    );
    let (id, plan) = service.plan_ready("repair_in_scope").await;
    let (status, approved) = service
        .request(
            "POST",
            &format!("/api/v1/plans/{}/approvals", plan["id"].as_str().unwrap()),
            Some(json!({"plan_revision": plan["revision"], "plan_hash": plan["hash"], "approved_by": "developer"})),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{approved}");
    let (status, body) = service
        .request(
            "POST",
            &format!("/api/v1/runs/{id}/implement"),
            Some(json!({"provider": "test", "model": "synthetic"})),
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    service.until_state(&id, &["validating", "failed"]).await;
    let hash = service.candidate(&id).await["evidence"]["candidate"]["hash"].clone();
    let validate = json!({"candidate_hash": hash, "provider": "test", "model": "synthetic"});
    let (status, body) = service
        .request(
            "POST",
            &format!("/api/v1/runs/{id}/validate"),
            Some(validate.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    service.until_state(&id, &["failed"]).await;
    for _ in 0..200 {
        if service.candidate(&id).await["active"] == false {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert_eq!(service.candidate(&id).await["repair_allowed"], true);

    // A follower attached to the settled-but-resumable run stays attached.
    let mut follower = follow(service.address, &format!("/api/v1/runs/{id}/stream")).await;
    let mut seen = Vec::new();
    assert!(
        read_until(
            &mut follower,
            &mut seen,
            "run.created",
            Duration::from_secs(10)
        )
        .await
    );
    assert!(!closes(&mut follower, Duration::from_millis(600)).await);
    let (status, body) = service
        .request("POST", &format!("/api/v1/runs/{id}/repair"), Some(validate))
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    assert!(
        read_until(
            &mut follower,
            &mut seen,
            "candidate.repair_started",
            Duration::from_secs(20)
        )
        .await,
        "the repair must reach the follower live"
    );
    service
        .until_state(&id, &["validating", "failed", "paused"])
        .await;
    drop(follower);
    assert_eq!(service.stop().await, Stopped::Drained);
}

#[tokio::test]
async fn event_pages_are_bounded_and_cursors_validated() {
    let mut service = Service::start(Duration::from_secs(10)).await;
    service.project().await;
    let (id, _) = service.plan_ready("write_in_scope").await;
    let (_, all) = service
        .request("GET", &format!("/api/v1/runs/{id}/events"), None)
        .await;
    let all = all.as_array().unwrap().clone();
    assert!(all.len() >= 3);
    let (status, page) = service
        .request("GET", &format!("/api/v1/runs/{id}/events?limit=2"), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page.as_array().unwrap()[..], all[..2]);
    let next = all[1]["sequence"].as_u64().unwrap();
    let (_, page) = service
        .request(
            "GET",
            &format!("/api/v1/runs/{id}/events?after={next}&limit=1"),
            None,
        )
        .await;
    assert_eq!(page.as_array().unwrap()[..], all[2..3]);
    let before = all[2]["sequence"].as_u64().unwrap();
    let (status, page) = service
        .request(
            "GET",
            &format!("/api/v1/runs/{id}/events?limit=1&before={before}"),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page.as_array().unwrap()[..], all[1..2]);
    let (_, project) = service
        .request("GET", "/api/v1/projects/fixture/events?limit=1", None)
        .await;
    assert_eq!(project.as_array().unwrap().len(), 1);
    for path in [
        format!("/api/v1/runs/{id}/events?limit=0"),
        format!("/api/v1/runs/{id}/events?limit=10001"),
        format!("/api/v1/runs/{id}/events?after=9223372036854775808"),
        format!("/api/v1/runs/{id}/events?after=18446744073709551615"),
        format!("/api/v1/runs/{id}/stream?after=18446744073709551615"),
        "/api/v1/projects/fixture/events?after=18446744073709551615".to_owned(),
        "/api/v1/projects/fixture/events?limit=0".to_owned(),
        "/api/v1/runs?limit=0".to_owned(),
        // History cursors (ADR 0015) are validated and only meaningful with a limit.
        format!("/api/v1/runs/{id}/events?before=2"),
        format!("/api/v1/runs/{id}/events?limit=2&before=0"),
        "/api/v1/runs?before=missing".to_owned(),
        "/api/v1/runs?limit=2&before=missing".to_owned(),
    ] {
        let (status, body) = service.request("GET", &path, None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}: {body}");
        assert!(
            body["error"].as_str().is_some_and(|e| !e.is_empty()),
            "{path}"
        );
    }
    let (status, empty) = service
        .request(
            "GET",
            &format!("/api/v1/runs/{id}/events?after=9223372036854775807"),
            None,
        )
        .await;
    assert_eq!((status, empty), (StatusCode::OK, json!([])));
    assert_eq!(service.stop().await, Stopped::Drained);
}

fn variables(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
    let pairs: Vec<(String, OsString)> = pairs
        .iter()
        .map(|(name, value)| (name.to_string(), OsString::from(value)))
        .collect();
    move |name| {
        pairs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    }
}

#[test]
fn startup_settings_name_the_variable_and_its_expected_form() {
    let token = ("LUUNA_API_TOKEN", TOKEN);
    // Absolute on every platform; a Unix-style "/var/tmp" is not on Windows.
    let data_dir = std::env::temp_dir().join("luuna-settings");
    let settings = ServiceSettings::from_env(variables(&[
        token,
        ("LUUNA_DATA_DIR", data_dir.to_str().unwrap()),
    ]))
    .unwrap();
    assert_eq!(settings.port, 4242);
    assert_eq!(settings.runtime.max_run_seconds, 600);
    assert_eq!(settings.runtime.data_dir, data_dir);
    assert!(ServiceSettings::from_env(variables(&[token]))
        .unwrap()
        .runtime
        .data_dir
        .is_absolute());
    for (pairs, expected) in [
        (vec![], "LUUNA_API_TOKEN"),
        (
            vec![token, ("LUUNA_PORT", "abc")],
            "LUUNA_PORT must be a whole number from 0 to 65535 (got \"abc\")",
        ),
        (vec![token, ("LUUNA_PORT", "70000")], "LUUNA_PORT must be"),
        (vec![token, ("LUUNA_PORT", "4242 ")], "LUUNA_PORT must be"),
        (
            vec![token, ("LUUNA_RUN_TIMEOUT_SECONDS", "10m")],
            "LUUNA_RUN_TIMEOUT_SECONDS must be a positive whole number",
        ),
        (
            vec![token, ("LUUNA_RUN_TIMEOUT_SECONDS", "0")],
            "LUUNA_RUN_TIMEOUT_SECONDS must be",
        ),
        (
            vec![token, ("LUUNA_PI_ARGS_JSON", "/path/cli.js")],
            "LUUNA_PI_ARGS_JSON must be a JSON array of strings",
        ),
        (
            vec![token, ("LUUNA_PI_ARGS_JSON", "{\"a\":1}")],
            "LUUNA_PI_ARGS_JSON must be",
        ),
    ] {
        let error = ServiceSettings::from_env(variables(&pairs))
            .err()
            .unwrap_or_else(|| panic!("{pairs:?} must be refused"));
        assert!(error.to_string().contains(expected), "{error}");
        // `main` prints the Debug form: the plain message, not a quoted string.
        assert_eq!(format!("{error:?}"), error.to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStringExt;
        let error = ServiceSettings::from_env(|name| match name {
            "LUUNA_API_TOKEN" => Some(TOKEN.into()),
            "LUUNA_PI_MODEL" => Some(OsString::from_vec(vec![0xff, 0xfe])),
            _ => None,
        })
        .err()
        .unwrap();
        assert_eq!(error.to_string(), "LUUNA_PI_MODEL must be valid UTF-8");
    }
}

#[test]
fn tokens_that_could_never_authenticate_are_refused_at_startup() {
    let root = tempfile::tempdir().unwrap();
    for token in [
        "é".repeat(42),
        format!(" {TOKEN}"),
        format!("{TOKEN} "),
        format!("{TOKEN}\n"),
        "synthetic token with spaces at least 32 bytes".to_owned(),
        "short-token".to_owned(),
    ] {
        let mut config = configuration(root.path().join("data"));
        config.token = token.clone();
        let error = AppState::open(config)
            .err()
            .unwrap_or_else(|| panic!("{token:?} must be refused"))
            .to_string();
        assert!(error.contains("LUUNA_API_TOKEN"), "{error}");
        assert!(!error.contains(token.trim()), "the token is never echoed");
    }
}

#[cfg(unix)]
#[test]
fn an_existing_data_directory_and_its_worktrees_are_made_private() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    std::fs::create_dir_all(data.join("worktrees")).unwrap();
    for directory in [&data, &data.join("worktrees")] {
        std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let state = AppState::open(configuration(data.clone())).unwrap();
    for directory in [&data, &data.join("worktrees")] {
        let mode = std::fs::metadata(directory).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700, "{}", directory.display());
    }
    drop(state);
    // A fresh data directory gets the same private worktrees parent.
    let fresh = root.path().join("fresh");
    let _state = AppState::open(configuration(fresh.clone())).unwrap();
    let mode = std::fs::metadata(fresh.join("worktrees"))
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(mode, 0o700);
}
