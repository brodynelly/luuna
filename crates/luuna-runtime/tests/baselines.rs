//! M2b baselines through the authenticated API. Recipes use Python fixtures;
//! no model is involved and the developer checkout is never written.
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use luuna_runtime::{router, AppState, RuntimeConfig};
use serde_json::{json, Value};
use std::{fs, path::Path, path::PathBuf, process::Command, time::Duration};
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
            std::env::temp_dir().join(format!("luuna-baseline-test-{}", uuid::Uuid::new_v4()));
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
            app: router(state.clone()),
            state,
            root,
        }
    }
    async fn raw(&self, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Vec<u8>) {
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
        (status, bytes.to_vec())
    }
    async fn request(&self, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
        let (status, bytes) = self.raw(method, path, body).await;
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }
    async fn terminal(&self, id: &str) -> Value {
        for _ in 0..400 {
            let (_, run) = self
                .request("GET", &format!("/api/v1/runs/{id}"), None)
                .await;
            if matches!(
                run["state"].as_str(),
                Some("completed" | "failed" | "cancelled" | "interrupted")
            ) {
                return run;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("baseline run did not terminate");
    }
    async fn events(&self, id: &str) -> Vec<Value> {
        let (_, events) = self
            .request("GET", &format!("/api/v1/runs/{id}/events"), None)
            .await;
        events.as_array().cloned().unwrap_or_default()
    }
    async fn confirm(&self, project: &str, revision: u64, checks: Vec<Value>) -> Value {
        let manifest = json!({
            "schema_version": "0.1", "id": project, "name": "Fixture", "revision": revision + 1,
            "repositories": [{"id": "app", "remote": "https://example.invalid/fixture.git", "default_branch": "main",
                "profiles": ["python"], "execution": "native", "checks": checks}],
            "relationships": [],
            "policy": {"approval": "plan", "testing_prerequisite": true, "publish": "automatic_pr", "merge": "human",
                "max_explorers": 1, "max_implementers": 1, "max_task_repairs": 2},
        });
        let (status, view) = self
            .request(
                "PUT",
                &format!("/api/v1/projects/{project}/manifest"),
                Some(json!({"expected_revision": revision, "manifest": manifest})),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{view}");
        view
    }
    async fn baseline(&self, project: &str, include_optional: bool) -> Value {
        let (status, run) = self
            .request(
                "POST",
                &format!("/api/v1/projects/{project}/baselines"),
                Some(json!({"repository_id": "app", "include_optional": include_optional})),
            )
            .await;
        assert_eq!(status, StatusCode::ACCEPTED, "{run}");
        run
    }
}
impl Drop for Harness {
    fn drop(&mut self) {
        self.state.cancel_active();
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn python() -> String {
    if cfg!(windows) { "python" } else { "python3" }.into()
}
fn check(id: &str, code: &str, required: bool, timeout: u64) -> Value {
    json!({"id": id, "executable": python(), "args": ["-c", code], "required": required,
        "timeout_seconds": timeout, "capabilities": ["python"], "cwd": "."})
}
fn git(dir: &Path, args: &[&str]) -> String {
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
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}
fn clean_repository(dir: &Path) {
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
    fs::write(dir.join("README.md"), "fixture\n").unwrap();
    fs::write(
        dir.join("pyproject.toml"),
        "[project]\nname = \"fixture\"\n",
    )
    .unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "initial"]);
    git(
        dir,
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/fixture.git",
        ],
    );
}
async fn register(harness: &Harness, dir: &Path) {
    let (status, view) = harness
        .request(
            "POST",
            "/api/v1/projects",
            Some(json!({"id":"fixture","name":"Fixture","repositories":[{"id":"app","path":dir.to_string_lossy()}]})),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{view}");
}
fn snapshot(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                out.push((
                    path.strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                    fs::read(&path).unwrap(),
                ));
            }
        }
    }
    walk(dir, dir, &mut out);
    out.sort();
    out
}

