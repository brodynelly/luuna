//! Orbit (ADR 0036) through the authenticated API: status, exec, recipe runs,
//! sync and the sandbox plan over two fixture repositories. Commands are Python
//! one-liners; no model is involved.
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use luuna_runtime::{router, AppState, RuntimeConfig};
use serde_json::{json, Value};
use std::{fs, path::Path, path::PathBuf, process::Command};
use tower::ServiceExt;

const TOKEN: &str = "synthetic-test-token-with-at-least-32-bytes";

struct Harness {
    app: Router,
    root: PathBuf,
}

impl Harness {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("luuna-orbit-test-{}", uuid::Uuid::new_v4()));
        let state = AppState::open(RuntimeConfig {
            data_dir: root.clone(),
            pi_program: python().into(),
            pi_launcher_args: vec![],
            git_program: "git".into(),
            provider: None,
            model: None,
            token: TOKEN.into(),
            max_run_seconds: 10,
        })
        .unwrap();
        Self {
            app: router(state),
            root,
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
        let bytes = to_bytes(response.into_body(), 32 * 1024 * 1024)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn python() -> String {
    if cfg!(windows) { "python" } else { "python3" }.into()
}

fn git(dir: &Path, args: &[&str]) {
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
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn repository(dir: &Path, name: &str) {
    fs::create_dir_all(dir).unwrap();
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
    fs::write(dir.join("README.md"), format!("{name} fixture\n")).unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "initial"]);
    git(
        dir,
        &[
            "remote",
            "add",
            "origin",
            &format!("https://example.invalid/{name}.git"),
        ],
    );
}

fn manifest_repository(id: &str, checks: Value) -> Value {
    json!({"id": id, "remote": format!("https://example.invalid/{id}.git"), "default_branch": "main",
        "profiles": ["python"], "execution": "native", "checks": checks})
}

