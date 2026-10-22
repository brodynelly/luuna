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
    // Recorded references use the identity the artifact route serves, and
    // each digest is keyed by its reference.
    assert_eq!(
        result["artifact_refs"],
        json!(["unit.stdout", "unit.stderr"])
    );
    for reference in ["unit.stdout", "unit.stderr"] {
        let digest = result["artifact_hashes"][reference].as_str().unwrap();
        let (status, body) = harness
            .raw(
                "GET",
                &format!("/api/v1/runs/{id}/artifacts/{reference}"),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{reference}");
        assert_eq!(digest, luuna_executor::sha256_hex(&body), "{reference}");
    }
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
    let legacy_dir = harness.root.join("artifacts").join(&id);
    fs::write(
        legacy_dir.join("Unit.stdout.log"),
        b"historical uppercase evidence",
    )
    .unwrap();
    let (status, body) = harness
        .raw(
            "GET",
            &format!("/api/v1/runs/{id}/artifacts/Unit.stdout"),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(&body[..], b"historical uppercase evidence");
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

#[tokio::test]
async fn explicit_shutdown_interrupts_a_running_baseline_instead_of_cancelling_it() {
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
    harness.state.shutdown().await;
    let terminal = harness.terminal(&id).await;
    assert_eq!(terminal["state"], "interrupted", "{terminal}");
    let (_, baselines) = harness
        .request("GET", "/api/v1/projects/fixture/baselines", None)
        .await;
    assert_eq!(baselines[0]["status"], "interrupted");
    assert!(baselines[0]["reason"]
        .as_str()
        .unwrap()
        .contains("runtime shutdown"));
    let results = baselines[0]["results"].as_array().unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["status"], "cancelled");
    assert!(!harness
        .events(&id)
        .await
        .iter()
        .any(|e| e["type"] == "run.cancelled"));
}

#[tokio::test]
async fn a_skip_only_suite_never_passes_a_baseline() {
    // Acceptance A07: an empty or skip-only baseline does not pass the required test gate.
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    fs::write(
        repo.path().join("test_gated.py"),
        "import unittest\n\n\nclass Gated(unittest.TestCase):\n    @unittest.skip('needs a device')\n    def test_a(self):\n        pass\n\n    @unittest.skip('needs a device')\n    def test_b(self):\n        pass\n",
    )
    .unwrap();
    git(repo.path(), &["add", "test_gated.py"]);
    git(repo.path(), &["commit", "-q", "-m", "gated tests"]);
    register(&harness, repo.path()).await;
    let mut unit = check("unit", "", true, 30);
    unit["args"] = json!(["-B", "-m", "unittest", "-v", "test_gated"]);
    harness.confirm("fixture", 0, vec![unit]).await;
    let run = harness.baseline("fixture", false).await;
    let id = run["id"].as_str().unwrap().to_owned();
    assert_eq!(harness.terminal(&id).await["state"], "failed");
    let (_, baselines) = harness
        .request("GET", "/api/v1/projects/fixture/baselines", None)
        .await;
    assert_eq!(baselines[0]["status"], "blocked", "{baselines}");
    let result = &baselines[0]["results"][0];
    assert_eq!(result["status"], "blocked");
    assert_eq!(result["exit_code"], 0);
    assert_eq!(result["tests_detected"], 0);
    assert!(result["reason"]
        .as_str()
        .unwrap()
        .starts_with("empty suite"));
}

#[tokio::test]
async fn a_second_baseline_for_a_repository_is_refused_while_one_runs() {
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
    let (status, body) = harness
        .request(
            "POST",
            "/api/v1/projects/fixture/baselines",
            Some(json!({"repository_id": "app"})),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(
        body["error"].as_str().unwrap().contains(&id),
        "the refusal names the running baseline: {body}"
    );
    let (status, _) = harness
        .request("POST", &format!("/api/v1/runs/{id}/cancel"), None)
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(harness.terminal(&id).await["state"], "cancelled");
    // Once it settled, the repository accepts a baseline again.
    let next = harness.baseline("fixture", false).await;
    let next = next["id"].as_str().unwrap().to_owned();
    let (status, _) = harness
        .request("POST", &format!("/api/v1/runs/{next}/cancel"), None)
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    harness.terminal(&next).await;
}

#[tokio::test]
async fn untracked_output_of_an_earlier_baseline_is_named_and_ignoring_it_resolves_the_block() {
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
                "import os; os.makedirs('__pycache__', exist_ok=True); open('__pycache__/x.pyc', 'w').write('cache'); print('cached')",
                true,
                30,
            )],
        )
        .await;
    let first = harness.baseline("fixture", false).await;
    let first = first["id"].as_str().unwrap().to_owned();
    assert_eq!(harness.terminal(&first).await["state"], "completed");
    // The next baseline in a row meets the output the first one wrote.
    let second = harness.baseline("fixture", false).await;
    let second = second["id"].as_str().unwrap().to_owned();
    assert_eq!(harness.terminal(&second).await["state"], "failed");
    let (_, baselines) = harness
        .request("GET", "/api/v1/projects/fixture/baselines", None)
        .await;
    let blocked = baselines
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["run_id"] == second)
        .unwrap();
    assert_eq!(blocked["status"], "blocked");
    let reason = blocked["reason"].as_str().unwrap();
    assert!(
        reason.contains("__pycache__/") && reason.contains(".gitignore"),
        "the reason names the paths and the remedy: {reason}"
    );
    assert!(!reason.contains("stash"), "{reason}");
    // Git-ignored output never blocks a baseline.
    fs::write(repo.path().join(".gitignore"), "__pycache__/\n").unwrap();
    git(repo.path(), &["add", ".gitignore"]);
    git(repo.path(), &["commit", "-q", "-m", "ignore build output"]);
    let third = harness.baseline("fixture", false).await;
    let third = third["id"].as_str().unwrap().to_owned();
    assert_eq!(harness.terminal(&third).await["state"], "completed");
}

