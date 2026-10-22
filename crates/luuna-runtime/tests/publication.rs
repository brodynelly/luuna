//! M7 publication through the authenticated API with the synthetic Pi fixture,
//! a local bare repository standing in for the GitHub remote and a fake GitHub
//! REST server on a loopback port. No model, no network, no real GitHub.
//!
//! The registered identity is a GitHub-shaped remote
//! (`https://github.com/luuna-test/fixture.git`), so owner/repo parsing and the
//! identity check are the real ones; the developer checkout carries a
//! `url.<bare path>.pushInsteadOf` rewrite, as a developer's own transport
//! rewrite would, so Git's effective push URL is the local bare repository.
use axum::{
    body::{to_bytes, Body},
    extract::{Path as AxumPath, Query, State},
    http::{Request, StatusCode},
    routing::get,
    Json, Router,
};
use luuna_runtime::{router, AppState, PublicationSettings, RuntimeConfig};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};
use tower::ServiceExt;

const TOKEN: &str = "synthetic-test-token-with-at-least-32-bytes";
const REMOTE: &str = "https://github.com/luuna-test/fixture.git";

/// The fake GitHub REST API: pull requests by number, every request it saw,
/// and the behaviours a scenario switches on.
#[derive(Default)]
struct FakeGitHub {
    requests: Vec<(String, String)>,
    pull_requests: Vec<Value>,
    delay_create: Option<Duration>,
    fail_create_once: bool,
    check_runs: Vec<Value>,
    merged: bool,
}

type Fake = Arc<Mutex<FakeGitHub>>;

fn pull_request(number: u64, owner: &str, repo: &str, body: &Value) -> Value {
    json!({
        "number": number,
        "html_url": format!("https://github.com/{owner}/{repo}/pull/{number}"),
        "url": format!("https://api.github.com/repos/{owner}/{repo}/pulls/{number}"),
        "state": "open",
        "title": body["title"],
        "body": body["body"],
        "head": {"ref": body["head"], "sha": body["head_sha"]},
        "base": {"ref": body["base"]},
        "merged": false,
        "merged_at": null,
        "merged_by": null,
    })
}

async fn list_pulls(
    State(fake): State<Fake>,
    AxumPath((owner, repo)): AxumPath<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    let mut fake = fake.lock().unwrap();
    fake.requests.push((
        "GET".into(),
        format!("/repos/{owner}/{repo}/pulls?{query:?}"),
    ));
    let head = query.get("head").cloned().unwrap_or_default();
    let branch = head.split_once(':').map(|(_, b)| b.to_owned());
    let listed: Vec<Value> = fake
        .pull_requests
        .iter()
        .filter(|pr| branch.as_deref().is_none_or(|b| pr["head"]["ref"] == b))
        .cloned()
        .collect();
    Json(Value::Array(listed))
}

async fn create_pull(
    State(fake): State<Fake>,
    AxumPath((owner, repo)): AxumPath<(String, String)>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let (delay, response) = {
        let mut fake = fake.lock().unwrap();
        fake.requests
            .push(("POST".into(), format!("/repos/{owner}/{repo}/pulls")));
        if fake.fail_create_once {
            fake.fail_create_once = false;
            (
                None,
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"message": "synthetic outage"})),
                ),
            )
        } else {
            let number = fake.pull_requests.len() as u64 + 1;
            let pr = pull_request(number, &owner, &repo, &body);
            fake.pull_requests.push(pr.clone());
            (fake.delay_create, (StatusCode::CREATED, Json(pr)))
        }
    };
    if let Some(delay) = delay {
        tokio::time::sleep(delay).await;
    }
    response
}

async fn get_pull(
    State(fake): State<Fake>,
    AxumPath((owner, repo, number)): AxumPath<(String, String, u64)>,
) -> (StatusCode, Json<Value>) {
    let mut fake = fake.lock().unwrap();
    fake.requests.push((
        "GET".into(),
        format!("/repos/{owner}/{repo}/pulls/{number}"),
    ));
    let merged = fake.merged;
    match fake
        .pull_requests
        .iter()
        .find(|pr| pr["number"] == number)
        .cloned()
    {
        Some(mut pr) => {
            if merged {
                pr["merged"] = json!(true);
                pr["merged_at"] = json!("2026-10-21T12:00:00Z");
                pr["merged_by"] = json!({"login": "a-human"});
                pr["state"] = json!("closed");
            }
            (StatusCode::OK, Json(pr))
        }
        None => (StatusCode::NOT_FOUND, Json(json!({"message": "Not Found"}))),
    }
}

async fn patch_pull(
    State(fake): State<Fake>,
    AxumPath((owner, repo, number)): AxumPath<(String, String, u64)>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let mut fake = fake.lock().unwrap();
    fake.requests.push((
        "PATCH".into(),
        format!("/repos/{owner}/{repo}/pulls/{number}"),
    ));
    match fake
        .pull_requests
        .iter_mut()
        .find(|pr| pr["number"] == number)
    {
        Some(pr) => {
            pr["body"] = body["body"].clone();
            (StatusCode::OK, Json(pr.clone()))
        }
        None => (StatusCode::NOT_FOUND, Json(json!({"message": "Not Found"}))),
    }
}