#[tokio::test]
async fn orbit_reports_runs_and_sandboxes_a_projects_repositories() {
    let harness = Harness::new();
    let workspace = tempfile::tempdir().unwrap();
    let github = workspace.path().join("github");
    let (app, lib) = (github.join("app"), github.join("lib"));
    repository(&app, "app");
    repository(&lib, "lib");
    fs::create_dir_all(github.join("unrelated")).unwrap();
    let (status, view) = harness
        .request("POST", "/api/v1/projects", Some(json!({"id": "orbit", "name": "Orbit", "repositories": [
            {"id": "app", "path": app.to_string_lossy()}, {"id": "lib", "path": lib.to_string_lossy()}]})))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{view}");

    // Recipes need a confirmed manifest.
    let (status, refused) = harness
        .request(
            "POST",
            "/api/v1/projects/orbit/orbit/run",
            Some(json!({"recipe": "test"})),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    let test = json!([{"id": "test", "executable": python(), "args": ["-c", "print('app tests ran')"], "required": true,
        "timeout_seconds": 60, "capabilities": ["python"], "cwd": "."}]);
    let build = json!([{"id": "build", "executable": python(), "args": ["-c", "pass"], "required": true,
        "timeout_seconds": 60, "capabilities": ["python"], "cwd": "."}]);
    let manifest = json!({"schema_version": "0.1", "id": "orbit", "name": "Orbit", "revision": 1,
        "repositories": [manifest_repository("app", test), manifest_repository("lib", build)], "relationships": [],
        "policy": {"approval": "plan", "testing_prerequisite": true, "publish": "automatic_pr", "merge": "human",
            "max_explorers": 1, "max_implementers": 1, "max_task_repairs": 2}});
    let (status, view) = harness
        .request(
            "PUT",
            "/api/v1/projects/orbit/manifest",
            Some(json!({"expected_revision": 0, "manifest": manifest})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{view}");

    fs::write(lib.join("scratch.txt"), "untracked").unwrap();
    let (status, orbit) = harness
        .request("GET", "/api/v1/projects/orbit/orbit", None)
        .await;
    assert_eq!(status, StatusCode::OK, "{orbit}");
    assert_eq!(orbit["manifest_revision"], 1);
    assert_eq!(orbit["recipes"], json!(["build", "test"]));
    let repositories = orbit["repositories"].as_array().unwrap();
    assert_eq!(repositories.len(), 2);
    assert_eq!(repositories[0]["repository_id"], "app");
    assert_eq!(repositories[0]["branch"], "main");
    assert_eq!(repositories[0]["present"], true);
    assert_eq!(repositories[0]["recipes"], json!(["test"]));
    assert_eq!(repositories[0]["remote"], "https://example.invalid/app.git");
    assert_eq!(repositories[1]["dirty"]["untracked"], 1);
    assert!(repositories[1]["error"].is_null(), "{}", repositories[1]);

    // Exec in every repository, in parallel, keeping repository order.
    let (status, executed) = harness
        .request("POST", "/api/v1/projects/orbit/orbit/exec", Some(json!({"executable": python(),
            "args": ["-c", "import pathlib, sys; t = pathlib.Path('README.md').read_text(); print(t.strip()); sys.exit(3 if t.startswith('lib') else 0)"],
            "parallel": true})))
        .await;
    assert_eq!(status, StatusCode::OK, "{executed}");
    assert_eq!(executed["kind"], "exec");
    let results = executed["results"].as_array().unwrap();
    assert_eq!(results[0]["repository_id"], "app");
    assert_eq!(results[0]["status"], "succeeded", "{}", results[0]);
    assert!(results[0]["stdout_excerpt"]
        .as_str()
        .unwrap()
        .contains("app fixture"));
    assert_eq!(results[1]["status"], "failed");
    assert_eq!(results[1]["exit_code"], 3);

    let (status, refused) = harness
        .request(
            "POST",
            "/api/v1/projects/orbit/orbit/exec",
            Some(json!({"executable": python(), "repositories": ["nope"]})),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(refused["error"].as_str().unwrap().contains("nope"));
    let (status, _) = harness
        .request(
            "POST",
            "/api/v1/projects/orbit/orbit/exec",
            Some(json!({"executable": python(), "timeout_seconds": 0})),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // A recipe runs where the manifest defines it and is skipped elsewhere.
    let (status, ran) = harness
        .request(
            "POST",
            "/api/v1/projects/orbit/orbit/run",
            Some(json!({"recipe": "test"})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{ran}");
    assert_eq!(ran["results"][0]["status"], "succeeded");
    assert!(ran["results"][0]["stdout_excerpt"]
        .as_str()
        .unwrap()
        .contains("app tests ran"));
    assert_eq!(ran["results"][1]["status"], "skipped");
    let (status, _) = harness
        .request(
            "POST",
            "/api/v1/projects/orbit/orbit/run",
            Some(json!({"recipe": "lint"})),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // The sandbox plan lists only the project's checkouts.
    let (status, plan) = harness
        .request("GET", "/api/v1/projects/orbit/orbit/sandbox", None)
        .await;
    assert_eq!(status, StatusCode::OK, "{plan}");
    assert_eq!(plan["network"], "open");
    let mounted: Vec<&str> = plan["repositories"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["repository_id"].as_str().unwrap())
        .collect();
    assert_eq!(mounted, ["app", "lib"]);
    assert!(!plan.to_string().contains("unrelated"));
    assert!(Path::new(plan["home"].as_str().unwrap()).is_dir());
    let (_, closed) = harness
        .request(
            "GET",
            "/api/v1/projects/orbit/orbit/sandbox?network=none",
            None,
        )
        .await;
    assert_eq!(closed["network"], "none");
    let (status, _) = harness
        .request(
            "GET",
            "/api/v1/projects/orbit/orbit/sandbox?network=wide",
            None,
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // A missing checkout is reported, skipped by exec and left out of the plan;
    // sync without fetch leaves present checkouts alone.
    fs::remove_dir_all(&lib).unwrap();
    let (_, orbit) = harness
        .request("GET", "/api/v1/projects/orbit/orbit", None)
        .await;
    assert_eq!(orbit["repositories"][1]["present"], false);
    let (_, executed) = harness
        .request(
            "POST",
            "/api/v1/projects/orbit/orbit/exec",
            Some(json!({"executable": python(), "args": ["-c", "pass"]})),
        )
        .await;
    assert_eq!(executed["results"][1]["status"], "skipped");
    let (_, plan) = harness
        .request("GET", "/api/v1/projects/orbit/orbit/sandbox", None)
        .await;
    assert_eq!(plan["repositories"].as_array().unwrap().len(), 1);
    let (status, synced) = harness
        .request(
            "POST",
            "/api/v1/projects/orbit/orbit/sync",
            Some(json!({"repositories": ["app"], "fetch": false})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{synced}");
    assert_eq!(synced["results"][0]["action"], "unchanged");

    let (_, events) = harness
        .request("GET", "/api/v1/projects/orbit/events", None)
        .await;
    let kinds: Vec<&str> = events
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["type"].as_str().unwrap())
        .collect();
    for kind in ["orbit.executed", "orbit.recipe_ran", "orbit.synced"] {
        assert!(kinds.contains(&kind), "{kind} missing from {kinds:?}");
    }
    // Events summarize outcomes and never carry output.
    assert!(!events.to_string().contains("app fixture"));
}