#[tokio::test]
async fn a_check_that_moves_head_cannot_produce_passed_evidence() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    harness
        .confirm(
            "fixture",
            0,
            vec![check(
                "commit",
                "import subprocess; subprocess.run(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'moved by a check'], check=True); print('committed')",
                true,
                30,
            )],
        )
        .await;
    let before = git(repo.path(), &["rev-parse", "HEAD"]);
    let run = harness.baseline("fixture", false).await;
    let id = run["id"].as_str().unwrap().to_owned();
    assert_eq!(harness.terminal(&id).await["state"], "failed");
    let after = git(repo.path(), &["rev-parse", "HEAD"]);
    assert_ne!(before, after);
    let (_, baselines) = harness
        .request("GET", "/api/v1/projects/fixture/baselines", None)
        .await;
    assert_eq!(baselines[0]["status"], "failed", "{baselines}");
    assert_eq!(baselines[0]["identity"]["commit"], before);
    let reason = baselines[0]["reason"].as_str().unwrap();
    assert!(
        reason.contains(&format!("HEAD moved from {before} to {after}")),
        "{reason}"
    );
    assert_eq!(baselines[0]["results"][0]["status"], "passed");
}

#[tokio::test]
async fn a_result_that_cannot_be_persisted_settles_the_baseline_instead_of_leaving_it_running() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    harness
        .confirm("fixture", 0, vec![check("unit", "print('ok')", true, 30)])
        .await;
    // Every check-result write fails, as on a full disk, while the rest of
    // the database stays writable.
    let database = harness.root.join("luuna.sqlite3");
    let inject = |sql: &str| {
        let status = Command::new(python())
            .args([
                "-c",
                "import sqlite3, sys; c = sqlite3.connect(sys.argv[1]); c.execute(sys.argv[2]); c.commit()",
            ])
            .arg(&database)
            .arg(sql)
            .status()
            .unwrap();
        assert!(status.success(), "{sql}");
    };
    inject("CREATE TRIGGER luuna_test_failing_results BEFORE INSERT ON check_results BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END");
    let run = harness.baseline("fixture", false).await;
    let id = run["id"].as_str().unwrap().to_owned();
    let terminal = harness.terminal(&id).await;
    assert_eq!(terminal["state"], "failed", "{terminal}");
    let (_, baselines) = harness
        .request("GET", "/api/v1/projects/fixture/baselines", None)
        .await;
    assert_eq!(
        baselines[0]["status"], "failed",
        "the baseline is settled, not left running: {baselines}"
    );
    assert!(baselines[0]["reason"]
        .as_str()
        .unwrap()
        .contains("cannot persist check result"));
    inject("DROP TRIGGER luuna_test_failing_results");
    let next = harness.baseline("fixture", false).await;
    let next = next["id"].as_str().unwrap().to_owned();
    assert_eq!(harness.terminal(&next).await["state"], "completed");
}

/// A runtime binary started on a free loopback port with the given data directory.
#[cfg(target_os = "linux")]
struct RuntimeProcess {
    child: std::process::Child,
    port: u16,
}

#[cfg(target_os = "linux")]
impl RuntimeProcess {
    fn start(data_dir: &Path) -> Self {
        use std::io::BufRead;
        let mut child = Command::new(env!("CARGO_BIN_EXE_luuna-runtime"))
            .env("LUUNA_DATA_DIR", data_dir)
            .env("LUUNA_API_TOKEN", TOKEN)
            .env("LUUNA_PORT", "0")
            .env("LUUNA_PI_COMMAND", python())
            .env("LUUNA_GIT_COMMAND", "git")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        // Keep draining stderr so the runtime never writes into a closed pipe.
        let stderr = std::io::BufReader::new(child.stderr.take().unwrap());
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for line in stderr.lines().map_while(Result::ok) {
                if let Some((_, rest)) = line.split_once("127.0.0.1:") {
                    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
                    let _ = sender.send(digits.parse::<u16>().ok());
                }
            }
        });
        let port = receiver
            .recv_timeout(Duration::from_secs(60))
            .ok()
            .flatten()
            .expect("the runtime reports its listening address");
        Self { child, port }
    }

    /// One request over a fresh connection; the body is parsed as JSON.
    fn request(&self, method: &str, path: &str, body: Option<Value>) -> (u16, Value) {
        use std::io::{Read, Write};
        let body = body.map(|b| b.to_string()).unwrap_or_default();
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        write!(
            stream,
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {TOKEN}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        let text = String::from_utf8_lossy(&response);
        let status = text
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse().ok())
            .unwrap_or(0);
        let payload = text.split_once("\r\n\r\n").map(|(_, b)| b).unwrap_or("");
        // Without a declared length the body may arrive chunked.
        let json = serde_json::from_str(payload).unwrap_or_else(|_| {
            payload
                .find(['[', '{'])
                .and_then(|start| {
                    let end = payload.rfind([']', '}'])?;
                    serde_json::from_str(&payload[start..=end]).ok()
                })
                .unwrap_or(Value::Null)
        });
        (status, json)
    }
}