#[tokio::test]
async fn passing_baseline_records_bound_evidence_and_artifacts() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    let before = snapshot(repo.path());
    harness
        .confirm(
            "fixture",
            0,
            vec![
                check("unit", "print('running 2 tests'); print('test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured')", true, 30),
                check("lint", "import sys; sys.exit(1)", false, 30),
            ],
        )
        .await;
    let run = harness.baseline("fixture", false).await;
    assert_eq!(run["metadata"]["kind"], "baseline");
    assert_eq!(run["project_id"], "fixture");
    let id = run["id"].as_str().unwrap().to_owned();
    let terminal = harness.terminal(&id).await;
    assert_eq!(terminal["state"], "completed", "{terminal}");
    let events = harness.events(&id).await;
    let types: Vec<&str> = events.iter().map(|e| e["type"].as_str().unwrap()).collect();
    for expected in [
        "run.created",
        "run.running",
        "baseline.started",
        "check.started",
        "check.spawned",
        "check.output",
        "check.finished",
        "baseline.finished",
        "run.completed",
    ] {
        assert!(
            types.contains(&expected),
            "{expected} missing from {types:?}"
        );
    }
    let finished = events
        .iter()
        .find(|e| e["type"] == "check.finished")
        .unwrap();
    let result = &finished["payload"]["result"];
    assert_eq!(result["status"], "passed");
    assert_eq!(result["exit_code"], 0);
    assert_eq!(result["tests_detected"], 2);
    assert_eq!(result["commit"], git(repo.path(), &["rev-parse", "HEAD"]));
    assert!(result["candidate_hash"]
        .as_str()
        .unwrap()
        .starts_with("sha256:"));
    assert!(result["artifact_hashes"]["stdout"]
        .as_str()
        .unwrap()
        .starts_with("sha256:"));
    assert_eq!(
        result["artifact_refs"][0],
        format!("artifact:{id}:unit:stdout")
    );
    assert!(finished["payload"]["stdout_excerpt"]
        .as_str()
        .unwrap()
        .contains("2 passed"));

    let (status, baselines) = harness
        .request("GET", "/api/v1/projects/fixture/baselines", None)
        .await;
    assert_eq!(status, StatusCode::OK);
    let baseline = &baselines[0];
    assert_eq!(baseline["status"], "passed");
    assert_eq!(baseline["run_id"], id);
    assert_eq!(
        baseline["identity"]["commit"],
        git(repo.path(), &["rev-parse", "HEAD"])
    );
    assert_eq!(
        baseline["identity"]["tree"],
        git(repo.path(), &["rev-parse", "HEAD^{tree}"])
    );
    assert_eq!(baseline["required_checks"], json!(["unit"]));
    assert_eq!(
        baseline["results"].as_array().unwrap().len(),
        1,
        "optional lint did not run"
    );
    assert!(baseline["environment_fingerprint"]
        .as_str()
        .unwrap()
        .starts_with("sha256:"));

    let (status, body) = harness
        .raw(
            "GET",
            &format!("/api/v1/runs/{id}/artifacts/unit.stdout"),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&body).contains("test result: ok. 2 passed"));
    for bad in ["unit.stdin", "../../luuna.sqlite3.stdout", "missing.stdout"] {
        let (status, _) = harness
            .raw("GET", &format!("/api/v1/runs/{id}/artifacts/{bad}"), None)
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{bad}");
    }
    assert_eq!(
        snapshot(repo.path()),
        before,
        "baseline must not write to the checkout"
    );

    // Optional checks run on request and are recorded without changing the verdict.
    let run = harness.baseline("fixture", true).await;
    let id = run["id"].as_str().unwrap().to_owned();
    assert_eq!(harness.terminal(&id).await["state"], "completed");
    let (_, baselines) = harness
        .request("GET", "/api/v1/projects/fixture/baselines", None)
        .await;
    let latest = baselines
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["run_id"] == id)
        .unwrap();
    assert_eq!(latest["status"], "passed");
    assert_eq!(latest["results"].as_array().unwrap().len(), 2);
    assert_eq!(latest["results"][1]["status"], "failed");
    let project_events = harness
        .request("GET", "/api/v1/projects/fixture/events", None)
        .await
        .1;
    assert!(project_events
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["type"] == "baseline.finished" && e["payload"]["status"] == "passed"));
}