async fn check_runs(
    State(fake): State<Fake>,
    AxumPath((owner, repo, sha)): AxumPath<(String, String, String)>,
) -> Json<Value> {
    let mut fake = fake.lock().unwrap();
    fake.requests.push((
        "GET".into(),
        format!("/repos/{owner}/{repo}/commits/{sha}/check-runs"),
    ));
    Json(json!({"total_count": fake.check_runs.len(), "check_runs": fake.check_runs}))
}

async fn combined_status(
    State(fake): State<Fake>,
    AxumPath((owner, repo, sha)): AxumPath<(String, String, String)>,
) -> Json<Value> {
    let mut fake = fake.lock().unwrap();
    fake.requests.push((
        "GET".into(),
        format!("/repos/{owner}/{repo}/commits/{sha}/status"),
    ));
    Json(json!({"state": "pending", "statuses": []}))
}

async fn fallback(State(fake): State<Fake>, request: Request<Body>) -> (StatusCode, Json<Value>) {
    fake.lock().unwrap().requests.push((
        request.method().to_string(),
        request.uri().path().to_owned(),
    ));
    (StatusCode::NOT_FOUND, Json(json!({"message": "Not Found"})))
}

async fn start_fake_github() -> (Fake, String) {
    let fake: Fake = Arc::default();
    let app = Router::new()
        .route(
            "/repos/{owner}/{repo}/pulls",
            get(list_pulls).post(create_pull),
        )
        .route(
            "/repos/{owner}/{repo}/pulls/{number}",
            get(get_pull).patch(patch_pull),
        )
        .route(
            "/repos/{owner}/{repo}/commits/{sha}/check-runs",
            get(check_runs),
        )
        .route(
            "/repos/{owner}/{repo}/commits/{sha}/status",
            get(combined_status),
        )
        .fallback(fallback)
        .with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (fake, format!("http://{address}"))
}

struct Harness {
    app: Router,
    state: AppState,
    root: PathBuf,
    fake: Fake,
}

