//! M2c/M3 through the authenticated API with the synthetic Pi fixture: exact
//! approval, scoped writers, real candidate checks, fresh reviews and bounded
//! repair. No model is involved and the developer checkout is never written.
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
        let root = std::env::temp_dir().join(format!("luuna-writer-test-{}", uuid::Uuid::new_v4()));
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/pi-rpc/mock_pi.py")
            .canonicalize()
            .unwrap();
        let state = AppState::open(RuntimeConfig {
            data_dir: root.clone(),
            pi_program: python().into(),
            pi_launcher_args: vec![script.to_string_lossy().into_owned()],
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
    async fn run(&self, id: &str) -> Value {
        self.request("GET", &format!("/api/v1/runs/{id}"), None)
            .await
            .1
    }
    /// Wait until the run leaves `Implementing`/`Running`; `validating` is the M2c settle state.
    async fn settled(&self, id: &str) -> Value {
        for _ in 0..600 {
            let run = self.run(id).await;
            if matches!(
                run["state"].as_str(),
                Some("validating" | "completed" | "failed" | "cancelled" | "interrupted")
            ) {
                return run;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("run did not settle: {}", self.run(id).await);
    }
    async fn events(&self, id: &str) -> Vec<Value> {
        self.request("GET", &format!("/api/v1/runs/{id}/events"), None)
            .await
            .1
            .as_array()
            .cloned()
            .unwrap_or_default()
    }
    async fn wait_for_event(&self, id: &str, kind: &str) {
        for _ in 0..600 {
            if self.events(id).await.iter().any(|e| e["type"] == kind) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!("{kind} never appeared for {id}");
    }
    async fn confirm(&self, revision: u64, checks: Vec<Value>) -> Value {
        let manifest = json!({
            "schema_version": "0.1", "id": "fixture", "name": "Fixture", "revision": revision + 1,
            "repositories": [{"id": "app", "remote": "https://example.invalid/fixture.git", "default_branch": "main",
                "profiles": ["python"], "execution": "native", "checks": checks}],
            "relationships": [],
            "policy": {"approval": "plan", "testing_prerequisite": true, "publish": "automatic_pr", "merge": "human",
                "max_explorers": 1, "max_implementers": 1, "max_task_repairs": 2},
        });
        let (status, view) = self
            .request(
                "PUT",
                "/api/v1/projects/fixture/manifest",
                Some(json!({"expected_revision": revision, "manifest": manifest})),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{view}");
        view
    }
    async fn baseline(&self) {
        let (status, run) = self
            .request(
                "POST",
                "/api/v1/projects/fixture/baselines",
                Some(json!({"repository_id": "app"})),
            )
            .await;
        assert_eq!(status, StatusCode::ACCEPTED, "{run}");
        let run = self.settled(run["id"].as_str().unwrap()).await;
        assert_eq!(run["state"], "completed", "{run}");
    }
    async fn ticket(&self, scenario: &str) -> Value {
        let (status, ticket) = self
            .request(
                "POST",
                "/api/v1/projects/fixture/tickets",
                Some(json!({
                    "idempotency_key": format!("key-{}", uuid::Uuid::new_v4()),
                    "title": "Implement the greeting",
                    "intent": "Make src/main.py print the greeting.",
                    "acceptance_criteria": [format!("fixture:{scenario}"), "main prints the greeting"],
                    "repository_ids": ["app"],
                })),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{ticket}");
        ticket
    }
    async fn plan(&self, ticket_id: &str, budgets: Value) -> Value {
        let (status, opened) = self
            .request(
                "POST",
                &format!("/api/v1/tickets/{ticket_id}/plans"),
                Some(json!({
                    "task": {"repository_id": "app", "paths": ["src"], "operations": ["read", "write"]},
                    "budgets": budgets,
                })),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{opened}");
        opened
    }
    async fn approve(&self, plan: &Value) -> Value {
        let (status, approved) = self
            .request(
                "POST",
                &format!("/api/v1/plans/{}/approvals", plan["id"].as_str().unwrap()),
                Some(json!({"plan_revision": plan["revision"], "plan_hash": plan["hash"], "approved_by": "developer"})),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{approved}");
        approved
    }
    async fn implement(&self, run_id: &str) -> (StatusCode, Value) {
        self.request(
            "POST",
            &format!("/api/v1/runs/{run_id}/implement"),
            Some(json!({"provider": "test", "model": "synthetic"})),
        )
        .await
    }
    async fn candidate(&self, run_id: &str) -> Value {
        let (status, body) = self
            .request("GET", &format!("/api/v1/runs/{run_id}/candidate"), None)
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        body
    }
    async fn candidate_action(
        &self,
        run_id: &str,
        action: &str,
        hash: &Value,
    ) -> (StatusCode, Value) {
        self.request(
            "POST",
            &format!("/api/v1/runs/{run_id}/{action}"),
            Some(json!({"candidate_hash":hash,"provider":"test","model":"synthetic"})),
        )
        .await
    }
    async fn validate_with_repairs(&self, run_id: &str, hash: &Value) -> (StatusCode, Value) {
        self.request(
            "POST",
            &format!("/api/v1/runs/{run_id}/validate"),
            Some(json!({"candidate_hash":hash,"provider":"test","model":"synthetic","auto_repair":true})),
        )
        .await
    }
    async fn candidate_settled(&self, run_id: &str) -> Value {
        for _ in 0..600 {
            let candidate = self.candidate(run_id).await;
            if candidate["active"] == false
                && !matches!(
                    candidate["evidence"]["status"].as_str(),
                    Some("pending" | "validating" | "reviewing")
                )
            {
                return candidate;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!("candidate did not settle: {}", self.candidate(run_id).await);
    }
    /// Register, confirm, baseline, ticket, plan, approve: an approved workflow run.
    async fn approved(&self, repo: &Path, scenario: &str, budgets: Value) -> (String, Value) {
        let ticket = self.ticket(scenario).await;
        let opened = self.plan(ticket["id"].as_str().unwrap(), budgets).await;
        self.approve(&opened["plan"]).await;
        let _ = repo;
        (
            opened["run"]["id"].as_str().unwrap().to_owned(),
            opened["plan"].clone(),
        )
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
fn check(id: &str, code: &str) -> Value {
    json!({"id": id, "executable": python(), "args": ["-c", code], "required": true,
        "timeout_seconds": 30, "capabilities": ["python"], "cwd": "."})
}
fn passing_check() -> Value {
    check(
        "unit",
        "print('running 1 tests'); print('test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured')",
    )
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
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::write(dir.join("README.md"), "fixture\n").unwrap();
    fs::write(dir.join("src/main.py"), "print('fixture')\n").unwrap();
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
/// Working files and git index of the developer checkout; the shared object store may grow.
fn snapshot(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let key = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if key == ".git/worktrees" || key == ".git/objects" {
                continue;
            }
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                out.push((key, fs::read(&path).unwrap()));
            }
        }
    }
    walk(dir, dir, &mut out);
    out.sort();
    out
}
async fn ready(harness: &Harness, repo: &Path) {
    clean_repository(repo);
    register(harness, repo).await;
    harness.confirm(0, vec![passing_check()]).await;
    harness.baseline().await;
}

#[tokio::test]
async fn an_approved_writer_changes_only_its_worktree_and_records_a_candidate() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    ready(&harness, repo.path()).await;
    fs::write(repo.path().join("notes.txt"), "developer scratch\n").unwrap();
    let before = snapshot(repo.path());
    let head = git(repo.path(), &["rev-parse", "HEAD"]);
    let (run_id, plan) = harness
        .approved(repo.path(), "write_in_scope", json!({}))
        .await;
    assert_eq!(plan["ticket_revision"], 1);
    assert_eq!(plan["base_commits"]["app"], head);
    assert_eq!(plan["required_checks"][0]["id"], "unit");
    assert_eq!(plan["budgets"]["max_workers"], 1);

    let (status, run) = harness.implement(&run_id).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{run}");
    assert_eq!(run["state"], "implementing");
    let settled = harness.settled(&run_id).await;
    assert_eq!(settled["state"], "validating", "{settled}");

    let events = harness.events(&run_id).await;
    let types: Vec<&str> = events.iter().map(|e| e["type"].as_str().unwrap()).collect();
    for expected in [
        "plan.ready",
        "plan.approved",
        "run.implementing",
        "attempt.started",
        "worktree.leased",
        "worktree.created",
        "pi.spawned",
        "pi.fixture_args",
        "pi.tool_execution_end",
        "pi.agent_settled",
        "worktree.changes",
        "candidate.recorded",
        "worktree.released",
        "attempt.finished",
        "run.validating",
    ] {
        assert!(
            types.contains(&expected),
            "{expected} missing from {types:?}"
        );
    }
    let spawned = events.iter().find(|e| e["type"] == "pi.spawned").unwrap();
    let fixture = events
        .iter()
        .find(|e| e["type"] == "pi.fixture_args")
        .unwrap();
    assert_eq!(fixture["payload"]["tools"], "read,grep,find,ls,edit,write");
    assert_eq!(fixture["payload"]["no_tools"], false);
    assert!(fixture["payload"]["extensions"][0]
        .as_str()
        .unwrap()
        .ends_with("luuna-scope-guard.js"));
    let worktree = PathBuf::from(spawned["payload"]["scope"]["root"].as_str().unwrap());
    assert_eq!(fixture["payload"]["scope"]["paths"], json!(["src"]));
    assert!(
        worktree.starts_with(&harness.root),
        "{}",
        worktree.display()
    );
    // The synthetic writer writes through Python text mode, which emits CRLF on Windows.
    assert_eq!(
        fs::read_to_string(worktree.join("src/main.py"))
            .unwrap()
            .replace("\r\n", "\n"),
        "print('implemented by the synthetic writer')\n"
    );
    assert!(!worktree.join("notes.txt").exists());

    let candidate = &events
        .iter()
        .find(|e| e["type"] == "candidate.recorded")
        .unwrap()["payload"]["candidate"];
    assert_eq!(candidate["plan_hash"], plan["hash"]);
    let commit = candidate["repository_commits"]["app"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(git(&worktree, &["rev-parse", "HEAD"]), commit);
    assert_eq!(
        git(&worktree, &["log", "-1", "--format=%an"]),
        "Luuna Writer"
    );
    assert_eq!(settled["metadata"]["kind"], "workflow");

    let (_, leases) = harness
        .request("GET", &format!("/api/v1/runs/{run_id}/worktrees"), None)
        .await;
    assert_eq!(leases[0]["state"], "released");
    assert_eq!(leases[0]["candidate_commit"], commit);
    assert_eq!(leases[0]["base_commit"], head);
    let (_, attempts) = harness
        .request("GET", &format!("/api/v1/runs/{run_id}/attempts"), None)
        .await;
    assert_eq!(attempts[0]["state"], "completed");
    assert_eq!(attempts[0]["number"], 1);
    assert_eq!(attempts[0]["payload"]["commit"], commit);

    // The developer checkout: untouched files and index, same HEAD and branch, scratch kept.
    assert_eq!(snapshot(repo.path()), before);
    assert_eq!(git(repo.path(), &["rev-parse", "HEAD"]), head);
    assert_eq!(git(repo.path(), &["branch", "--show-current"]), "main");
    assert_eq!(
        fs::read_to_string(repo.path().join("src/main.py")).unwrap(),
        "print('fixture')\n"
    );
    // A validating run has no active process to cancel and cannot be implemented again.
    assert_eq!(
        harness
            .request("POST", &format!("/api/v1/runs/{run_id}/cancel"), None)
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(harness.implement(&run_id).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn stale_or_missing_approval_base_recipe_baseline_and_repository_are_refused() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    harness.confirm(0, vec![passing_check()]).await;
    let ticket = harness.ticket("write_in_scope").await;
    let ticket_id = ticket["id"].as_str().unwrap().to_owned();
    // Idempotent creation returns the same ticket; an unrelated repository is refused at planning.
    let (status, replay) = harness
        .request("POST", "/api/v1/projects/fixture/tickets", Some(json!({
            "idempotency_key": "fixed-key", "title": "T", "intent": "I", "acceptance_criteria": ["c"], "repository_ids": ["app"]})))
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, again) = harness
        .request("POST", "/api/v1/projects/fixture/tickets", Some(json!({
            "idempotency_key": "fixed-key", "title": "T", "intent": "I", "acceptance_criteria": ["c"], "repository_ids": ["app"]})))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(again["id"], replay["id"]);
    let (status, body) = harness
        .request(
            "POST",
            &format!("/api/v1/tickets/{ticket_id}/plans"),
            Some(json!({
            "task": {"repository_id": "other", "paths": ["src"], "operations": ["write"]}})),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("not part of ticket"));

    // Without approval nothing is scheduled.
    let opened = harness.plan(&ticket_id, json!({})).await;
    let run_id = opened["run"]["id"].as_str().unwrap().to_owned();
    assert_eq!(opened["run"]["state"], "plan_ready");
    let (status, body) = harness.implement(&run_id).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("approval is required"));
    // An approval must name the exact hash.
    let (status, _) = harness
        .request("POST", &format!("/api/v1/plans/{}/approvals", opened["plan"]["id"].as_str().unwrap()),
            Some(json!({"plan_revision": 1, "plan_hash": "sha256:not-the-hash", "approved_by": "dev"})))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    harness.approve(&opened["plan"]).await;
    // Approved, but no baseline exists for this commit.
    let (status, body) = harness.implement(&run_id).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(
        body["error"].as_str().unwrap().contains("baseline"),
        "{body}"
    );
    assert_eq!(harness.run(&run_id).await["state"], "approved");
    harness.baseline().await;

    // A newer plan revision makes the earlier approval stale.
    let second = harness.plan(&ticket_id, json!({})).await;
    assert_eq!(second["plan"]["revision"], 2);
    let (status, body) = harness.implement(&run_id).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(body["error"].as_str().unwrap().contains("stale"), "{body}");
    let second_run = second["run"]["id"].as_str().unwrap().to_owned();
    harness.approve(&second["plan"]).await;

    // A changed recipe is a new manifest revision; the plan no longer binds to it.
    let (status, baselines_before) = harness
        .request("GET", "/api/v1/projects/fixture/baselines", None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(baselines_before.as_array().unwrap().len(), 1);
    harness
        .confirm(1, vec![check("unit", "print('running 2 tests'); print('test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured')")])
        .await;
    let (status, body) = harness.implement(&second_run).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(
        body["error"].as_str().unwrap().contains("manifest"),
        "{body}"
    );
    assert_eq!(harness.run(&second_run).await["state"], "approved");

    // Re-plan against the new manifest, approve, baseline, then move HEAD: the base changed.
    harness.baseline().await;
    let third = harness.plan(&ticket_id, json!({})).await;
    harness.approve(&third["plan"]).await;
    let third_run = third["run"]["id"].as_str().unwrap().to_owned();
    fs::write(repo.path().join("README.md"), "developer moved on\n").unwrap();
    git(repo.path(), &["commit", "-q", "-am", "developer commit"]);
    let (status, body) = harness.implement(&third_run).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(
        body["error"]
            .as_str()
            .unwrap()
            .contains("no longer the planned base"),
        "{body}"
    );
    assert_eq!(harness.run(&third_run).await["state"], "approved");
    let (_, leases) = harness
        .request("GET", &format!("/api/v1/runs/{third_run}/worktrees"), None)
        .await;
    assert!(leases.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn out_of_scope_changes_are_rejected_and_the_worktree_is_preserved() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    ready(&harness, repo.path()).await;
    let before = snapshot(repo.path());
    let (run_id, _) = harness
        .approved(repo.path(), "write_out_of_scope", json!({}))
        .await;
    assert_eq!(harness.implement(&run_id).await.0, StatusCode::ACCEPTED);
    let settled = harness.settled(&run_id).await;
    assert_eq!(settled["state"], "failed", "{settled}");
    let events = harness.events(&run_id).await;
    let finished = events.iter().find(|e| e["type"] == "run.failed").unwrap();
    let reason = finished["payload"]["reason"].as_str().unwrap();
    assert!(
        reason.contains("scope violation") && reason.contains("README.md"),
        "{reason}"
    );
    assert!(!events.iter().any(|e| e["type"] == "candidate.recorded"));
    let (_, leases) = harness
        .request("GET", &format!("/api/v1/runs/{run_id}/worktrees"), None)
        .await;
    assert_eq!(leases[0]["state"], "released");
    assert!(leases[0]["candidate_commit"].is_null());
    let worktree = PathBuf::from(leases[0]["path"].as_str().unwrap());
    assert!(
        worktree.join("README.md").exists(),
        "worktree preserved for inspection"
    );
    assert_eq!(
        fs::read_to_string(worktree.join("README.md"))
            .unwrap()
            .replace("\r\n", "\n"),
        "tampered outside the task paths\n"
    );
    assert_eq!(
        git(&worktree, &["rev-parse", "HEAD"]),
        git(repo.path(), &["rev-parse", "HEAD"]),
        "nothing was committed"
    );
    assert_eq!(snapshot(repo.path()), before);
    assert_eq!(
        fs::read_to_string(repo.path().join("README.md")).unwrap(),
        "fixture\n"
    );
}

#[tokio::test]
async fn budgets_fail_closed_on_cost_attempts_and_empty_results() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    ready(&harness, repo.path()).await;
    let (run_id, _) = harness
        .approved(
            repo.path(),
            "expensive",
            json!({"max_attempts": 1, "cost_usd_micros": 1000}),
        )
        .await;
    assert_eq!(harness.implement(&run_id).await.0, StatusCode::ACCEPTED);
    let settled = harness.settled(&run_id).await;
    assert_eq!(settled["state"], "failed", "{settled}");
    let events = harness.events(&run_id).await;
    let reason = events.iter().find(|e| e["type"] == "run.failed").unwrap()["payload"]["reason"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        reason.contains("budget exceeded") && reason.contains("cost"),
        "{reason}"
    );
    assert!(!events.iter().any(|e| e["type"] == "candidate.recorded"));
    let (_, attempts) = harness
        .request("GET", &format!("/api/v1/runs/{run_id}/attempts"), None)
        .await;
    assert_eq!(attempts[0]["state"], "failed");
    // The workflow is terminal; a fresh workflow with the attempt budget already used is refused.
    let (run_two, _) = harness
        .approved(repo.path(), "no_change", json!({"max_attempts": 1}))
        .await;
    assert_eq!(harness.implement(&run_two).await.0, StatusCode::ACCEPTED);
    let settled = harness.settled(&run_two).await;
    assert_eq!(settled["state"], "failed", "{settled}");
    let events = harness.events(&run_two).await;
    let reason = events.iter().find(|e| e["type"] == "run.failed").unwrap()["payload"]["reason"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(reason.contains("without changing"), "{reason}");
    assert_eq!(
        harness.implement(&run_two).await.0,
        StatusCode::CONFLICT,
        "a failed workflow is not approved"
    );
}

#[tokio::test]
async fn a_second_writer_is_refused_and_cancellation_preserves_the_worktree() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    ready(&harness, repo.path()).await;
    let (slow, _) = harness
        .approved(repo.path(), "slow", json!({"timeout_seconds": 120}))
        .await;
    assert_eq!(harness.implement(&slow).await.0, StatusCode::ACCEPTED);
    harness.wait_for_event(&slow, "pi.agent_start").await;
    // A second approved workflow on the same repository cannot start a writer.
    let (second, _) = harness
        .approved(repo.path(), "write_in_scope", json!({}))
        .await;
    let (status, body) = harness.implement(&second).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(
        body["error"].as_str().unwrap().contains("active writer"),
        "{body}"
    );
    assert_eq!(harness.run(&second).await["state"], "approved");
    let (status, body) = harness.implement(&slow).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    // Cancel the running writer: Pi is reaped, the attempt and lease settle, files stay.
    let (status, _) = harness
        .request("POST", &format!("/api/v1/runs/{slow}/cancel"), None)
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let settled = harness.settled(&slow).await;
    assert_eq!(settled["state"], "cancelled", "{settled}");
    let (_, leases) = harness
        .request("GET", &format!("/api/v1/runs/{slow}/worktrees"), None)
        .await;
    assert_eq!(leases[0]["state"], "released");
    assert!(PathBuf::from(leases[0]["path"].as_str().unwrap())
        .join("src/main.py")
        .exists());
    let (_, attempts) = harness
        .request("GET", &format!("/api/v1/runs/{slow}/attempts"), None)
        .await;
    assert_eq!(attempts[0]["state"], "cancelled");
    // The repository is free again.
    assert_eq!(harness.implement(&second).await.0, StatusCode::ACCEPTED);
    assert_eq!(harness.settled(&second).await["state"], "validating");
}

#[tokio::test]
async fn restart_interrupts_the_writer_and_abandons_its_lease_with_files_kept() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    ready(&harness, repo.path()).await;
    let (slow, _) = harness
        .approved(repo.path(), "slow", json!({"timeout_seconds": 120}))
        .await;
    assert_eq!(harness.implement(&slow).await.0, StatusCode::ACCEPTED);
    harness.wait_for_event(&slow, "pi.agent_start").await;
    // Startup recovery on the same database, as a restarted runtime performs it.
    let mut store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    assert_eq!(store.interrupt_active_runs().unwrap(), 1);
    assert_eq!(harness.run(&slow).await["state"], "interrupted");
    let leases = store.worktree_leases(&slow).unwrap();
    assert_eq!(leases[0].state, luuna_domain::LeaseState::Abandoned);
    assert!(Path::new(&leases[0].path).join("src/main.py").exists());
    assert_eq!(
        store.attempts(&slow).unwrap()[0].state,
        luuna_domain::AttemptState::Interrupted
    );
    assert!(store.active_worktree_leases().unwrap().is_empty());
}

#[tokio::test]
async fn optional_baseline_recipes_do_not_change_the_required_environment_identity() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    let mut optional = passing_check();
    optional["id"] = json!("optional");
    optional["required"] = json!(false);
    optional["executable"] = json!("git");
    optional["args"] = json!(["--version"]);
    optional["capabilities"] = json!([]);
    harness.confirm(0, vec![passing_check(), optional]).await;
    let (status, baseline) = harness
        .request(
            "POST",
            "/api/v1/projects/fixture/baselines",
            Some(json!({"repository_id": "app", "include_optional": true})),
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(
        harness.settled(baseline["id"].as_str().unwrap()).await["state"],
        "completed"
    );
    let (id, _) = harness
        .approved(repo.path(), "write_in_scope", json!({}))
        .await;
    let (status, body) = harness.implement(&id).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    assert_eq!(harness.settled(&id).await["state"], "validating");
}

#[tokio::test]
async fn candidate_checks_and_fresh_review_are_bound_to_the_complete_diff() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    ready(&harness, repo.path()).await;
    let before = snapshot(repo.path());
    let (id, plan) = harness
        .approved(repo.path(), "write_in_scope", json!({}))
        .await;
    assert_eq!(harness.implement(&id).await.0, StatusCode::ACCEPTED);
    assert_eq!(harness.settled(&id).await["state"], "validating");
    let pending = harness.candidate(&id).await;
    assert_eq!(pending["evidence"]["status"], "pending");
    assert_eq!(pending["active"], false);
    assert_eq!(pending["repair_allowed"], false);
    let candidate = &pending["evidence"]["candidate"];
    let hash = &candidate["hash"];
    let (status, diff) = harness
        .request("GET", &format!("/api/v1/runs/{id}/diff"), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{diff}");
    assert_eq!(diff["candidate_hash"], *hash);
    assert_eq!(diff["base_commit"], plan["base_commits"]["app"]);
    assert_eq!(diff["commit"], candidate["repository_commits"]["app"]);
    let diff_text = diff["diff"].as_str().unwrap();
    assert!(diff_text.contains("-print('fixture')"), "{diff_text}");
    assert!(
        diff_text.contains("+print('implemented by the synthetic writer')"),
        "{diff_text}"
    );

    let (status, response) = harness.candidate_action(&id, "validate", hash).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{response}");
    let completed = harness.candidate_settled(&id).await;
    assert_eq!(harness.run(&id).await["state"], "reviewed");
    let evidence = &completed["evidence"];
    assert_eq!(evidence["status"], "reviewed", "{completed}");
    assert_eq!(evidence["candidate"], *candidate);
    assert_eq!(evidence["validation_generation"], 1);
    let checks = evidence["results"].as_array().unwrap();
    assert_eq!(checks.len(), 1);
    assert_eq!(checks[0]["status"], "passed");
    assert_eq!(checks[0]["candidate_hash"], *hash);
    assert_eq!(checks[0]["commit"], candidate["repository_commits"]["app"]);
    assert_eq!(checks[0]["command"][0], python());
    assert_eq!(checks[0]["tests_detected"], 1);
    let review = &evidence["review"];
    assert_eq!(review["candidate_hash"], *hash);
    assert_eq!(review["verdict"], "passed");
    assert_ne!(review["reviewer_session"], evidence["implementer_session"]);
    assert!(review["reviewer_session"]
        .as_str()
        .unwrap()
        .starts_with("review-"));
    assert_eq!(completed["repair_allowed"], false);
    assert_ne!(
        harness.candidate_action(&id, "validate", hash).await.0,
        StatusCode::ACCEPTED
    );
    assert_ne!(
        harness.candidate_action(&id, "repair", hash).await.0,
        StatusCode::ACCEPTED
    );
    assert_eq!(snapshot(repo.path()), before);
}

#[tokio::test]
async fn failing_candidate_checks_require_a_new_repair_revision_and_fresh_evidence() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    harness.confirm(0, vec![check("unit", "from pathlib import Path; import sys; bad = 'seeded regression' in Path('src/main.py').read_text(); print('running 1 tests'); print('test result: FAILED. 0 passed; 1 failed' if bad else 'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured'); sys.exit(1 if bad else 0)")]).await;
    harness.baseline().await;
    let before = snapshot(repo.path());
    let (id, _) = harness
        .approved(repo.path(), "repair_in_scope", json!({"max_attempts":2}))
        .await;
    assert_eq!(harness.implement(&id).await.0, StatusCode::ACCEPTED);
    harness.settled(&id).await;
    let initial = harness.candidate(&id).await;
    let first = &initial["evidence"]["candidate"];
    assert_eq!(
        harness
            .candidate_action(&id, "validate", &first["hash"])
            .await
            .0,
        StatusCode::ACCEPTED
    );
    let failed = harness.candidate_settled(&id).await;
    assert_eq!(harness.run(&id).await["state"], "failed");
    assert_eq!(failed["evidence"]["status"], "failed", "{failed}");
    assert_eq!(failed["evidence"]["results"][0]["status"], "failed");
    assert!(failed["evidence"]["review"].is_null());
    assert_eq!(failed["repair_allowed"], true);
    assert!(!harness
        .events(&id)
        .await
        .iter()
        .any(|e| e["type"] == "review.started"));

    let (status, response) = harness
        .candidate_action(&id, "repair", &first["hash"])
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{response}");
    assert_eq!(harness.settled(&id).await["state"], "validating");
    let repaired = harness.candidate(&id).await;
    let second = &repaired["evidence"]["candidate"];
    assert_eq!(second["id"], first["id"]);
    assert_eq!(second["revision"], 2);
    assert_ne!(second["hash"], first["hash"]);
    assert_eq!(second["plan_hash"], first["plan_hash"]);
    assert!(repaired["evidence"]["results"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(repaired["evidence"]["review"].is_null());
    let (status, diff) = harness
        .request("GET", &format!("/api/v1/runs/{id}/diff"), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{diff}");
    assert!(diff["diff"]
        .as_str()
        .unwrap()
        .contains("repaired by the synthetic writer"));
    assert_eq!(
        harness
            .candidate_action(&id, "validate", &first["hash"])
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_ne!(
        harness
            .candidate_action(&id, "repair", &first["hash"])
            .await
            .0,
        StatusCode::ACCEPTED
    );
    assert_eq!(
        harness
            .candidate_action(&id, "validate", &second["hash"])
            .await
            .0,
        StatusCode::ACCEPTED
    );
    let passed = harness.candidate_settled(&id).await;
    assert_eq!(passed["evidence"]["status"], "reviewed", "{passed}");
    let result = &passed["evidence"]["results"][0];
    assert_eq!(result["candidate_hash"], second["hash"]);
    assert_eq!(result["status"], "passed");
    assert_ne!(result["id"], failed["evidence"]["results"][0]["id"]);
    assert_ne!(
        result["artifact_refs"],
        failed["evidence"]["results"][0]["artifact_refs"]
    );
    let store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    let history = store.candidates(&id).unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].status, luuna_domain::CandidateStatus::Failed);
    assert_eq!(history[0].results.len(), 1);
    assert!(history[0].review.is_none());
    assert_eq!(store.attempts(&id).unwrap().len(), 2);
    assert!(store.workflow_usage(&id).unwrap().cost_usd_micros >= 1500);
    assert_eq!(snapshot(repo.path()), before);
}

#[tokio::test]
async fn stale_candidate_hash_and_manual_worktree_changes_cannot_start_validation() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    ready(&harness, repo.path()).await;
    let (id, _) = harness
        .approved(repo.path(), "write_in_scope", json!({}))
        .await;
    assert_eq!(harness.implement(&id).await.0, StatusCode::ACCEPTED);
    harness.settled(&id).await;
    let candidate = harness.candidate(&id).await;
    let hash = &candidate["evidence"]["candidate"]["hash"];
    let (status, response) = harness
        .candidate_action(
            &id,
            "validate",
            &json!(format!("sha256:{}", "0".repeat(64))),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{response}");
    let (_, leases) = harness
        .request("GET", &format!("/api/v1/runs/{id}/worktrees"), None)
        .await;
    let path = PathBuf::from(leases[0]["path"].as_str().unwrap());
    fs::write(path.join("src/main.py"), "print('manual mutation')\n").unwrap();
    let (status, response) = harness.candidate_action(&id, "validate", hash).await;
    assert_eq!(status, StatusCode::CONFLICT, "{response}");
    assert_eq!(
        harness
            .request("GET", &format!("/api/v1/runs/{id}/diff"), None)
            .await
            .0,
        StatusCode::CONFLICT
    );
    let refused = harness.candidate(&id).await;
    assert_eq!(refused["evidence"]["candidate"]["hash"], *hash);
    assert_eq!(refused["evidence"]["validation_generation"], 0);
    assert_eq!(refused["active"], false);
    assert!(!harness
        .events(&id)
        .await
        .iter()
        .any(|e| e["type"] == "candidate.validation_started"));
}

#[tokio::test]
async fn a_check_mutating_tracked_content_cannot_supply_reviewable_evidence() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    harness.confirm(0, vec![check("unit", "from pathlib import Path; p = Path('src/main.py'); candidate = 'implemented by' in p.read_text(); p.write_text(\"print('mutated by check')\\n\") if candidate else None; print('running 1 tests'); print('test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured')")]).await;
    harness.baseline().await;
    let before = snapshot(repo.path());
    let (id, _) = harness
        .approved(repo.path(), "write_in_scope", json!({}))
        .await;
    assert_eq!(harness.implement(&id).await.0, StatusCode::ACCEPTED);
    harness.settled(&id).await;
    let pending = harness.candidate(&id).await;
    let hash = &pending["evidence"]["candidate"]["hash"];
    assert_eq!(
        harness.candidate_action(&id, "validate", hash).await.0,
        StatusCode::ACCEPTED
    );
    let failed = harness.candidate_settled(&id).await;
    assert_eq!(failed["evidence"]["status"], "failed", "{failed}");
    assert_eq!(failed["evidence"]["candidate"]["hash"], *hash);
    assert_eq!(failed["evidence"]["results"][0]["status"], "passed");
    assert!(
        failed["evidence"]["reason"]
            .as_str()
            .unwrap()
            .contains("tracked"),
        "{failed}"
    );
    assert!(failed["evidence"]["review"].is_null());
    assert!(!harness
        .events(&id)
        .await
        .iter()
        .any(|e| e["type"] == "review.started"));
    assert_eq!(snapshot(repo.path()), before);
}

#[tokio::test]
async fn blocking_and_malformed_independent_reviews_never_pass() {
    for (scenario, expected_state, reason) in [
        (
            "review_blocking",
            "paused",
            "independent review did not pass",
        ),
        (
            "review_malformed",
            "failed",
            "invalid structured reviewer response",
        ),
        ("review_stale", "failed", "candidate"),
        ("review_extension_error", "failed", "extension"),
    ] {
        let harness = Harness::new();
        let repo = tempfile::tempdir().unwrap();
        ready(&harness, repo.path()).await;
        let (id, _) = harness
            .approved(repo.path(), scenario, json!({"max_attempts":1}))
            .await;
        assert_eq!(harness.implement(&id).await.0, StatusCode::ACCEPTED);
        harness.settled(&id).await;
        let pending = harness.candidate(&id).await;
        let hash = &pending["evidence"]["candidate"]["hash"];
        assert_eq!(
            harness.candidate_action(&id, "validate", hash).await.0,
            StatusCode::ACCEPTED
        );
        let result = harness.candidate_settled(&id).await;
        assert_eq!(result["evidence"]["status"], expected_state, "{result}");
        assert_eq!(harness.run(&id).await["state"], expected_state);
        assert_eq!(result["evidence"]["results"][0]["status"], "passed");
        assert!(
            result["evidence"]["reason"]
                .as_str()
                .unwrap()
                .contains(reason),
            "{result}"
        );
        if scenario == "review_blocking" {
            assert_eq!(result["evidence"]["review"]["verdict"], "changes_required");
            assert_eq!(
                result["evidence"]["review"]["findings"][0]["severity"],
                "blocking"
            );
        } else {
            assert!(result["evidence"]["review"].is_null());
        }
        assert_eq!(
            result["repair_allowed"], false,
            "the first writer consumed max_attempts"
        );
        assert_ne!(
            harness.candidate_action(&id, "repair", hash).await.0,
            StatusCode::ACCEPTED
        );
    }
}

#[tokio::test]
async fn scope_guard_extension_errors_fail_the_writer_before_recording_a_candidate() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    ready(&harness, repo.path()).await;
    let before = snapshot(repo.path());
    let (id, _) = harness
        .approved(repo.path(), "extension_error", json!({}))
        .await;
    assert_eq!(harness.implement(&id).await.0, StatusCode::ACCEPTED);
    let failed = harness.settled(&id).await;
    assert_eq!(failed["state"], "failed", "{failed}");
    let events = harness.events(&id).await;
    let reason = &events
        .iter()
        .find(|event| event["type"] == "run.failed")
        .unwrap()["payload"]["reason"];
    assert!(reason.as_str().unwrap().contains("extension"), "{reason}");
    assert!(!events
        .iter()
        .any(|event| event["type"] == "candidate.recorded"));
    assert!(harness.candidate(&id).await["evidence"].is_null());
    let (_, attempts) = harness
        .request("GET", &format!("/api/v1/runs/{id}/attempts"), None)
        .await;
    assert_eq!(attempts[0]["state"], "failed");
    let (_, leases) = harness
        .request("GET", &format!("/api/v1/runs/{id}/worktrees"), None)
        .await;
    assert_eq!(leases[0]["state"], "released");
    assert!(leases[0]["candidate_commit"].is_null());
    assert_eq!(snapshot(repo.path()), before);
}

#[tokio::test]
async fn separate_workflows_can_record_reviews_when_the_model_reuses_its_result_id() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    ready(&harness, repo.path()).await;
    let mut review_ids = Vec::new();
    for _ in 0..2 {
        let (id, _) = harness
            .approved(repo.path(), "write_in_scope", json!({}))
            .await;
        assert_eq!(harness.implement(&id).await.0, StatusCode::ACCEPTED);
        harness.settled(&id).await;
        let initial = harness.candidate(&id).await;
        let hash = &initial["evidence"]["candidate"]["hash"];
        assert_eq!(
            harness.candidate_action(&id, "validate", hash).await.0,
            StatusCode::ACCEPTED
        );
        let passed = harness.candidate_settled(&id).await;
        assert_eq!(passed["evidence"]["status"], "reviewed", "{passed}");
        let review = &passed["evidence"]["review"];
        assert_eq!(review["candidate_hash"], *hash);
        assert_eq!(review["id"], review["reviewer_session"]);
        review_ids.push(review["id"].clone());
    }
    assert_ne!(review_ids[0], review_ids[1]);
}

#[tokio::test]
async fn cancelling_candidate_review_preserves_candidate_checks_and_consumed_attempts() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    ready(&harness, repo.path()).await;
    let (id, _) = harness
        .approved(repo.path(), "review_hold", json!({"max_attempts":1}))
        .await;
    assert_eq!(harness.implement(&id).await.0, StatusCode::ACCEPTED);
    harness.settled(&id).await;
    let initial = harness.candidate(&id).await;
    let hash = &initial["evidence"]["candidate"]["hash"];
    assert_eq!(
        harness.candidate_action(&id, "validate", hash).await.0,
        StatusCode::ACCEPTED
    );
    harness.wait_for_event(&id, "review.started").await;
    assert_eq!(harness.candidate(&id).await["active"], true);
    assert_eq!(
        harness
            .request("POST", &format!("/api/v1/runs/{id}/cancel"), None)
            .await
            .0,
        StatusCode::ACCEPTED
    );
    let cancelled = harness.candidate_settled(&id).await;
    assert_eq!(cancelled["evidence"]["status"], "cancelled", "{cancelled}");
    assert_eq!(
        cancelled["evidence"]["candidate"],
        initial["evidence"]["candidate"]
    );
    assert_eq!(cancelled["evidence"]["results"][0]["status"], "passed");
    assert!(cancelled["evidence"]["review"].is_null());
    assert!(cancelled["evidence"]["reason"]
        .as_str()
        .unwrap()
        .contains("cancelled"));
    assert_eq!(cancelled["repair_allowed"], false);
    assert_ne!(
        harness.candidate_action(&id, "validate", hash).await.0,
        StatusCode::ACCEPTED
    );
    let store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    assert_eq!(store.attempts(&id).unwrap().len(), 1);
    assert_eq!(store.workflow_usage(&id).unwrap().attempts, 1);
    assert!(store.workflow_usage(&id).unwrap().cost_usd_micros >= 500);
}

#[tokio::test]
async fn restart_during_review_preserves_candidate_and_reserves_unknown_provider_spend() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    ready(&harness, repo.path()).await;
    let (id, _) = harness
        .approved(repo.path(), "review_hold", json!({"max_attempts":1}))
        .await;
    assert_eq!(harness.implement(&id).await.0, StatusCode::ACCEPTED);
    harness.settled(&id).await;
    let initial = harness.candidate(&id).await;
    let hash = &initial["evidence"]["candidate"]["hash"];
    assert_eq!(
        harness.candidate_action(&id, "validate", hash).await.0,
        StatusCode::ACCEPTED
    );
    harness.wait_for_event(&id, "review.started").await;
    let mut store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    let usage_before = store.workflow_usage(&id).unwrap();
    assert_eq!(store.interrupt_active_runs().unwrap(), 1);
    harness.state.cancel_active();
    let interrupted = harness.candidate_settled(&id).await;
    assert_eq!(
        interrupted["evidence"]["status"], "interrupted",
        "{interrupted}"
    );
    assert_eq!(harness.run(&id).await["state"], "interrupted");
    assert_eq!(
        interrupted["evidence"]["candidate"],
        initial["evidence"]["candidate"]
    );
    assert!(interrupted["evidence"]["review"].is_null());
    assert_eq!(
        store.workflow_usage(&id).unwrap().attempts,
        usage_before.attempts
    );
    assert!(store.workflow_usage(&id).unwrap().cost_usd_micros >= usage_before.cost_usd_micros);
    assert_eq!(
        store.workflow_usage(&id).unwrap().cost_usd_micros,
        1_000_000
    );
    assert!(interrupted["evidence"]["reason"]
        .as_str()
        .unwrap()
        .contains("unreported provider spend"));
    let (status, response) = harness.candidate_action(&id, "validate", hash).await;
    assert_ne!(status, StatusCode::ACCEPTED, "{response}");
    assert!(
        response["error"].as_str().unwrap().contains("budget"),
        "{response}"
    );
    assert_eq!(
        harness.candidate(&id).await["evidence"]["validation_generation"],
        1
    );
    assert_eq!(store.workflow_usage(&id).unwrap().attempts, 1);
    assert_eq!(store.attempts(&id).unwrap().len(), 1);
}

#[tokio::test]
async fn restart_during_checks_requires_a_fresh_generation_without_resetting_writer_usage() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    // The generated marker coordinates an in-flight command without altering
    // tracked candidate content. A retry can then complete the real command.
    harness.confirm(0, vec![check("unit", "from pathlib import Path; import time; candidate = 'implemented by' in Path('src/main.py').read_text(); marker = Path('.check-started'); hold = candidate and not marker.exists(); marker.touch() if candidate else None; time.sleep(60) if hold else None; print('running 1 tests'); print('test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured')")]).await;
    harness.baseline().await;
    let before = snapshot(repo.path());
    let (id, _) = harness
        .approved(repo.path(), "write_in_scope", json!({"max_attempts":1}))
        .await;
    assert_eq!(harness.implement(&id).await.0, StatusCode::ACCEPTED);
    harness.settled(&id).await;
    let initial = harness.candidate(&id).await;
    let hash = &initial["evidence"]["candidate"]["hash"];
    let (_, leases) = harness
        .request("GET", &format!("/api/v1/runs/{id}/worktrees"), None)
        .await;
    let worktree = PathBuf::from(leases[0]["path"].as_str().unwrap());
    assert_eq!(
        harness.candidate_action(&id, "validate", hash).await.0,
        StatusCode::ACCEPTED
    );
    for _ in 0..200 {
        if worktree.join(".check-started").exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert!(
        worktree.join(".check-started").exists(),
        "candidate command must be running before recovery"
    );
    let mut store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    let usage_before = store.workflow_usage(&id).unwrap();
    assert_eq!(store.interrupt_active_runs().unwrap(), 1);
    harness.state.cancel_active();
    let interrupted = harness.candidate_settled(&id).await;
    assert_eq!(
        interrupted["evidence"]["status"], "interrupted",
        "{interrupted}"
    );
    assert_eq!(
        interrupted["evidence"]["candidate"],
        initial["evidence"]["candidate"]
    );
    assert!(interrupted["evidence"]["results"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(interrupted["evidence"]["review"].is_null());

    let (status, response) = harness.candidate_action(&id, "validate", hash).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{response}");
    let passed = harness.candidate_settled(&id).await;
    assert_eq!(passed["evidence"]["status"], "reviewed", "{passed}");
    assert_eq!(passed["evidence"]["validation_generation"], 2);
    assert_eq!(
        passed["evidence"]["candidate"],
        initial["evidence"]["candidate"]
    );
    assert_eq!(passed["evidence"]["results"][0]["candidate_hash"], *hash);
    assert_eq!(passed["evidence"]["results"][0]["status"], "passed");
    assert_eq!(
        store.workflow_usage(&id).unwrap().attempts,
        usage_before.attempts
    );
    assert!(
        store.workflow_usage(&id).unwrap().cost_usd_micros >= usage_before.cost_usd_micros + 500
    );
    assert_eq!(store.attempts(&id).unwrap().len(), 1);
    let generations: Vec<_> = harness
        .events(&id)
        .await
        .into_iter()
        .filter(|e| e["type"] == "candidate.validation_started")
        .map(|e| e["payload"]["generation"].clone())
        .collect();
    assert_eq!(generations, vec![json!(1), json!(2)]);
    assert_eq!(snapshot(repo.path()), before);
}

#[tokio::test]
async fn automatic_repair_runs_fresh_checks_and_review_on_the_repaired_candidate() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    harness.confirm(0, vec![check("unit", "from pathlib import Path; import sys; bad = 'seeded regression' in Path('src/main.py').read_text(); print('running 1 tests'); print('test result: FAILED. 0 passed; 1 failed' if bad else 'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured'); sys.exit(1 if bad else 0)")]).await;
    harness.baseline().await;
    let before = snapshot(repo.path());
    let (id, _) = harness
        .approved(repo.path(), "repair_in_scope", json!({"max_attempts":2}))
        .await;
    assert_eq!(harness.implement(&id).await.0, StatusCode::ACCEPTED);
    harness.settled(&id).await;
    let initial = harness.candidate(&id).await;
    let first = &initial["evidence"]["candidate"];
    let (status, response) = harness.validate_with_repairs(&id, &first["hash"]).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{response}");
    let passed = harness.candidate_settled(&id).await;
    let evidence = &passed["evidence"];
    assert_eq!(evidence["status"], "reviewed", "{passed}");
    assert_eq!(harness.run(&id).await["state"], "reviewed");
    assert_eq!(evidence["candidate"]["id"], first["id"]);
    assert_eq!(evidence["candidate"]["revision"], 2);
    assert_eq!(evidence["candidate"]["plan_hash"], first["plan_hash"]);
    assert_ne!(evidence["candidate"]["hash"], first["hash"]);
    assert_eq!(
        evidence["results"][0]["candidate_hash"],
        evidence["candidate"]["hash"]
    );
    assert_eq!(evidence["results"][0]["status"], "passed");
    assert_eq!(
        evidence["review"]["candidate_hash"],
        evidence["candidate"]["hash"]
    );
    assert_eq!(evidence["review"]["verdict"], "passed");
    let store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    let candidates = store.candidates(&id).unwrap();
    assert_eq!(candidates.len(), 2);
    assert_eq!(
        candidates[0].results[0].status,
        luuna_domain::CheckStatus::Failed
    );
    assert!(candidates[0].review.is_none());
    assert_ne!(candidates[0].results[0].id, candidates[1].results[0].id);
    assert_eq!(store.attempts(&id).unwrap().len(), 2);
    assert_eq!(store.workflow_usage(&id).unwrap().attempts, 2);
    assert!(store.workflow_usage(&id).unwrap().cost_usd_micros >= 1500);
    assert_eq!(snapshot(repo.path()), before);
}

#[tokio::test]
async fn automatic_repair_pauses_when_a_blocking_review_exhausts_the_attempt_budget() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    ready(&harness, repo.path()).await;
    let before = snapshot(repo.path());
    let (id, _) = harness
        .approved(repo.path(), "review_blocking", json!({"max_attempts":2}))
        .await;
    assert_eq!(harness.implement(&id).await.0, StatusCode::ACCEPTED);
    harness.settled(&id).await;
    let initial = harness.candidate(&id).await;
    let (status, response) = harness
        .validate_with_repairs(&id, &initial["evidence"]["candidate"]["hash"])
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{response}");
    let paused = harness.candidate_settled(&id).await;
    assert_eq!(harness.run(&id).await["state"], "paused");
    assert_eq!(paused["evidence"]["status"], "paused", "{paused}");
    assert_eq!(paused["evidence"]["candidate"]["revision"], 2);
    assert_eq!(paused["evidence"]["review"]["verdict"], "changes_required");
    assert_eq!(paused["repair_allowed"], false);
    assert!(
        paused["evidence"]["reason"]
            .as_str()
            .unwrap()
            .contains("attempt"),
        "{paused}"
    );
    let store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    assert_eq!(store.attempts(&id).unwrap().len(), 2);
    assert_eq!(store.workflow_usage(&id).unwrap().attempts, 2);
    assert!(store.workflow_usage(&id).unwrap().cost_usd_micros >= 2000);
    let candidates = store.candidates(&id).unwrap();
    assert_eq!(candidates.len(), 2);
    assert_eq!(
        candidates[0].review.as_ref().unwrap().verdict,
        luuna_domain::ReviewVerdict::ChangesRequired
    );
    assert_eq!(
        candidates[1].review.as_ref().unwrap().verdict,
        luuna_domain::ReviewVerdict::ChangesRequired
    );
    assert_eq!(snapshot(repo.path()), before);
}

#[cfg(unix)]
#[tokio::test]
async fn automatic_repair_does_not_start_a_writer_for_a_missing_check_executable() {
    use std::os::unix::fs::PermissionsExt;
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    // Host-local ignored executables can satisfy a developer baseline but are
    // absent from a fresh candidate worktree. That is an infrastructure block.
    fs::write(repo.path().join(".git/info/exclude"), "checks/\n").unwrap();
    fs::create_dir(repo.path().join("checks")).unwrap();
    let executable = repo.path().join("checks/run");
    fs::write(&executable, "#!/bin/sh\necho 'running 1 tests'\necho 'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured'\n").unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
    register(&harness, repo.path()).await;
    harness.confirm(0, vec![json!({"id":"unit","executable":"./checks/run","args":[],"required":true,"timeout_seconds":30,"capabilities":[],"cwd":"."})]).await;
    harness.baseline().await;
    let before = snapshot(repo.path());
    let (id, _) = harness
        .approved(repo.path(), "write_in_scope", json!({"max_attempts":2}))
        .await;
    assert_eq!(harness.implement(&id).await.0, StatusCode::ACCEPTED);
    harness.settled(&id).await;
    let initial = harness.candidate(&id).await;
    let (status, response) = harness
        .validate_with_repairs(&id, &initial["evidence"]["candidate"]["hash"])
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{response}");
    let blocked = harness.candidate_settled(&id).await;
    assert_eq!(harness.run(&id).await["state"], "testing_blocked");
    assert_eq!(
        blocked["evidence"]["status"], "testing_blocked",
        "{blocked}"
    );
    assert_eq!(
        blocked["evidence"]["candidate"],
        initial["evidence"]["candidate"]
    );
    assert_eq!(blocked["evidence"]["results"][0]["status"], "blocked");
    assert!(blocked["evidence"]["results"][0]["reason"]
        .as_str()
        .unwrap()
        .contains("does not exist"));
    assert!(blocked["evidence"]["review"].is_null());
    let store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    assert_eq!(store.attempts(&id).unwrap().len(), 1);
    assert_eq!(store.candidates(&id).unwrap().len(), 1);
    assert!(!harness
        .events(&id)
        .await
        .iter()
        .any(|event| event["type"] == "candidate.repair_started"));
    assert_eq!(snapshot(repo.path()), before);
}

#[tokio::test]
async fn automatic_repair_does_not_turn_check_deadlines_into_writer_assignments() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    let mut timed_check = check("unit", "from pathlib import Path; import time; time.sleep(60) if 'implemented by' in Path('src/main.py').read_text() else None; print('running 1 tests'); print('test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured')");
    timed_check["timeout_seconds"] = json!(1);
    harness.confirm(0, vec![timed_check]).await;
    harness.baseline().await;
    let (id, _) = harness
        .approved(repo.path(), "write_in_scope", json!({"max_attempts":2}))
        .await;
    assert_eq!(harness.implement(&id).await.0, StatusCode::ACCEPTED);
    harness.settled(&id).await;
    let initial = harness.candidate(&id).await;
    let (status, response) = harness
        .validate_with_repairs(&id, &initial["evidence"]["candidate"]["hash"])
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{response}");
    let failed = harness.candidate_settled(&id).await;
    assert_eq!(failed["evidence"]["status"], "failed", "{failed}");
    assert_eq!(
        failed["evidence"]["candidate"],
        initial["evidence"]["candidate"]
    );
    assert!(failed["evidence"]["results"][0]["reason"]
        .as_str()
        .unwrap()
        .contains("deadline"));
    let store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    assert_eq!(store.attempts(&id).unwrap().len(), 1);
    assert_eq!(store.candidates(&id).unwrap().len(), 1);
    assert!(!harness
        .events(&id)
        .await
        .iter()
        .any(|event| event["type"] == "candidate.repair_started"));
}

#[tokio::test]
async fn cancelling_an_automatic_repair_stops_its_writer_and_preserves_both_attempts() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    clean_repository(repo.path());
    register(&harness, repo.path()).await;
    harness.confirm(0, vec![check("unit", "from pathlib import Path; import sys; bad = 'seeded regression' in Path('src/main.py').read_text(); print('running 1 tests'); print('test result: FAILED. 0 passed; 1 failed' if bad else 'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured'); sys.exit(1 if bad else 0)")]).await;
    harness.baseline().await;
    let before = snapshot(repo.path());
    let (id, _) = harness
        .approved(repo.path(), "repair_hold", json!({"max_attempts":2}))
        .await;
    assert_eq!(harness.implement(&id).await.0, StatusCode::ACCEPTED);
    harness.settled(&id).await;
    let initial = harness.candidate(&id).await;
    let (status, response) = harness
        .validate_with_repairs(&id, &initial["evidence"]["candidate"]["hash"])
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{response}");
    for _ in 0..200 {
        if harness
            .events(&id)
            .await
            .iter()
            .filter(|event| event["type"] == "pi.agent_start")
            .count()
            == 2
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert_eq!(
        harness
            .events(&id)
            .await
            .iter()
            .filter(|event| event["type"] == "pi.agent_start")
            .count(),
        2
    );
    assert_eq!(harness.run(&id).await["state"], "implementing");
    assert_eq!(harness.candidate(&id).await["active"], true);
    assert_eq!(
        harness
            .request("POST", &format!("/api/v1/runs/{id}/cancel"), None)
            .await
            .0,
        StatusCode::ACCEPTED
    );
    let cancelled = harness.candidate_settled(&id).await;
    assert_eq!(harness.run(&id).await["state"], "cancelled");
    assert_eq!(
        cancelled["evidence"]["candidate"],
        initial["evidence"]["candidate"]
    );
    assert_eq!(cancelled["evidence"]["results"][0]["status"], "failed");
    assert!(cancelled["evidence"]["review"].is_null());
    assert_eq!(cancelled["repair_allowed"], false);
    let store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    let attempts = store.attempts(&id).unwrap();
    assert_eq!(attempts.len(), 2);
    assert_eq!(attempts[0].state, luuna_domain::AttemptState::Completed);
    assert_eq!(attempts[1].state, luuna_domain::AttemptState::Cancelled);
    assert_eq!(store.workflow_usage(&id).unwrap().attempts, 2);
    assert!(store.active_worktree_leases().unwrap().is_empty());
    assert_eq!(store.worktree_leases(&id).unwrap().len(), 2);
    assert_eq!(snapshot(repo.path()), before);
}