#[tokio::test]
async fn failing_missing_empty_and_timed_out_checks_never_pass() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    let mut missing = check("missing", "", true, 30);
    missing["executable"] = json!("luuna-no-such-tool");
    harness
        .confirm(
            "fixture",
            0,
            vec![
                check(
                    "broken",
                    "import sys; print('boom', file=sys.stderr); sys.exit(2)",
                    true,
                    30,
                ),
                missing,
                check(
                    "empty",
                    "print('test result: ok. 0 passed; 0 failed; 0 ignored')",
                    true,
                    30,
                ),
                check("slow", "import time; time.sleep(30)", true, 1),
                check("fine", "print('ok')", true, 30),
            ],
        )
        .await;
    let run = harness.baseline("fixture", false).await;
    let id = run["id"].as_str().unwrap().to_owned();
    let terminal = harness.terminal(&id).await;
    assert_eq!(terminal["state"], "failed", "{terminal}");
    let (_, baselines) = harness
        .request("GET", "/api/v1/projects/fixture/baselines", None)
        .await;
    let baseline = &baselines[0];
    assert_eq!(
        baseline["status"], "blocked",
        "blocked outranks failed: {baseline}"
    );
    let results = baseline["results"].as_array().unwrap();
    let by_id = |recipe: &str| {
        results
            .iter()
            .find(|r| r["recipe_id"] == recipe)
            .unwrap()
            .clone()
    };
    assert_eq!(by_id("broken")["status"], "failed");
    assert_eq!(by_id("broken")["exit_code"], 2);
    assert_eq!(by_id("missing")["status"], "blocked");
    assert!(by_id("missing")["reason"]
        .as_str()
        .unwrap()
        .contains("not found"));
    assert_eq!(by_id("empty")["status"], "blocked");
    assert_eq!(by_id("empty")["tests_detected"], 0);
    assert_eq!(by_id("slow")["status"], "failed");
    assert!(by_id("slow")["reason"]
        .as_str()
        .unwrap()
        .contains("deadline"));
    assert_eq!(by_id("fine")["status"], "passed");
    assert_eq!(
        results.len(),
        5,
        "every required check runs even after failures"
    );
    let (status, body) = harness
        .raw(
            "GET",
            &format!("/api/v1/runs/{id}/artifacts/broken.stderr"),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&body).contains("boom"));
}

#[tokio::test]
async fn dirty_checkout_and_unconfirmed_project_are_rejected_or_blocked() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    let (status, body) = harness
        .request(
            "POST",
            "/api/v1/projects/fixture/baselines",
            Some(json!({"repository_id": "app"})),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    harness
        .confirm("fixture", 0, vec![check("unit", "print('ok')", true, 30)])
        .await;
    let (status, _) = harness
        .request(
            "POST",
            "/api/v1/projects/fixture/baselines",
            Some(json!({"repository_id": "other"})),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        harness
            .request(
                "POST",
                "/api/v1/projects/missing/baselines",
                Some(json!({"repository_id": "app"}))
            )
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    fs::write(
        repo.path().join("README.md"),
        "developer edit in progress\n",
    )
    .unwrap();
    let before = snapshot(repo.path());
    let run = harness.baseline("fixture", false).await;
    let id = run["id"].as_str().unwrap().to_owned();
    let terminal = harness.terminal(&id).await;
    assert_eq!(terminal["state"], "failed");
    let events = harness.events(&id).await;
    assert!(
        !events.iter().any(|e| e["type"] == "check.started"),
        "no command may run on a dirty checkout"
    );
    let (_, baselines) = harness
        .request("GET", "/api/v1/projects/fixture/baselines", None)
        .await;
    assert_eq!(baselines[0]["status"], "blocked");
    assert!(baselines[0]["reason"]
        .as_str()
        .unwrap()
        .contains("1 unstaged"));
    assert_eq!(snapshot(repo.path()), before);
}

#[cfg(unix)]
#[tokio::test]
async fn cancelling_a_baseline_reaps_the_check_and_records_cancellation() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    harness
        .confirm(
            "fixture",
            0,
            vec![
                check("slow", "import time; time.sleep(60)", true, 120),
                check("after", "print('never')", true, 30),
            ],
        )
        .await;
    let run = harness.baseline("fixture", false).await;
    let id = run["id"].as_str().unwrap().to_owned();
    let mut pid = None;
    for _ in 0..200 {
        if let Some(found) = harness
            .events(&id)
            .await
            .iter()
            .find(|e| e["type"] == "check.spawned")
            .and_then(|e| e["payload"]["pid"].as_u64())
        {
            pid = Some(found);
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let pid = pid.expect("check.spawned records the pid");
    let alive = |pid: u64| {
        std::fs::read_to_string(format!("/proc/{pid}/stat"))
            .ok()
            .and_then(|stat| stat.rsplit(')').next()?.trim_start().chars().next())
            .is_some_and(|state| state != 'Z' && state != 'X')
            || (!cfg!(target_os = "linux")
                && Command::new("kill")
                    .args(["-0", &pid.to_string()])
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false))
    };
    assert!(alive(pid));
    let (status, _) = harness
        .request("POST", &format!("/api/v1/runs/{id}/cancel"), None)
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let terminal = harness.terminal(&id).await;
    assert_eq!(terminal["state"], "cancelled", "{terminal}");
    assert!(
        !alive(pid),
        "check process must be reaped before run.cancelled persists"
    );
    let (_, baselines) = harness
        .request("GET", "/api/v1/projects/fixture/baselines", None)
        .await;
    assert_eq!(baselines[0]["status"], "cancelled");
    let results = baselines[0]["results"].as_array().unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["status"], "cancelled");
    assert!(!harness
        .events(&id)
        .await
        .iter()
        .any(|e| e["type"] == "check.started" && e["payload"]["recipe_id"] == "after"));
}