#[cfg(target_os = "linux")]
impl Drop for RuntimeProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn restart_after_a_hard_kill_reaps_the_check_processes_the_dead_runtime_left() {
    let alive = |pid: u64| {
        std::fs::read_to_string(format!("/proc/{pid}/stat"))
            .ok()
            .and_then(|stat| stat.rsplit(')').next()?.trim_start().chars().next())
            .is_some_and(|state| state != 'Z' && state != 'X')
    };
    let data = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let scratch = tempfile::tempdir().unwrap();
    let marker = scratch.path().join("orphan.pid");
    clean_repository(repo.path());
    let runtime = RuntimeProcess::start(data.path());
    let (status, view) = runtime.request(
        "POST",
        "/api/v1/projects",
        Some(json!({"id":"fixture","name":"Fixture","repositories":[{"id":"app","path":repo.path().to_string_lossy()}]})),
    );
    assert_eq!(status, 201, "{view}");
    // A silent descendant: it holds no pipe, so nothing ends it with the runtime.
    let script = format!(
        "import subprocess as s, sys, time; p = s.Popen([sys.executable, '-c', 'import time; time.sleep(120)'], stdin=s.DEVNULL, stdout=s.DEVNULL, stderr=s.DEVNULL); open({marker:?}, 'w').write(str(p.pid)); time.sleep(120)",
        marker = marker.to_string_lossy()
    );
    let manifest = json!({
        "schema_version": "0.1", "id": "fixture", "name": "Fixture", "revision": 1,
        "repositories": [{"id": "app", "remote": "https://example.invalid/fixture.git", "default_branch": "main",
            "profiles": ["python"], "execution": "native", "checks": [check("hold", &script, true, 300)]}],
        "relationships": [],
        "policy": {"approval": "plan", "testing_prerequisite": true, "publish": "automatic_pr", "merge": "human",
            "max_explorers": 1, "max_implementers": 1, "max_task_repairs": 2},
    });
    let (status, view) = runtime.request(
        "PUT",
        "/api/v1/projects/fixture/manifest",
        Some(json!({"expected_revision": 0, "manifest": manifest})),
    );
    assert_eq!(status, 200, "{view}");
    let (status, run) = runtime.request(
        "POST",
        "/api/v1/projects/fixture/baselines",
        Some(json!({"repository_id": "app"})),
    );
    assert_eq!(status, 202, "{run}");
    let id = run["id"].as_str().unwrap().to_owned();
    let mut orphan = None;
    for _ in 0..400 {
        let (_, events) = runtime.request("GET", &format!("/api/v1/runs/{id}/events"), None);
        let spawned = events.as_array().into_iter().flatten().any(|e| {
            e["type"] == "check.spawned" && e["payload"]["process_group"]["marker"].is_string()
        });
        orphan = std::fs::read_to_string(&marker)
            .ok()
            .and_then(|pid| pid.trim().parse::<u64>().ok());
        if spawned && orphan.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let orphan = orphan.expect("the check started its descendant");
    // A hard kill: no shutdown path runs.
    drop(runtime);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(alive(orphan), "the descendant outlives the killed runtime");

    let restarted = RuntimeProcess::start(data.path());
    assert!(
        !alive(orphan),
        "restart recovery reaps the recorded survivor"
    );
    let (_, run) = restarted.request("GET", &format!("/api/v1/runs/{id}"), None);
    assert_eq!(run["state"], "interrupted", "{run}");
    let (_, events) = restarted.request("GET", &format!("/api/v1/runs/{id}/events"), None);
    let reaped = events
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["type"] == "check.orphans_reaped")
        .unwrap_or_else(|| panic!("the reap is recorded: {events}"));
    assert_eq!(reaped["payload"]["recipe_id"], "hold");
    assert!(reaped["payload"]["processes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p.as_str().unwrap().contains(&format!("pid {orphan}"))));
    let (_, baselines) = restarted.request("GET", "/api/v1/projects/fixture/baselines", None);
    assert_eq!(baselines[0]["status"], "interrupted");
}
