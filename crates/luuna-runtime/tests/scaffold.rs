//! M5 approved scaffolding through the authenticated API: real `node --test`,
//! `python -m unittest` (and `cargo test` when cargo is present) baselines run
//! through the supervised executor, the project is registered and discovered,
//! and `project.scaffolded` is durable. Platform profiles whose tools are
//! missing on this host are blocked, never reported passing.
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use luuna_discovery::capabilities::probe_host_cached;
use luuna_runtime::{router, AppState, RuntimeConfig};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, process::Command};
use tower::ServiceExt;

const TOKEN: &str = "synthetic-test-token-with-at-least-32-bytes";

struct Harness {
    app: Router,
    state: AppState,
    root: PathBuf,
    /// Where scaffolded projects go; outside the data directory.
    projects: PathBuf,
}
impl Harness {
    fn new() -> Self {
        let base = std::env::temp_dir().join(format!("luuna-scaffold-{}", uuid::Uuid::new_v4()));
        let root = base.join("data");
        let projects = base.join("projects");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&projects).unwrap();
        let state = AppState::open(RuntimeConfig {
            data_dir: root.clone(),
            pi_program: if cfg!(windows) { "python" } else { "python3" }.into(),
            pi_launcher_args: vec![],
            git_program: "git".into(),
            provider: None,
            model: None,
            token: TOKEN.into(),
            max_run_seconds: 10,
        })
        .unwrap();
        Self {
            app: router(state.clone()),
            state,
            root: base,
            projects,
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
    async fn propose(&self, profile: &str, name: &str) -> (StatusCode, Value) {
        self.request(
            "POST",
            "/api/v1/projects/scaffold/propose",
            Some(json!({
                "profile": profile,
                "name": name,
                "parent_dir": self.projects.to_string_lossy(),
            })),
        )
        .await
    }
    async fn scaffold(&self, hash: &str, key: &str) -> (StatusCode, Value) {
        self.request(
            "POST",
            "/api/v1/projects/scaffold",
            Some(json!({"proposal_hash": hash, "idempotency_key": key, "confirm": true})),
        )
        .await
    }
}
impl Drop for Harness {
    fn drop(&mut self) {
        self.state.cancel_active();
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn git_output(dir: &PathBuf, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}");
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

/// Scaffold `profile` end to end and assert the baseline really ran and
/// passed, the project is registered and discovered with the same recipe, and
/// the project event stream carries `project.scaffolded`.
async fn scaffold_passes(harness: &Harness, profile: &str, name: &str) -> Value {
    let (status, proposal) = harness.propose(profile, name).await;
    assert_eq!(status, StatusCode::OK, "{proposal}");
    assert_eq!(proposal["status"], "ready", "{proposal}");
    assert_eq!(proposal["profile"], profile);
    assert!(proposal["hash"].as_str().unwrap().starts_with("sha256:"));
    assert!(!proposal["files"].as_array().unwrap().is_empty());
    let target = harness.projects.join(name);
    assert!(!target.exists(), "a proposal writes nothing");
    let baseline = proposal["baseline"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["required"] == true)
        .unwrap()
        .clone();
    let hash = proposal["hash"].as_str().unwrap().to_owned();

    let (status, result) = harness.scaffold(&hash, &format!("key-{name}")).await;
    assert_eq!(status, StatusCode::CREATED, "{result}");
    assert_eq!(result["proposal_hash"], hash);
    assert_eq!(result["replayed"], false);
    assert_eq!(
        result["check"]["status"], "passed",
        "baseline {} did not pass: {}",
        baseline["id"], result["check"]
    );
    assert_eq!(result["baseline_passed"], true);
    assert_eq!(result["check"]["recipe_id"], baseline["id"]);
    assert_eq!(result["check"]["command"][0], baseline["executable"]);
    assert_eq!(result["check"]["exit_code"], 0);
    assert!(target.join(".git").is_dir());
    for file in proposal["files"].as_array().unwrap() {
        let path = target.join(file["path"].as_str().unwrap());
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            file["contents"].as_str().unwrap(),
            "{}",
            path.display()
        );
    }
    assert_eq!(
        git_output(&target, &["rev-parse", "HEAD"]),
        result["commit"]
    );
    assert_eq!(git_output(&target, &["branch", "--show-current"]), "main");
    assert_eq!(
        git_output(&target, &["status", "--porcelain"]),
        "",
        "the baseline left untracked output outside .gitignore"
    );
    assert_eq!(result["project"]["project"]["id"], name);
    assert_eq!(result["project"]["repositories"][0]["repository_id"], "app");
    let discovered = result["discovery"]["repositories"][0]["proposed_checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["check"]["id"] == baseline["id"])
        .unwrap_or_else(|| panic!("discovery did not propose {}", baseline["id"]));
    assert_eq!(
        discovered["check"], baseline,
        "discovery proposes the scaffold baseline"
    );
    assert_eq!(discovered["capability"], "available");
    assert!(result["discovery"]["host_capabilities"]["tools"].is_array());

    let (status, events) = harness
        .request("GET", &format!("/api/v1/projects/{name}/events"), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    let scaffolded = events
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["type"] == "project.scaffolded")
        .expect("project.scaffolded is durable");
    assert_eq!(scaffolded["payload"]["proposal_hash"], hash);
    assert_eq!(scaffolded["payload"]["check"]["status"], "passed");
    assert_eq!(scaffolded["payload"]["commit"], result["commit"]);
    assert_eq!(scaffolded["run_id"], format!("project:{name}"));

    // Idempotent on the key: the recorded result, not a second scaffold.
    let (status, replay) = harness.scaffold(&hash, &format!("key-{name}")).await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay["replayed"], true);
    assert_eq!(replay["commit"], result["commit"]);
    assert_eq!(git_output(&target, &["rev-list", "--count", "HEAD"]), "1");
    result
}

#[tokio::test]
async fn node_scaffold_runs_a_real_node_test_baseline_and_registers_the_project() {
    let host = probe_host_cached();
    if !(host.available("node") && host.available("npm")) {
        eprintln!("node/npm missing on this host; the node scaffold must be blocked instead");
        let harness = Harness::new();
        let (_, proposal) = harness.propose("node", "svc").await;
        assert_eq!(proposal["status"], "blocked");
        return;
    }
    let harness = Harness::new();
    let result = scaffold_passes(&harness, "node", "svc").await;
    assert_eq!(result["check"]["command"], json!(["npm", "test"]));
    let (status, proposal) = harness.propose("node-typescript", "svc-ts").await;
    assert_eq!(status, StatusCode::OK, "{proposal}");
    assert!(proposal["files"]
        .as_array()
        .unwrap()
        .iter()
        .any(|f| f["path"] == "tsconfig.json"));
    assert!(proposal["questions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|q| q["topic"] == "typescript-typecheck"));
    // Node strips types itself from 22.18 on; older hosts fail the baseline honestly.
    let (status, result) = harness
        .scaffold(proposal["hash"].as_str().unwrap(), "key-ts")
        .await;
    assert_eq!(status, StatusCode::CREATED, "{result}");
    let node_version = host
        .tool("node")
        .unwrap()
        .version
        .clone()
        .unwrap_or_default();
    let strips_types = node_version
        .trim_start_matches('v')
        .split('.')
        .next()
        .and_then(|major| major.parse::<u32>().ok())
        .is_some_and(|major| major >= 24);
    if strips_types {
        assert_eq!(result["check"]["status"], "passed", "{}", result["check"]);
    } else {
        eprintln!(
            "node {node_version}: node-typescript baseline {}",
            result["check"]["status"]
        );
    }
}

#[tokio::test]
async fn python_scaffold_runs_a_real_unittest_baseline() {
    let host = probe_host_cached();
    let interpreter = luuna_discovery::capabilities::python_executable(Some(&host));
    if !host.available(interpreter) {
        eprintln!(
            "{interpreter} missing on this host; the python scaffold must be blocked instead"
        );
        let harness = Harness::new();
        let (_, proposal) = harness.propose("python", "pysvc").await;
        assert_eq!(proposal["status"], "blocked");
        return;
    }
    let harness = Harness::new();
    let result = scaffold_passes(&harness, "python", "pysvc").await;
    assert_eq!(
        result["check"]["command"],
        json!([interpreter, "-m", "unittest", "-v"])
    );
    assert_eq!(result["check"]["tests_detected"], 1, "{}", result["check"]);
}

#[tokio::test]
async fn rust_scaffold_runs_cargo_test_when_cargo_is_present() {
    let host = probe_host_cached();
    let harness = Harness::new();
    if !(host.available("cargo") && host.available("rustc")) {
        let (_, proposal) = harness.propose("rust", "crate-a").await;
        assert_eq!(proposal["status"], "blocked");
        return;
    }
    let result = scaffold_passes(&harness, "rust", "crate-a").await;
    assert_eq!(
        result["check"]["command"],
        json!(["cargo", "test", "--locked"])
    );
    assert_eq!(result["check"]["tests_detected"], 1, "{}", result["check"]);
}

#[tokio::test]
async fn go_scaffold_matches_the_probe() {
    let host = probe_host_cached();
    let harness = Harness::new();
    let (status, proposal) = harness.propose("go", "gosvc").await;
    assert_eq!(status, StatusCode::OK, "{proposal}");
    if host.available("go") {
        assert_eq!(proposal["status"], "ready");
        let result = scaffold_passes(&harness, "go", "gosvc2").await;
        assert_eq!(result["check"]["command"], json!(["go", "test", "./..."]));
    } else {
        assert_eq!(proposal["status"], "blocked", "{proposal}");
        assert!(proposal["blocked_reason"]
            .as_str()
            .unwrap()
            .contains("`go`"));
        let (status, refused) = harness
            .scaffold(proposal["hash"].as_str().unwrap(), "key-go")
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
        assert!(!harness.projects.join("gosvc").exists());
    }
}

#[tokio::test]
async fn platform_profiles_block_when_their_capability_is_missing() {
    let host = probe_host_cached();
    let harness = Harness::new();
    let (status, flutter) = harness.propose("flutter", "mobile").await;
    assert_eq!(status, StatusCode::OK, "{flutter}");
    assert_eq!(flutter["generator"]["executable"], "flutter");
    assert!(flutter["files"].as_array().unwrap().is_empty());
    let probe_says_present = host.available("flutter");
    assert_eq!(
        flutter["status"],
        if probe_says_present {
            "ready"
        } else {
            "blocked"
        },
        "{flutter}"
    );
    if !probe_says_present {
        let reason = flutter["blocked_reason"].as_str().unwrap();
        assert!(
            reason.contains("flutter") && reason.contains("blocked"),
            "{reason}"
        );
        let (status, refused) = harness
            .scaffold(flutter["hash"].as_str().unwrap(), "key-flutter")
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
        assert!(refused["error"].as_str().unwrap().contains("blocked"));
        assert!(!harness.projects.join("mobile").exists());
    } else {
        // Network steps (pub.dev) need explicit confirmation; nothing runs without it.
        let (status, refused) = harness
            .scaffold(flutter["hash"].as_str().unwrap(), "key-flutter")
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
        assert!(refused["error"]
            .as_str()
            .unwrap()
            .contains("confirm_network"));
    }
    // Native Android and iOS have no command-line generator: always blocked, with the path forward.
    for (profile, needle) in [("android", "Android Studio"), ("ios", "Xcode")] {
        let (status, proposal) = harness.propose(profile, &format!("{profile}-app")).await;
        assert_eq!(status, StatusCode::OK, "{proposal}");
        assert_eq!(proposal["status"], "blocked", "{proposal}");
        assert!(proposal["blocked_reason"]
            .as_str()
            .unwrap()
            .contains(needle));
        assert!(proposal["baseline"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["required"] == true));
        let (status, _) = harness
            .scaffold(
                proposal["hash"].as_str().unwrap(),
                &format!("key-{profile}"),
            )
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }
    let (_, ios) = harness.propose("ios", "ios-app").await;
    assert_eq!(ios["baseline"][0]["capabilities"], json!(["xcode"]));
    if !cfg!(target_os = "macos") {
        assert_eq!(ios["required_tools"][0]["status"], "missing");
    }
    // React declares its network step; without confirmation the scaffold is refused.
    let (status, react) = harness.propose("react", "web").await;
    assert_eq!(status, StatusCode::OK, "{react}");
    assert!(react["preparation"][0]["network"] == true);
    assert!(!react["network_steps"].as_array().unwrap().is_empty());
    if react["status"] == "ready" {
        let (status, refused) = harness
            .scaffold(react["hash"].as_str().unwrap(), "key-react")
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
        assert!(refused["error"]
            .as_str()
            .unwrap()
            .contains("confirm_network"));
        assert!(!harness.projects.join("web").exists());
    }
}

#[tokio::test]
async fn scaffolding_refuses_mismatched_hashes_unknown_profiles_and_unsafe_targets() {
    let harness = Harness::new();
    let (status, error) = harness.propose("perl", "svc").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert!(error["error"].as_str().unwrap().contains("node-typescript"));
    let (status, _) = harness.propose("node", "Not Valid").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Inside the data directory: refused before anything is proposed.
    let inside = harness.root.join("data").join("worktrees");
    fs::create_dir_all(&inside).unwrap();
    let (status, error) = harness
        .request(
            "POST",
            "/api/v1/projects/scaffold/propose",
            Some(json!({"profile":"node","name":"svc","parent_dir":inside.to_string_lossy()})),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert!(error["error"].as_str().unwrap().contains("LUUNA_DATA_DIR"));
    let (status, _) = harness
        .request(
            "POST",
            "/api/v1/projects/scaffold/propose",
            Some(json!({"profile":"node","name":"svc","parent_dir":"relative/dir"})),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Non-empty target: refused at proposal time and again at execution time.
    let occupied = harness.projects.join("taken");
    fs::create_dir_all(&occupied).unwrap();
    fs::write(occupied.join("notes.txt"), "mine").unwrap();
    let (status, error) = harness.propose("node", "taken").await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(
        fs::read_to_string(occupied.join("notes.txt")).unwrap(),
        "mine"
    );
    let (status, proposal) = harness.propose("node", "later").await;
    assert_eq!(status, StatusCode::OK, "{proposal}");
    let hash = proposal["hash"].as_str().unwrap().to_owned();
    let later = harness.projects.join("later");
    fs::create_dir_all(&later).unwrap();
    fs::write(later.join("notes.txt"), "mine").unwrap();
    let (status, error) = harness.scaffold(&hash, "key-later").await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert!(!later.join(".git").exists());
    fs::remove_dir_all(&later).unwrap();

    // Hash mismatch: an unknown hash, a tampered hash and a wrong format.
    for bad in [
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        "nonsense",
        "",
    ] {
        let (status, error) = harness.scaffold(bad, "key-bad").await;
        assert_eq!(status, StatusCode::CONFLICT, "{bad}: {error}");
        assert!(error["error"].as_str().unwrap().contains("proposal_hash"));
    }
    // confirm must be explicit.
    let (status, _) = harness
        .request(
            "POST",
            "/api/v1/projects/scaffold",
            Some(json!({"proposal_hash": hash, "idempotency_key": "k", "confirm": false})),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!later.exists());

    // An idempotency key bound to one proposal cannot execute another.
    let host = probe_host_cached();
    if host.available("node") && host.available("npm") {
        let (status, result) = harness.scaffold(&hash, "key-later").await;
        assert_eq!(status, StatusCode::CREATED, "{result}");
        let (status, other) = harness.propose("node", "other").await;
        assert_eq!(status, StatusCode::OK, "{other}");
        let (status, error) = harness
            .scaffold(other["hash"].as_str().unwrap(), "key-later")
            .await;
        assert_eq!(status, StatusCode::CONFLICT, "{error}");
        assert!(!harness.projects.join("other").exists());
        // A registered name cannot be scaffolded again.
        let (status, error) = harness.propose("node", "later").await;
        assert_eq!(status, StatusCode::CONFLICT, "{error}");
    }
}