#[tokio::test]
async fn a_check_that_changes_the_checkout_cannot_produce_passed_evidence() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    harness
        .confirm(
            "fixture",
            0,
            vec![check(
                "mutate",
                "open('README.md', 'a').write('mutated by a check'); print('ran 1 test')",
                true,
                30,
            )],
        )
        .await;
    let run = harness.baseline("fixture", false).await;
    let id = run["id"].as_str().unwrap().to_owned();
    let terminal = harness.terminal(&id).await;
    assert_eq!(terminal["state"], "failed", "{terminal}");
    let (_, baselines) = harness
        .request("GET", "/api/v1/projects/fixture/baselines", None)
        .await;
    assert_eq!(baselines[0]["status"], "failed", "{baselines}");
    let reason = baselines[0]["reason"].as_str().unwrap();
    assert!(
        reason.contains("changed during the baseline") && reason.contains("1 unstaged"),
        "{reason}"
    );
    // The check itself passed; only the re-inspection withheld the verdict.
    assert_eq!(baselines[0]["results"][0]["status"], "passed");
}

#[tokio::test]
async fn untracked_build_output_from_a_check_does_not_withhold_the_verdict() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    harness
        .confirm(
            "fixture",
            0,
            vec![check(
                "cache",
                "import os; os.makedirs('__pycache__', exist_ok=True); open('__pycache__/x.pyc', 'w').write('cache'); print('running 1 tests')",
                true,
                30,
            )],
        )
        .await;
    let run = harness.baseline("fixture", false).await;
    let id = run["id"].as_str().unwrap().to_owned();
    let terminal = harness.terminal(&id).await;
    assert_eq!(terminal["state"], "completed", "{terminal}");
    let (_, baselines) = harness
        .request("GET", "/api/v1/projects/fixture/baselines", None)
        .await;
    assert_eq!(baselines[0]["status"], "passed", "{baselines}");
    let events = harness.events(&id).await;
    let noted = events
        .iter()
        .find(|e| e["type"] == "checkout.untracked")
        .expect("untracked output is recorded");
    assert_eq!(noted["payload"]["untracked"], 1);
    assert_eq!(noted["payload"]["paths"][0], "__pycache__/");
}

#[tokio::test]
async fn restart_interrupts_a_running_baseline() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    harness
        .confirm(
            "fixture",
            0,
            vec![check("slow", "import time; time.sleep(60)", true, 120)],
        )
        .await;
    let run = harness.baseline("fixture", false).await;
    let id = run["id"].as_str().unwrap().to_owned();
    for _ in 0..200 {
        if harness
            .events(&id)
            .await
            .iter()
            .any(|e| e["type"] == "check.spawned")
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    // Startup recovery on the same database, as a restarted runtime performs it
    // before accepting work: the abandoned attempt and its baseline are interrupted
    // and can never be reported passed, even though the old worker is still alive.
    let mut store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    assert_eq!(
        store.get_run(&id).unwrap().unwrap().state,
        luuna_domain::RunState::Running
    );
    assert_eq!(store.interrupt_active_runs().unwrap(), 1);
    assert_eq!(
        store.get_run(&id).unwrap().unwrap().state,
        luuna_domain::RunState::Interrupted
    );
    let baseline = store.baselines("fixture").unwrap().remove(0);
    assert_eq!(baseline.status, luuna_domain::BaselineStatus::Interrupted);
    assert!(baseline.finished_at.is_some());
    assert!(baseline.results.is_empty());
    // The stale worker cannot resurrect the run once it is cancelled and finishes.
    harness.state.cancel_active();
    tokio::time::sleep(Duration::from_millis(500)).await;
    let (_, run) = harness
        .request("GET", &format!("/api/v1/runs/{id}"), None)
        .await;
    assert_eq!(run["state"], "interrupted");
    let (_, baselines) = harness
        .request("GET", "/api/v1/projects/fixture/baselines", None)
        .await;
    assert_eq!(baselines[0]["status"], "interrupted");
}