impl Harness {
    async fn new() -> Self {
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/pi-rpc/mock_pi.py")
            .canonicalize()
            .unwrap();
        let (fake, api) = start_fake_github().await;
        let root =
            std::env::temp_dir().join(format!("luuna-publication-test-{}", uuid::Uuid::new_v4()));
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
        .unwrap()
        .with_publication(PublicationSettings {
            github_api_url: api,
            github_token: Some("synthetic-github-token".into()),
            request_timeout: Duration::from_secs(1),
            observe_timeout: Duration::from_secs(5),
            git_timeout: Duration::from_secs(60),
        });
        Self {
            app: router(state.clone()),
            state,
            root,
            fake,
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
    async fn confirm(&self, revision: u64, checks: Vec<Value>) -> Value {
        let manifest = json!({
            "schema_version": "0.1", "id": "fixture", "name": "Fixture", "revision": revision + 1,
            "repositories": [{"id": "app", "remote": REMOTE, "default_branch": "main",
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
    async fn plan(&self, ticket_id: &str) -> Value {
        let (status, opened) = self
            .request(
                "POST",
                &format!("/api/v1/tickets/{ticket_id}/plans"),
                Some(json!({
                    "task": {"repository_id": "app", "paths": ["src"], "operations": ["read", "write"]},
                    "budgets": {},
                })),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{opened}");
        opened
    }
    async fn approve(&self, plan: &Value) {
        let (status, approved) = self
            .request(
                "POST",
                &format!("/api/v1/plans/{}/approvals", plan["id"].as_str().unwrap()),
                Some(json!({"plan_revision": plan["revision"], "plan_hash": plan["hash"], "approved_by": "developer"})),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{approved}");
    }
    async fn candidate(&self, run_id: &str) -> Value {
        let (status, body) = self
            .request("GET", &format!("/api/v1/runs/{run_id}/candidate"), None)
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        body
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
    /// Register, confirm, baseline, ticket, plan, approve, implement: a workflow
    /// run whose candidate is recorded and still pending validation.
    async fn implemented(&self, repo: &Path) -> (String, Value) {
        self.implemented_with(repo, "write_in_scope").await
    }
    async fn implemented_with(&self, repo: &Path, scenario: &str) -> (String, Value) {
        clean_repository(repo);
        let (status, view) = self
            .request(
                "POST",
                "/api/v1/projects",
                Some(json!({"id":"fixture","name":"Fixture","repositories":[{"id":"app","path":repo.to_string_lossy()}]})),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{view}");
        self.confirm(0, vec![passing_check()]).await;
        self.baseline().await;
        let ticket = self.ticket(scenario).await;
        let opened = self.plan(ticket["id"].as_str().unwrap()).await;
        self.approve(&opened["plan"]).await;
        let run_id = opened["run"]["id"].as_str().unwrap().to_owned();
        let (status, run) = self
            .request(
                "POST",
                &format!("/api/v1/runs/{run_id}/implement"),
                Some(json!({"provider": "test", "model": "synthetic"})),
            )
            .await;
        assert_eq!(status, StatusCode::ACCEPTED, "{run}");
        assert_eq!(self.settled(&run_id).await["state"], "validating");
        (run_id, ticket)
    }
    /// A reviewed candidate with a passed review: the publication precondition.
    async fn reviewed(&self, repo: &Path) -> (String, Value, Value) {
        self.reviewed_with(repo, "write_in_scope").await
    }
    async fn reviewed_with(&self, repo: &Path, scenario: &str) -> (String, Value, Value) {
        let (run_id, ticket) = self.implemented_with(repo, scenario).await;
        let pending = self.candidate(&run_id).await;
        let hash = pending["evidence"]["candidate"]["hash"].clone();
        let (status, response) = self
            .request(
                "POST",
                &format!("/api/v1/runs/{run_id}/validate"),
                Some(json!({"candidate_hash":hash,"provider":"test","model":"synthetic"})),
            )
            .await;
        assert_eq!(status, StatusCode::ACCEPTED, "{response}");
        let reviewed = self.candidate_settled(&run_id).await;
        assert_eq!(reviewed["evidence"]["status"], "reviewed", "{reviewed}");
        assert_eq!(reviewed["evidence"]["review"]["verdict"], "passed");
        (run_id, ticket, reviewed["evidence"]["candidate"].clone())
    }
    async fn publish(&self, run_id: &str, hash: &Value, key: &str) -> (StatusCode, Value) {
        self.request(
            "POST",
            &format!("/api/v1/runs/{run_id}/publish"),
            Some(json!({"expected_hash": hash, "idempotency_key": key})),
        )
        .await
    }
    async fn publication(&self, run_id: &str) -> (StatusCode, Value) {
        self.request("GET", &format!("/api/v1/runs/{run_id}/publication"), None)
            .await
    }
    async fn publication_settled(&self, run_id: &str) -> Value {
        for _ in 0..1200 {
            let (status, record) = self.publication(run_id).await;
            assert_eq!(status, StatusCode::OK, "{record}");
            if record["active"] == false
                && !matches!(
                    record["publication_state"].as_str(),
                    Some("pending" | "pushing")
                )
            {
                return record;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!(
            "publication did not settle: {}",
            self.publication(run_id).await.1
        );
    }
    async fn worktree(&self, run_id: &str) -> PathBuf {
        let (_, leases) = self
            .request("GET", &format!("/api/v1/runs/{run_id}/worktrees"), None)
            .await;
        PathBuf::from(
            leases.as_array().unwrap().last().unwrap()["path"]
                .as_str()
                .unwrap(),
        )
    }
    async fn reconcile(&self, run_id: &str) -> (StatusCode, Value) {
        self.request(
            "POST",
            &format!("/api/v1/runs/{run_id}/publication/reconcile"),
            None,
        )
        .await
    }
    fn requests(&self, method: &str, path_part: &str) -> usize {
        self.fake
            .lock()
            .unwrap()
            .requests
            .iter()
            .filter(|(m, p)| m == method && p.contains(path_part))
            .count()
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        self.state.cancel_active();
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// A developer checkout whose sibling bare "origin" is removed with it.
struct Repo(tempfile::TempDir);
impl Repo {
    fn new() -> Self {
        Self(tempfile::tempdir().unwrap())
    }
    fn path(&self) -> &Path {
        self.0.path()
    }
}
impl Drop for Repo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(bare_path(self.0.path()));
    }
}

fn python() -> String {
    if cfg!(windows) { "python" } else { "python3" }.into()
}
fn passing_check() -> Value {
    json!({"id": "unit", "executable": python(), "args": ["-c", "print('running 1 tests'); print('test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured')"], "required": true,
        "timeout_seconds": 30, "capabilities": ["python"], "cwd": "."})
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
fn git_status(dir: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .unwrap()
        .status
        .success()
}
/// The developer checkout with a GitHub-shaped origin, plus the local bare
/// repository that Git's push URL rewrite makes the effective remote.
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
    git(dir, &["remote", "add", "origin", REMOTE]);
    let bare = bare_path(dir);
    git(dir, &["init", "-q", "--bare", "-b", "main", &bare]);
    git(dir, &["push", "-q", &bare, "main:refs/heads/main"]);
    git(
        dir,
        &["config", &format!("url.{bare}.pushInsteadOf"), REMOTE],
    );
}
fn bare_path(dir: &Path) -> String {
    dir.parent()
        .unwrap()
        .join(format!(
            "{}-origin.git",
            dir.file_name().unwrap().to_string_lossy()
        ))
        .to_string_lossy()
        .replace('\\', "/")
}
fn remote_branch(dir: &Path, branch: &str) -> Option<String> {
    let bare = bare_path(dir);
    let output = Command::new("git")
        .args(["-C", &bare, "rev-parse", "--verify", "--quiet"])
        .arg(format!("refs/heads/{branch}"))
        .output()
        .unwrap();
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}
fn event_types(events: &[Value]) -> Vec<String> {
    events
        .iter()
        .map(|e| e["type"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn publish_is_refused_before_a_passed_review_and_after_a_stale_hash() {
    let harness = Harness::new().await;
    let repo = Repo::new();
    let (run_id, _ticket) = harness.implemented(repo.path()).await;
    let (status, body) = harness.publication(&run_id).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    assert!(body["error"].as_str().unwrap().contains("POST /publish"));
    let pending = harness.candidate(&run_id).await;
    let hash = pending["evidence"]["candidate"]["hash"].clone();
    let (status, refused) = harness.publish(&run_id, &hash, "key-1").await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    let reason = refused["error"].as_str().unwrap();
    assert!(reason.contains("candidate is pending"), "{reason}");
    assert!(reason.contains("validate the candidate"), "{reason}");
    assert_eq!(harness.requests("POST", "/pulls"), 0);
    assert!(remote_branch(repo.path(), "luuna").is_none());

    let (status, response) = harness
        .request(
            "POST",
            &format!("/api/v1/runs/{run_id}/validate"),
            Some(json!({"candidate_hash":hash,"provider":"test","model":"synthetic"})),
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{response}");
    let reviewed = harness.candidate_settled(&run_id).await;
    assert_eq!(reviewed["evidence"]["status"], "reviewed", "{reviewed}");
    let stale = json!(format!("sha256:{}", "0".repeat(64)));
    let (status, refused) = harness.publish(&run_id, &stale, "key-2").await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert!(refused["error"]
        .as_str()
        .unwrap()
        .contains("candidate hash changed"));
    let (status, refused) = harness
        .request(
            "POST",
            &format!("/api/v1/runs/{run_id}/publish"),
            Some(json!({"expected_hash": hash, "idempotency_key": ""})),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(harness.requests("POST", "/pulls"), 0);
    let events = event_types(&harness.events(&run_id).await);
    assert!(
        !events.iter().any(|e| e.starts_with("publication.")),
        "{events:?}"
    );
}

#[tokio::test]
async fn publication_opens_exactly_one_pull_request_at_the_exact_candidate_commit() {
    let harness = Harness::new().await;
    let repo = Repo::new();
    let (run_id, ticket, candidate) = harness.reviewed(repo.path()).await;
    let hash = candidate["hash"].clone();
    let commit = candidate["repository_commits"]["app"].as_str().unwrap();
    let tracking_before = git(repo.path(), &["for-each-ref", "refs/remotes"]);

    let (status, accepted) = harness.publish(&run_id, &hash, "publish-1").await;
    assert_eq!(status, StatusCode::ACCEPTED, "{accepted}");
    assert_eq!(accepted["publication_state"], "pending");
    assert_eq!(accepted["active"], true);
    let record = harness.publication_settled(&run_id).await;
    assert_eq!(record["publication_state"], "pr_open", "{record}");
    let branch = record["repositories"]["app"]["branch"].as_str().unwrap();
    assert_eq!(
        branch,
        format!(
            "luuna/{}/{}",
            ticket["id"].as_str().unwrap(),
            &hash.as_str().unwrap()[7..19]
        )
    );
    assert_eq!(remote_branch(repo.path(), branch).as_deref(), Some(commit));
    assert_eq!(record["repositories"]["app"]["push"], "done");
    assert_eq!(record["repositories"]["app"]["pull_request"]["number"], 1);
    assert_eq!(
        record["repositories"]["app"]["pull_request"]["url"],
        "https://github.com/luuna-test/fixture/pull/1"
    );
    assert_eq!(record["contract"]["publication_state"], "pr_open");
    assert_eq!(record["contract"]["per_repository_branch"]["app"], branch);
    assert_eq!(record["contract"]["candidate_hash"], hash);
    assert_eq!(record["contract"]["ticket_id"], ticket["id"]);
    assert_eq!(harness.requests("POST", "/pulls"), 1);
    {
        let fake = harness.fake.lock().unwrap();
        let pr = &fake.pull_requests[0];
        assert_eq!(pr["head"]["ref"], branch);
        assert_eq!(pr["base"]["ref"], "main");
        let body = pr["body"].as_str().unwrap();
        assert!(body.contains(hash.as_str().unwrap()), "{body}");
        assert!(body.contains(ticket["id"].as_str().unwrap()), "{body}");
        assert!(body.contains("1 of 1 passed"), "{body}");
        assert!(body.contains("passed by `review-"), "{body}");
        assert!(!body.contains("synthetic-github-token"));
    }
    // Pushing by URL writes no remote-tracking reference into the developer checkout.
    assert_eq!(
        git(repo.path(), &["for-each-ref", "refs/remotes"]),
        tracking_before
    );
    let events = event_types(&harness.events(&run_id).await);
    for expected in [
        "publication.requested",
        "publication.pushed",
        "publication.pr_opened",
    ] {
        assert!(events.contains(&expected.to_owned()), "{events:?}");
    }
    assert!(
        !events.contains(&"publication.failed".to_owned()),
        "{events:?}"
    );

    // The same idempotency key replays the record without side effects.
    let (status, replay) = harness.publish(&run_id, &hash, "publish-1").await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay["publication_state"], "pr_open");
    assert_eq!(replay["idempotency_key"], "publish-1");
    assert_eq!(harness.requests("POST", "/pulls"), 1);
    assert_eq!(
        event_types(&harness.events(&run_id).await)
            .iter()
            .filter(|e| *e == "publication.pushed")
            .count(),
        1
    );
    // Another key for the same candidate is refused, not republished.
    let (status, refused) = harness.publish(&run_id, &hash, "publish-2").await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(harness.requests("POST", "/pulls"), 1);
    // Reconcile has nothing to do.
    let (status, same) = harness
        .request(
            "POST",
            &format!("/api/v1/runs/{run_id}/publication/reconcile"),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{same}");
    assert_eq!(harness.requests("POST", "/pulls"), 1);
    assert_eq!(remote_branch(repo.path(), branch).as_deref(), Some(commit));
}

#[tokio::test]
async fn a_timed_out_pull_request_creation_is_reconciled_without_a_duplicate() {
    let harness = Harness::new().await;
    let repo = Repo::new();
    let (run_id, _ticket, candidate) = harness.reviewed(repo.path()).await;
    let hash = candidate["hash"].clone();
    harness.fake.lock().unwrap().delay_create = Some(Duration::from_secs(3));
    let (status, accepted) = harness.publish(&run_id, &hash, "publish-timeout").await;
    assert_eq!(status, StatusCode::ACCEPTED, "{accepted}");
    let failed = harness.publication_settled(&run_id).await;
    assert_eq!(failed["publication_state"], "failed", "{failed}");
    assert_eq!(failed["repositories"]["app"]["push"], "done");
    assert_eq!(failed["repositories"]["app"]["pull_request_step"], "failed");
    let reason = failed["repositories"]["app"]["reason"].as_str().unwrap();
    assert!(reason.contains("deadline"), "{reason}");
    assert!(reason.contains("reconcile"), "{reason}");
    // The remote recorded the pull request before it answered.
    assert_eq!(harness.requests("POST", "/pulls"), 1);
    assert_eq!(harness.fake.lock().unwrap().pull_requests.len(), 1);
    let events = event_types(&harness.events(&run_id).await);
    assert!(
        events.contains(&"publication.failed".to_owned()),
        "{events:?}"
    );

    harness.fake.lock().unwrap().delay_create = None;
    let (status, accepted) = harness
        .request(
            "POST",
            &format!("/api/v1/runs/{run_id}/publication/reconcile"),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{accepted}");
    let reconciled = harness.publication_settled(&run_id).await;
    assert_eq!(reconciled["publication_state"], "pr_open", "{reconciled}");
    assert_eq!(
        reconciled["repositories"]["app"]["pull_request"]["number"],
        1
    );
    assert_eq!(
        harness.requests("POST", "/pulls"),
        1,
        "no duplicate creation"
    );
    assert_eq!(harness.fake.lock().unwrap().pull_requests.len(), 1);
    let events = harness.events(&run_id).await;
    let opened: Vec<&Value> = events
        .iter()
        .filter(|e| e["type"] == "publication.pr_opened")
        .collect();
    assert_eq!(opened.len(), 1, "{events:?}");
    assert_eq!(opened[0]["payload"]["reused_existing"], true);
    assert!(events.iter().any(|e| e["type"] == "publication.reconciled"));
    assert_eq!(
        events
            .iter()
            .filter(|e| e["type"] == "publication.pushed")
            .count(),
        1,
        "the push was not repeated"
    );
}

#[tokio::test]
async fn a_failed_pull_request_creation_is_retried_by_reconcile_without_a_second_push() {
    let harness = Harness::new().await;
    let repo = Repo::new();
    let (run_id, _ticket, candidate) = harness.reviewed(repo.path()).await;
    let hash = candidate["hash"].clone();
    let commit = candidate["repository_commits"]["app"].as_str().unwrap();
    harness.fake.lock().unwrap().fail_create_once = true;
    let (status, accepted) = harness.publish(&run_id, &hash, "publish-fail").await;
    assert_eq!(status, StatusCode::ACCEPTED, "{accepted}");
    let failed = harness.publication_settled(&run_id).await;
    assert_eq!(failed["publication_state"], "failed", "{failed}");
    assert_eq!(failed["repositories"]["app"]["push"], "done");
    assert_eq!(failed["repositories"]["app"]["pull_request_step"], "failed");
    assert!(failed["repositories"]["app"]["reason"]
        .as_str()
        .unwrap()
        .contains("500"));
    assert_eq!(failed["contract"]["publication_state"], "failed");
    assert_eq!(failed["contract"]["pull_request_urls"], json!({}));
    let branch = failed["repositories"]["app"]["branch"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(remote_branch(repo.path(), &branch).as_deref(), Some(commit));

    let (status, accepted) = harness
        .request(
            "POST",
            &format!("/api/v1/runs/{run_id}/publication/reconcile"),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{accepted}");
    let reconciled = harness.publication_settled(&run_id).await;
    assert_eq!(reconciled["publication_state"], "pr_open", "{reconciled}");
    assert_eq!(harness.requests("POST", "/pulls"), 2);
    assert_eq!(harness.fake.lock().unwrap().pull_requests.len(), 1);
    let events = harness.events(&run_id).await;
    assert_eq!(
        events
            .iter()
            .filter(|e| e["type"] == "publication.pushed")
            .count(),
        1,
        "only the pull request step was retried: {:?}",
        event_types(&events)
    );
    assert_eq!(
        events
            .iter()
            .filter(|e| e["type"] == "publication.pr_opened")
            .count(),
        1
    );
    assert_eq!(remote_branch(repo.path(), &branch).as_deref(), Some(commit));
}

#[tokio::test]
async fn ci_failure_is_distinct_from_integration_and_luuna_never_merges() {
    let harness = Harness::new().await;
    let repo = Repo::new();
    let (run_id, _ticket, candidate) = harness.reviewed(repo.path()).await;
    let hash = candidate["hash"].clone();
    let (status, _) = harness.publish(&run_id, &hash, "publish-ci").await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let open = harness.publication_settled(&run_id).await;
    assert_eq!(open["publication_state"], "pr_open", "{open}");
    assert_eq!(open["repositories"]["app"]["ci"]["state"], "unknown");
    assert!(open["repositories"]["app"]["ci"]["reason"]
        .as_str()
        .unwrap()
        .contains("no checks"));

    harness.fake.lock().unwrap().check_runs = vec![
        json!({"name": "unit", "status": "completed", "conclusion": "failure"}),
        json!({"name": "lint", "status": "completed", "conclusion": "success"}),
    ];
    let (status, observed) = harness.publication(&run_id).await;
    assert_eq!(status, StatusCode::OK, "{observed}");
    let ci = &observed["repositories"]["app"]["ci"];
    assert_eq!(ci["state"], "failure", "{observed}");
    assert_eq!(ci["checks"][0]["name"], "unit");
    assert_eq!(ci["checks"][0]["conclusion"], "failure");
    assert_eq!(ci["checks"][1]["conclusion"], "success");
    assert!(ci["observed_at"].is_string());
    assert_eq!(observed["publication_state"], "pr_open");
    assert_eq!(observed["repositories"]["app"]["merge"]["merged"], false);
    // Observed CI never changes candidate evidence.
    let candidate_after = harness.candidate(&run_id).await;
    assert_eq!(candidate_after["evidence"]["status"], "reviewed");
    assert_eq!(candidate_after["evidence"]["candidate"], candidate);
    assert_eq!(harness.run(&run_id).await["state"], "reviewed");

    harness.fake.lock().unwrap().check_runs =
        vec![json!({"name": "unit", "status": "in_progress", "conclusion": null})];
    let (_, pending) = harness.publication(&run_id).await;
    assert_eq!(pending["repositories"]["app"]["ci"]["state"], "pending");

    // A person merges on GitHub; Luuna observes it and never calls merge.
    harness.fake.lock().unwrap().merged = true;
    let (status, integrated) = harness.publication(&run_id).await;
    assert_eq!(status, StatusCode::OK, "{integrated}");
    assert_eq!(
        integrated["publication_state"], "integrated",
        "{integrated}"
    );
    assert_eq!(integrated["contract"]["publication_state"], "integrated");
    let merge = &integrated["repositories"]["app"]["merge"];
    assert_eq!(merge["merged"], true);
    assert_eq!(merge["merged_by"], "a-human");
    assert_eq!(merge["merged_at"], "2026-10-21T12:00:00Z");
    let events = event_types(&harness.events(&run_id).await);
    assert_eq!(
        events
            .iter()
            .filter(|e| *e == "publication.integrated")
            .count(),
        1,
        "{events:?}"
    );
    let (_, again) = harness.publication(&run_id).await;
    assert_eq!(again["publication_state"], "integrated");
    assert_eq!(
        event_types(&harness.events(&run_id).await)
            .iter()
            .filter(|e| *e == "publication.integrated")
            .count(),
        1,
        "integration is recorded once"
    );
    let requests = harness.fake.lock().unwrap().requests.clone();
    assert!(
        requests
            .iter()
            .all(|(method, path)| !path.contains("merge") && method != "PUT" && method != "DELETE"),
        "Luuna sent a merge-like request: {requests:?}"
    );
    assert!(requests.iter().any(|(m, _)| m == "POST"), "{requests:?}");
    assert!(requests
        .iter()
        .all(|(m, p)| m != "POST" || p.ends_with("/pulls")));
}

#[tokio::test]
async fn there_is_no_merge_route_or_operation() {
    let source = include_str!("../src/lib.rs");
    let router = source
        .split("pub fn router(")
        .nth(1)
        .expect("router block")
        .split("fn health(")
        .next()
        .unwrap();
    // Every route path is a string literal in the router block; none names a
    // merge (axum's own `Router::merge` composes routers and is not a route).
    let paths: Vec<&str> = router
        .split('"')
        .skip(1)
        .step_by(2)
        .filter(|literal| literal.starts_with('/'))
        .collect();
    assert!(paths.len() > 20, "router paths: {paths:?}");
    assert!(
        paths
            .iter()
            .all(|path| !path.to_ascii_lowercase().contains("merge")),
        "the router must not expose a merge route: {paths:?}"
    );
    assert!(!router.contains("merge\""));
    let publication = include_str!("../src/publication.rs").to_ascii_lowercase();
    for forbidden in ["/merge\"", "pulls/{}/merge", ".put(", "method::put"] {
        assert!(
            !publication.contains(forbidden),
            "publication must not perform a merge ({forbidden})"
        );
    }
    let harness = Harness::new().await;
    for path in [
        "/api/v1/runs/run-1/publication/merge",
        "/api/v1/runs/run-1/merge",
        "/api/v1/publications/run-1/merge",
    ] {
        let (status, body) = harness.request("POST", path, Some(json!({}))).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}: {body}");
    }
    assert!(git_status(
        Path::new(env!("CARGO_MANIFEST_DIR")),
        &["--version"]
    ));
}

/// The `publication.refused` events of a run, by kind.
fn refusals(events: &[Value]) -> Vec<String> {
    events
        .iter()
        .filter(|e| e["type"] == "publication.refused")
        .map(|e| e["payload"]["kind"].as_str().unwrap_or_default().to_owned())
        .collect()
}

#[tokio::test]
async fn a_newer_plan_revision_supersedes_the_reviewed_candidates_authorization() {
    let harness = Harness::new().await;
    let repo = Repo::new();
    let (run_id, ticket, candidate) = harness.reviewed(repo.path()).await;
    let hash = candidate["hash"].clone();
    // The developer plans again: revision 2 of the same plan opens its own
    // workflow and supersedes the approval revision 1's candidate was made under.
    let second = harness.plan(ticket["id"].as_str().unwrap()).await;
    assert_eq!(second["plan"]["revision"], 2, "{second}");

    let (status, refused) = harness.publish(&run_id, &hash, "publish-superseded").await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    let reason = refused["error"].as_str().unwrap();
    assert!(
        reason.contains("newer plan revision supersedes"),
        "{reason}"
    );
    assert!(reason.contains("re-plan"), "{reason}");
    assert_eq!(harness.requests("POST", "/pulls"), 0);
    assert_eq!(harness.requests("GET", "/pulls"), 0);
    assert!(remote_branch(repo.path(), "luuna").is_none());
    let (status, body) = harness.publication(&run_id).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    let events = event_types(&harness.events(&run_id).await);
    assert!(
        !events
            .iter()
            .any(|e| e == "publication.requested" || e == "publication.pushed"),
        "{events:?}"
    );
    // The candidate evidence itself is untouched: it is valid for revision 1,
    // which simply is no longer the authorized revision.
    let view = harness.candidate(&run_id).await;
    assert_eq!(view["evidence"]["status"], "reviewed");
    assert_eq!(view["evidence"]["candidate"]["hash"], hash);
    assert_eq!(harness.run(&run_id).await["state"], "reviewed");
}

#[tokio::test]
async fn reconciliation_is_refused_once_a_newer_plan_revision_exists() {
    let harness = Harness::new().await;
    let repo = Repo::new();
    let (run_id, ticket, candidate) = harness.reviewed(repo.path()).await;
    let hash = candidate["hash"].clone();
    let commit = candidate["repository_commits"]["app"].as_str().unwrap();
    harness.fake.lock().unwrap().fail_create_once = true;
    let (status, _) = harness.publish(&run_id, &hash, "publish-then-replan").await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let failed = harness.publication_settled(&run_id).await;
    assert_eq!(failed["publication_state"], "failed", "{failed}");
    assert_eq!(failed["repositories"]["app"]["push"], "done");
    let branch = failed["repositories"]["app"]["branch"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(remote_branch(repo.path(), &branch).as_deref(), Some(commit));

    let second = harness.plan(ticket["id"].as_str().unwrap()).await;
    assert_eq!(second["plan"]["revision"], 2, "{second}");
    let (status, refused) = harness.reconcile(&run_id).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert!(refused["error"]
        .as_str()
        .unwrap()
        .contains("newer plan revision supersedes"));
    // The pull request was never created: the ledger shows one failed
    // attempt and reconciliation did not retry it under superseded authority.
    assert_eq!(harness.requests("POST", "/pulls"), 1);
    assert_eq!(harness.fake.lock().unwrap().pull_requests.len(), 0);
    let (status, record) = harness.publication(&run_id).await;
    assert_eq!(status, StatusCode::OK, "{record}");
    assert_eq!(record["publication_state"], "failed");
    assert_eq!(record["repositories"]["app"]["pull_request_step"], "failed");
    // The branch that was pushed before the re-plan is left as it was.
    assert_eq!(remote_branch(repo.path(), &branch).as_deref(), Some(commit));
}

#[tokio::test]
async fn manual_worktree_changes_after_the_review_invalidate_the_candidate_instead_of_publishing() {
    let harness = Harness::new().await;
    let repo = Repo::new();
    let (run_id, _ticket, candidate) = harness.reviewed(repo.path()).await;
    let hash = candidate["hash"].clone();
    let worktree = harness.worktree(&run_id).await;
    assert!(
        worktree.join("src/main.py").is_file(),
        "{}",
        worktree.display()
    );
    fs::write(
        worktree.join("src/main.py"),
        "print('edited by hand after the review')\n",
    )
    .unwrap();

    let (status, refused) = harness.publish(&run_id, &hash, "publish-drift").await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    let reason = refused["error"].as_str().unwrap();
    assert!(reason.starts_with("candidate content drift:"), "{reason}");
    assert!(reason.contains("src/main.py"), "{reason}");
    assert!(reason.contains("nothing was pushed"), "{reason}");
    assert!(reason.contains("POST /repair"), "{reason}");
    assert_eq!(harness.requests("POST", "/pulls"), 0);
    assert_eq!(harness.requests("GET", "/pulls"), 0);
    assert!(remote_branch(repo.path(), "luuna").is_none());
    let (status, body) = harness.publication(&run_id).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");

    // The reviewed evidence is invalidated: the candidate is failed with the
    // drift marked, the run left `reviewed`, and the review is history only.
    let view = harness.candidate(&run_id).await;
    assert_eq!(view["evidence"]["status"], "failed", "{view}");
    assert_eq!(view["evidence"]["content_drift"], true);
    assert_eq!(view["evidence"]["candidate"]["hash"], hash);
    assert!(view["evidence"]["reason"]
        .as_str()
        .unwrap()
        .starts_with("candidate content drift:"));
    assert_eq!(view["revalidate_allowed"], false, "{view}");
    assert_eq!(harness.run(&run_id).await["state"], "failed");
    let events = harness.events(&run_id).await;
    assert!(events.iter().any(|e| e["type"] == "candidate.invalidated"
        && e["payload"]["content_drift"] == true
        && e["payload"]["candidate_hash"] == hash));
    assert_eq!(refusals(&events), vec!["candidate_drift"]);
    assert!(!event_types(&events).contains(&"publication.requested".to_owned()));
    // The edit is preserved for inspection; the developer checkout is untouched.
    assert_eq!(
        fs::read_to_string(worktree.join("src/main.py")).unwrap(),
        "print('edited by hand after the review')\n"
    );
    assert_eq!(
        fs::read_to_string(repo.path().join("src/main.py")).unwrap(),
        "print('fixture')\n"
    );
    // A second attempt meets the invalidated candidate, not the drift check again.
    let (status, again) = harness.publish(&run_id, &hash, "publish-drift-2").await;
    assert_eq!(status, StatusCode::CONFLICT, "{again}");
    assert!(again["error"]
        .as_str()
        .unwrap()
        .contains("candidate is failed"));
    assert_eq!(refusals(&harness.events(&run_id).await).len(), 1);
}

#[tokio::test]
async fn reconciliation_revalidates_the_worktree_before_retrying_a_step() {
    let harness = Harness::new().await;
    let repo = Repo::new();
    let (run_id, _ticket, candidate) = harness.reviewed(repo.path()).await;
    let hash = candidate["hash"].clone();
    harness.fake.lock().unwrap().fail_create_once = true;
    let (status, _) = harness.publish(&run_id, &hash, "publish-then-drift").await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let failed = harness.publication_settled(&run_id).await;
    assert_eq!(failed["publication_state"], "failed", "{failed}");
    let worktree = harness.worktree(&run_id).await;
    fs::write(worktree.join("src/main.py"), "print('drifted')\n").unwrap();

    let (status, refused) = harness.reconcile(&run_id).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert!(refused["error"]
        .as_str()
        .unwrap()
        .starts_with("candidate content drift:"));
    assert_eq!(harness.requests("POST", "/pulls"), 1, "no retry");
    assert_eq!(harness.fake.lock().unwrap().pull_requests.len(), 0);
    let view = harness.candidate(&run_id).await;
    assert_eq!(view["evidence"]["status"], "failed", "{view}");
    assert_eq!(view["evidence"]["content_drift"], true);
    assert_eq!(harness.run(&run_id).await["state"], "failed");
    let (status, record) = harness.publication(&run_id).await;
    assert_eq!(status, StatusCode::OK, "{record}");
    assert_eq!(record["publication_state"], "failed");
    assert_eq!(
        refusals(&harness.events(&run_id).await),
        vec!["candidate_drift"]
    );
}

#[tokio::test]
async fn the_pre_push_policy_refuses_credentials_without_naming_their_values() {
    let harness = Harness::new().await;
    let repo = Repo::new();
    let (run_id, _ticket, candidate) = harness.reviewed_with(repo.path(), "write_secret").await;
    let hash = candidate["hash"].clone();
    let (status, refused) = harness.publish(&run_id, &hash, "publish-secret").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    let reason = refused["error"].as_str().unwrap();
    assert!(reason.starts_with("pre-push policy refused"), "{reason}");
    assert!(
        reason.contains("src/config.py [credential-token]"),
        "{reason}"
    );
    assert!(reason.contains("GitHub personal access token"), "{reason}");
    assert!(reason.contains("src/.env [credential-path]"), "{reason}");
    assert!(reason.contains("src/.env [secret-assignment]"), "{reason}");
    assert!(reason.contains("nothing was pushed"), "{reason}");
    assert!(
        !reason.contains("ghp_a1b2"),
        "the value must never be reported: {reason}"
    );
    assert!(
        !reason.contains("Xk9f2mQ8"),
        "the value must never be reported: {reason}"
    );
    assert_eq!(harness.requests("POST", "/pulls"), 0);
    assert_eq!(harness.requests("GET", "/pulls"), 0);
    assert!(remote_branch(repo.path(), "luuna").is_none());
    let (status, body) = harness.publication(&run_id).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    let events = harness.events(&run_id).await;
    assert_eq!(refusals(&events), vec!["policy"]);
    let refusal = events
        .iter()
        .find(|e| e["type"] == "publication.refused")
        .unwrap();
    let findings = refusal["payload"]["findings"].as_array().unwrap();
    assert!(findings.len() >= 3, "{findings:?}");
    assert!(findings
        .iter()
        .any(|f| f["path"] == "src/config.py" && f["rule"] == "credential-token"));
    assert!(findings
        .iter()
        .any(|f| f["path"] == "src/.env" && f["rule"] == "credential-path"));
    let serialized = refusal.to_string();
    assert!(!serialized.contains("ghp_a1b2") && !serialized.contains("Xk9f2mQ8"));
    // The reviewed evidence is kept: the policy refusal is not drift.
    let view = harness.candidate(&run_id).await;
    assert_eq!(view["evidence"]["status"], "reviewed", "{view}");
    assert_eq!(harness.run(&run_id).await["state"], "reviewed");
}
