//! M4 through the authenticated API with the synthetic Pi fixture: a
//! three-repository graph (api -> shared -> consumer) whose consumer check
//! imports the shared package through `LUUNA_DEPENDENCY_SHARED_PATH`, driven
//! as a dependency-ordered task graph with real Python unittest checks. No
//! model is involved and the developer checkouts are never written.
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
const REPOSITORIES: [&str; 3] = ["api", "shared", "consumer"];

struct Harness {
    app: Router,
    state: AppState,
    root: PathBuf,
}
impl Harness {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("luuna-m4-test-{}", uuid::Uuid::new_v4()));
        Self::open(root)
    }
    fn open(root: PathBuf) -> Self {
        let state = AppState::open(RuntimeConfig {
            data_dir: root.clone(),
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
    async fn settled(&self, id: &str) -> Value {
        for _ in 0..2400 {
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
    async fn wait_for_events(&self, id: &str, kind: &str, count: usize) {
        for _ in 0..2400 {
            if self
                .events(id)
                .await
                .iter()
                .filter(|e| e["type"] == kind)
                .count()
                >= count
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!("{count} x {kind} never appeared for {id}");
    }
    async fn tasks(&self, id: &str) -> Vec<Value> {
        let (status, tasks) = self
            .request("GET", &format!("/api/v1/runs/{id}/tasks"), None)
            .await;
        assert_eq!(status, StatusCode::OK, "{tasks}");
        tasks.as_array().cloned().unwrap_or_default()
    }
    async fn attempts(&self, id: &str) -> Vec<Value> {
        self.request("GET", &format!("/api/v1/runs/{id}/attempts"), None)
            .await
            .1
            .as_array()
            .cloned()
            .unwrap_or_default()
    }
    async fn confirm(&self, revision: u64, relationships: Vec<Value>) -> (StatusCode, Value) {
        let repositories: Vec<Value> = REPOSITORIES
            .iter()
            .map(|id| {
                json!({"id": id, "remote": format!("https://example.invalid/{id}.git"), "default_branch": "main",
                    "profiles": ["python"], "execution": "native", "checks": [unit_check()]})
            })
            .collect();
        let manifest = json!({
            "schema_version": "0.1", "id": "fixture", "name": "Fixture", "revision": revision + 1,
            "repositories": repositories,
            "relationships": relationships,
            "policy": {"approval": "plan", "testing_prerequisite": true, "publish": "automatic_pr", "merge": "human",
                "max_explorers": 1, "max_implementers": 3, "max_task_repairs": 2},
        });
        self.request(
            "PUT",
            "/api/v1/projects/fixture/manifest",
            Some(json!({"expected_revision": revision, "manifest": manifest})),
        )
        .await
    }
    async fn baseline(&self, repository: &str) {
        let (status, run) = self
            .request(
                "POST",
                "/api/v1/projects/fixture/baselines",
                Some(json!({"repository_id": repository})),
            )
            .await;
        assert_eq!(status, StatusCode::ACCEPTED, "{run}");
        let run = self.settled(run["id"].as_str().unwrap()).await;
        assert_eq!(run["state"], "completed", "{run}");
    }
    async fn ticket(&self) -> Value {
        let (status, ticket) = self
            .request(
                "POST",
                "/api/v1/projects/fixture/tickets",
                Some(json!({
                    "idempotency_key": format!("key-{}", uuid::Uuid::new_v4()),
                    "title": "Change the API, the shared package and the consumer",
                    "intent": "Make the three repositories agree on the greeting.",
                    "acceptance_criteria": ["every repository's tests pass against the others' candidates"],
                    "repository_ids": REPOSITORIES,
                })),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{ticket}");
        ticket
    }
    /// `(id, scenario, depends_on)` tasks on the repository named by the ID.
    async fn plan(
        &self,
        ticket_id: &str,
        tasks: &[(&str, &str, &[&str])],
        budgets: Value,
    ) -> (StatusCode, Value) {
        self.plan_with(ticket_id, tasks_json(tasks), budgets, vec![])
            .await
    }
    /// A plan request from explicit task objects and dependency overrides
    /// (ADR 0023).
    async fn plan_with(
        &self,
        ticket_id: &str,
        tasks: Vec<Value>,
        budgets: Value,
        dependency_overrides: Vec<Value>,
    ) -> (StatusCode, Value) {
        let mut body = json!({"tasks": tasks, "budgets": budgets});
        if !dependency_overrides.is_empty() {
            body["dependency_overrides"] = json!(dependency_overrides);
        }
        self.request(
            "POST",
            &format!("/api/v1/tickets/{ticket_id}/plans"),
            Some(body),
        )
        .await
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
    async fn approved(&self, tasks: &[(&str, &str, &[&str])], budgets: Value) -> (String, Value) {
        self.approved_with(tasks_json(tasks), budgets, vec![]).await
    }
    async fn approved_with(
        &self,
        tasks: Vec<Value>,
        budgets: Value,
        dependency_overrides: Vec<Value>,
    ) -> (String, Value) {
        let ticket = self.ticket().await;
        let (status, opened) = self
            .plan_with(
                ticket["id"].as_str().unwrap(),
                tasks,
                budgets,
                dependency_overrides,
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{opened}");
        self.approve(&opened["plan"]).await;
        (
            opened["run"]["id"].as_str().unwrap().to_owned(),
            opened["plan"].clone(),
        )
    }
    async fn implement(&self, run_id: &str, task_id: Option<&str>) -> (StatusCode, Value) {
        let mut body = json!({"provider": "test", "model": "synthetic"});
        if let Some(task_id) = task_id {
            body["task_id"] = json!(task_id);
        }
        self.request(
            "POST",
            &format!("/api/v1/runs/{run_id}/implement"),
            Some(body),
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
    async fn candidate_settled(&self, run_id: &str) -> Value {
        for _ in 0..2400 {
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
}
impl Drop for Harness {
    fn drop(&mut self) {
        self.state.cancel_active();
        if !self.root.as_os_str().is_empty() {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}

fn python() -> String {
    if cfg!(windows) { "python" } else { "python3" }.into()
}
/// `(id, scenario, depends_on)` implementer tasks on the repository named by
/// the ID.
fn tasks_json(tasks: &[(&str, &str, &[&str])]) -> Vec<Value> {
    tasks
        .iter()
        .map(|(id, scenario, depends_on)| {
            json!({"id": id, "repository_id": id, "paths": ["src"], "operations": ["read", "write"],
                "acceptance_criteria": [format!("fixture:{scenario}"), "the repository's tests pass"],
                "depends_on": depends_on})
        })
        .collect()
}
/// An advisory task (ADR 0023): read-only, writes nothing, returns a
/// structured result.
fn advisory(id: &str, role: &str, repository: &str, scenario: &str, depends_on: &[&str]) -> Value {
    json!({"id": id, "repository_id": repository, "role": role, "paths": ["."], "operations": ["read"],
        "acceptance_criteria": [format!("fixture:{scenario}"), "name the affected modules and task boundaries"],
        "depends_on": depends_on})
}
fn waive(consumer: &str, producer: &str) -> Value {
    json!({"consumer": consumer, "producer": producer, "action": "waive",
        "justification": format!("{consumer} does not consume {producer}'s change this time")})
}
fn add(consumer: &str, producer: &str) -> Value {
    json!({"consumer": consumer, "producer": producer, "action": "add",
        "justification": format!("{consumer} reads a schema {producer} generates")})
}
fn unit_check() -> Value {
    json!({"id": "unit", "executable": python(), "args": ["-m", "unittest", "discover", "-s", "tests", "-t", "."],
        "required": true, "timeout_seconds": 60, "capabilities": ["python"], "cwd": "."})
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

/// A forward-slash path literal for a Python source file.
fn py_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Three repositories: `api` exports `greet`, `shared` exports `helper` (and
/// `banner`, which imports `api_pkg`), `consumer` imports `shared_pkg.helper`.
/// Each repository's unittest check puts the producer's `src` on `sys.path`
/// from `LUUNA_DEPENDENCY_<PRODUCER>_PATH`, falling back to the developer
/// checkout so the baseline (which has no bindings) can pass.
struct Fixture {
    roots: Vec<(String, PathBuf)>,
}
impl Fixture {
    fn new(dir: &Path) -> Self {
        let roots: Vec<(String, PathBuf)> = REPOSITORIES
            .iter()
            .map(|id| ((*id).to_owned(), dir.join(id)))
            .collect();
        let root_of = |id: &str| roots.iter().find(|(r, _)| r == id).unwrap().1.clone();
        for (id, root) in &roots {
            fs::create_dir_all(root.join("src").join(format!("{id}_pkg"))).unwrap();
            fs::create_dir_all(root.join("tests")).unwrap();
            // `unittest discover -t .` imports `tests` as a package.
            fs::write(root.join("tests/__init__.py"), "").unwrap();
            fs::write(root.join("README.md"), format!("{id} fixture\n")).unwrap();
            fs::write(root.join("src/main.py"), "print('fixture')\n").unwrap();
            fs::write(
                root.join("package.json"),
                match id.as_str() {
                    "api" => r#"{"name": "@fixture/api", "version": "1.0.0"}"#.to_owned(),
                    "shared" => r#"{"name": "@fixture/shared", "dependencies": {"@fixture/api": "1.0.0"}}"#.to_owned(),
                    _ => r#"{"name": "@fixture/consumer", "dependencies": {"@fixture/shared": "1.0.0"}}"#.to_owned(),
                },
            )
            .unwrap();
        }
        fs::write(
            root_of("api").join("src/api_pkg/__init__.py"),
            "def greet(name):\n    return 'hello ' + name\n",
        )
        .unwrap();
        fs::write(
            root_of("api").join("tests/test_api.py"),
            "import os, sys, unittest\nsys.path.insert(0, os.path.join(os.getcwd(), 'src'))\nimport api_pkg\n\nclass ApiTest(unittest.TestCase):\n    def test_greet(self):\n        self.assertEqual(api_pkg.greet('x'), 'hello x')\n",
        )
        .unwrap();
        fs::write(
            root_of("shared").join("src/shared_pkg/__init__.py"),
            "def helper():\n    return 'helped'\n\ndef banner():\n    import api_pkg\n    return api_pkg.greet('shared')\n",
        )
        .unwrap();
        fs::write(
            root_of("shared").join("tests/test_shared.py"),
            format!(
                "import os, sys, unittest\nsys.path.insert(0, os.path.join(os.getcwd(), 'src'))\nsys.path.insert(0, os.path.join(os.environ.get('LUUNA_DEPENDENCY_API_PATH', '{}'), 'src'))\nimport shared_pkg\n\nclass SharedTest(unittest.TestCase):\n    def test_banner_uses_the_bound_api(self):\n        self.assertEqual(shared_pkg.banner(), 'hello shared')\n",
                py_path(&root_of("api"))
            ),
        )
        .unwrap();
        fs::write(
            root_of("consumer").join("src/consumer_pkg/__init__.py"),
            "def use_shared():\n    import shared_pkg\n    return shared_pkg.helper()\n",
        )
        .unwrap();
        fs::write(
            root_of("consumer").join("tests/test_consumer.py"),
            format!(
                "import os, sys, unittest\nsys.path.insert(0, os.path.join(os.getcwd(), 'src'))\nsys.path.insert(0, os.path.join(os.environ.get('LUUNA_DEPENDENCY_SHARED_PATH', '{}'), 'src'))\nimport consumer_pkg\n\nclass ConsumerTest(unittest.TestCase):\n    def test_shared_helper_is_importable(self):\n        self.assertEqual(consumer_pkg.use_shared(), 'helped')\n",
                py_path(&root_of("shared"))
            ),
        )
        .unwrap();
        for (id, root) in &roots {
            git(root, &["init", "-q", "-b", "main"]);
            git(root, &["config", "commit.gpgsign", "false"]);
            git(root, &["add", "."]);
            git(root, &["commit", "-q", "-m", "initial"]);
            git(
                root,
                &[
                    "remote",
                    "add",
                    "origin",
                    &format!("https://example.invalid/{id}.git"),
                ],
            );
        }
        Self { roots }
    }
    fn head(&self, id: &str) -> String {
        git(&self.root(id), &["rev-parse", "HEAD"])
    }
    fn root(&self, id: &str) -> PathBuf {
        self.roots.iter().find(|(r, _)| r == id).unwrap().1.clone()
    }
    fn snapshot(&self) -> Vec<(String, Vec<u8>)> {
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
        for (id, root) in &self.roots {
            let mut files = Vec::new();
            walk(root, root, &mut files);
            out.extend(files.into_iter().map(|(k, v)| (format!("{id}/{k}"), v)));
        }
        out.sort();
        out
    }
}

/// Register the three repositories, confirm the manifest and baseline each.
async fn ready(harness: &Harness, fixture: &Fixture) {
    let repositories: Vec<Value> = fixture
        .roots
        .iter()
        .map(|(id, root)| json!({"id": id, "path": root.to_string_lossy()}))
        .collect();
    let (status, view) = harness
        .request(
            "POST",
            "/api/v1/projects",
            Some(json!({"id":"fixture","name":"Fixture","repositories":repositories})),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{view}");
    let (status, view) = harness.confirm(0, confirmed_relationships()).await;
    assert_eq!(status, StatusCode::OK, "{view}");
    for id in REPOSITORIES {
        harness.baseline(id).await;
    }
}

fn relationship(producer: &str, consumer: &str, confirmed: bool) -> Value {
    json!({"producer": producer, "consumer": consumer, "kind": "package", "contract": format!("npm:@fixture/{producer}"),
        "confirmed": confirmed, "evidence": [format!("{consumer}/package.json dependencies names @fixture/{producer}")]})
}
fn confirmed_relationships() -> Vec<Value> {
    vec![
        relationship("api", "shared", true),
        relationship("shared", "consumer", true),
    ]
}

const CHAIN: [(&str, &str, &[&str]); 3] = [
    ("api", "write_in_scope", &[]),
    ("shared", "write_in_scope", &["api"]),
    ("consumer", "write_in_scope", &["shared"]),
];

fn task(tasks: &[Value], id: &str) -> Value {
    tasks
        .iter()
        .find(|t| t["task_id"] == id)
        .cloned()
        .unwrap_or_else(|| panic!("task {id} missing from {tasks:?}"))
}

#[tokio::test]
async fn a_compatible_change_produces_three_exact_commits_and_a_reviewed_candidate_set() {
    let harness = Harness::new();
    let dir = tempfile::tempdir().unwrap();
    let fixture = Fixture::new(dir.path());
    ready(&harness, &fixture).await;
    let before = fixture.snapshot();
    let (run_id, plan) = harness
        .approved(&CHAIN, json!({"max_attempts": 4, "timeout_seconds": 600}))
        .await;
    assert_eq!(plan["tasks"].as_array().unwrap().len(), 3);
    assert_eq!(plan["budgets"]["max_workers"], 1);
    for id in REPOSITORIES {
        assert_eq!(plan["base_commits"][id], fixture.head(id));
    }
    assert_eq!(plan["required_checks"].as_array().unwrap().len(), 3);

    let (status, run) = harness.implement(&run_id, None).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{run}");
    assert_eq!(run["state"], "implementing");
    // A second start is refused while the graph runs.
    assert_eq!(
        harness.implement(&run_id, None).await.0,
        StatusCode::CONFLICT
    );
    let settled = harness.settled(&run_id).await;
    assert_eq!(settled["state"], "validating", "{settled}");

    let tasks = harness.tasks(&run_id).await;
    assert_eq!(tasks.len(), 3, "{tasks:?}");
    for t in &tasks {
        assert_eq!(t["state"], "completed", "{t}");
        assert!(t["candidate_commit"].is_string() && t["candidate_tree"].is_string());
    }
    let events = harness.events(&run_id).await;
    let scheduled: Vec<&str> = events
        .iter()
        .filter(|e| e["type"] == "task.scheduled")
        .map(|e| e["payload"]["task_id"].as_str().unwrap())
        .collect();
    assert_eq!(scheduled, ["api", "shared", "consumer"], "dependency order");
    assert_eq!(
        events
            .iter()
            .filter(|e| e["type"] == "task.completed")
            .count(),
        3
    );
    // The consumer's writer received the shared producer's binding, stated
    // in its prompt; the shared writer received the api's.
    let fixture_args: Vec<&Value> = events
        .iter()
        .filter(|e| e["type"] == "pi.fixture_args")
        .map(|e| &e["payload"])
        .collect();
    assert_eq!(fixture_args.len(), 3);
    assert_eq!(fixture_args[0]["dependency_env"], json!({}));
    assert_eq!(fixture_args[0]["dependencies_stated"], false);
    let shared_commit = task(&tasks, "shared")["candidate_commit"]
        .as_str()
        .unwrap()
        .to_owned();
    let api_commit = task(&tasks, "api")["candidate_commit"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        fixture_args[1]["dependency_env"]["LUUNA_DEPENDENCY_API_COMMIT"],
        api_commit
    );
    assert_eq!(
        fixture_args[2]["dependency_env"]["LUUNA_DEPENDENCY_SHARED_COMMIT"],
        shared_commit
    );
    assert_eq!(fixture_args[2]["dependencies_stated"], true);
    let shared_path = PathBuf::from(
        fixture_args[2]["dependency_env"]["LUUNA_DEPENDENCY_SHARED_PATH"]
            .as_str()
            .unwrap(),
    );
    assert!(
        shared_path.starts_with(&harness.root),
        "{}",
        shared_path.display()
    );
    assert_eq!(git(&shared_path, &["rev-parse", "HEAD"]), shared_commit);

    let candidate = harness.candidate(&run_id).await;
    let set = &candidate["evidence"]["candidate"];
    assert_eq!(set["plan_hash"], plan["hash"]);
    for id in REPOSITORIES {
        assert_eq!(
            set["repository_commits"][id],
            task(&tasks, id)["candidate_commit"],
            "{set}"
        );
    }
    assert_eq!(
        set["dependency_bindings"],
        json!({"consumer:shared": shared_commit, "shared:api": api_commit})
    );
    // Validation runs every repository's check inside its own candidate
    // worktree with the bindings, binds the results to the exact commits and
    // ends in a fresh review of the combined diff.
    let (status, body) = harness
        .candidate_action(&run_id, "validate", &set["hash"])
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    let reviewed = harness.candidate_settled(&run_id).await;
    assert_eq!(reviewed["evidence"]["status"], "reviewed", "{reviewed}");
    let results = reviewed["evidence"]["results"].as_array().unwrap();
    assert_eq!(results.len(), 3, "{results:?}");
    for result in results {
        let repo = result["repository_id"].as_str().unwrap();
        assert_eq!(result["status"], "passed", "{result}");
        assert_eq!(result["commit"], set["repository_commits"][repo]);
        assert_eq!(result["tests_detected"], 1);
    }
    assert_eq!(reviewed["evidence"]["review"]["verdict"], "passed");
    let (status, diff) = harness
        .request("GET", &format!("/api/v1/runs/{run_id}/diff"), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{diff}");
    assert_eq!(diff["repositories"].as_array().unwrap().len(), 3);
    assert_eq!(diff["dependency_bindings"], set["dependency_bindings"]);
    // Repair of a multi-repository set is re-planning.
    assert_eq!(reviewed["repair_allowed"], false);
    assert_eq!(fixture.snapshot(), before);
}

#[tokio::test]
async fn an_incompatible_producer_change_blocks_the_set_at_the_consumer_check() {
    let harness = Harness::new();
    let dir = tempfile::tempdir().unwrap();
    let fixture = Fixture::new(dir.path());
    ready(&harness, &fixture).await;
    let (run_id, _) = harness
        .approved(
            &[
                ("api", "write_in_scope", &[]),
                ("shared", "write_rename_function", &["api"]),
                ("consumer", "write_in_scope", &["shared"]),
            ],
            json!({"max_attempts": 3, "timeout_seconds": 600}),
        )
        .await;
    assert_eq!(
        harness.implement(&run_id, None).await.0,
        StatusCode::ACCEPTED
    );
    assert_eq!(harness.settled(&run_id).await["state"], "validating");
    let hash = harness.candidate(&run_id).await["evidence"]["candidate"]["hash"].clone();
    assert_eq!(
        harness.candidate_action(&run_id, "validate", &hash).await.0,
        StatusCode::ACCEPTED
    );
    let failed = harness.candidate_settled(&run_id).await;
    assert_eq!(failed["evidence"]["status"], "failed", "{failed}");
    let reason = failed["evidence"]["reason"].as_str().unwrap();
    assert!(reason.contains("consumer/unit"), "{reason}");
    assert!(reason.contains("integration blocked"), "{reason}");
    let results = failed["evidence"]["results"].as_array().unwrap();
    let status_of = |repo: &str| {
        results
            .iter()
            .find(|r| r["repository_id"] == repo)
            .map(|r| r["status"].clone())
            .unwrap_or(Value::Null)
    };
    // The producer's own check passed: single-repository success never stands
    // for integration success.
    assert_eq!(status_of("api"), "passed");
    assert_eq!(status_of("shared"), "passed");
    assert_eq!(status_of("consumer"), "failed", "{results:?}");
    assert_eq!(failed["repair_allowed"], false);
    let refusal = failed["decision_reasons"]["repair"].as_str().unwrap();
    assert!(refusal.contains("multi-repository"), "{refusal}");
    let (status, body) = harness.candidate_action(&run_id, "repair", &hash).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(
        body["error"].as_str().unwrap().contains("re-plan"),
        "{body}"
    );
    assert_eq!(harness.run(&run_id).await["state"], "failed");
}

#[tokio::test]
async fn independent_tasks_overlap_within_max_workers_and_more_workers_are_refused() {
    let harness = Harness::new();
    let dir = tempfile::tempdir().unwrap();
    let fixture = Fixture::new(dir.path());
    ready(&harness, &fixture).await;
    let independent: [(&str, &str, &[&str]); 3] = [
        ("api", "write_hold_3", &[]),
        ("shared", "write_hold_3", &[]),
        ("consumer", "write_hold_3", &[]),
    ];
    // A plan cannot ask for more workers than it has tasks, and never more
    // than the runtime's own limit.
    let ticket = harness.ticket().await;
    // The confirmed relationships imply `shared -> api` and `consumer ->
    // shared`; independent work waives both with a justification (P44).
    let waivers = vec![waive("shared", "api"), waive("consumer", "shared")];
    let (status, refused) = harness
        .plan_with(
            ticket["id"].as_str().unwrap(),
            tasks_json(&independent),
            json!({"max_workers": 4, "max_attempts": 3}),
            waivers.clone(),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert!(
        refused["error"]
            .as_str()
            .unwrap()
            .contains("budgets.max_workers must be between 1 and 3"),
        "{refused}"
    );
    let (status, opened) = harness
        .plan_with(
            ticket["id"].as_str().unwrap(),
            tasks_json(&independent),
            json!({"max_workers": 2, "max_attempts": 3, "timeout_seconds": 600}),
            waivers,
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{opened}");
    assert_eq!(opened["plan"]["budgets"]["max_workers"], 2);
    harness.approve(&opened["plan"]).await;
    let run_id = opened["run"]["id"].as_str().unwrap().to_owned();
    assert_eq!(
        harness.implement(&run_id, None).await.0,
        StatusCode::ACCEPTED
    );
    assert_eq!(harness.settled(&run_id).await["state"], "validating");
    let attempts = harness.attempts(&run_id).await;
    assert_eq!(attempts.len(), 3, "{attempts:?}");
    let span = |a: &Value| {
        (
            a["started_at"].as_str().unwrap().to_owned(),
            a["finished_at"].as_str().unwrap().to_owned(),
        )
    };
    let (first, second, third) = (span(&attempts[0]), span(&attempts[1]), span(&attempts[2]));
    // The first two attempts overlap (each holds three seconds); the third
    // starts only after one of them finished.
    assert!(
        second.0 < first.1,
        "attempt 2 started after attempt 1 finished: {attempts:?}"
    );
    assert!(
        third.0 >= first.1.clone().min(second.1.clone()),
        "attempt 3 overlapped both: {attempts:?}"
    );
    let events = harness.events(&run_id).await;
    let implementing = events
        .iter()
        .find(|e| e["type"] == "run.implementing")
        .unwrap();
    assert_eq!(implementing["payload"]["max_workers"], 2);
    for t in harness.tasks(&run_id).await {
        assert_eq!(t["state"], "completed", "{t}");
    }
    let _ = fixture;
}

#[tokio::test]
async fn an_interrupted_graph_keeps_completed_tasks_and_is_visible_after_restart() {
    let mut harness = Harness::new();
    let dir = tempfile::tempdir().unwrap();
    let fixture = Fixture::new(dir.path());
    ready(&harness, &fixture).await;
    let before = fixture.snapshot();
    let (run_id, _) = harness
        .approved(
            &[
                ("api", "write_in_scope", &[]),
                ("shared", "write_until_released", &["api"]),
                ("consumer", "write_in_scope", &["shared"]),
            ],
            json!({"max_attempts": 5, "timeout_seconds": 600}),
        )
        .await;
    assert_eq!(
        harness.implement(&run_id, None).await.0,
        StatusCode::ACCEPTED
    );
    harness.wait_for_events(&run_id, "task.completed", 1).await;
    harness.wait_for_events(&run_id, "pi.agent_start", 2).await;
    let api_commit = task(&harness.tasks(&run_id).await, "api")["candidate_commit"]
        .as_str()
        .unwrap()
        .to_owned();
    // An orderly shutdown interrupts the running task and settles the run.
    harness.state.shutdown().await;
    assert_eq!(harness.run(&run_id).await["state"], "interrupted");
    let events = harness.events(&run_id).await;
    assert!(
        events.iter().any(|e| e["type"] == "task.interrupted"
            && e["payload"]["task_id"] == "shared"
            && e["payload"]["reason"]
                .as_str()
                .unwrap()
                .starts_with("interrupted by runtime shutdown")),
        "{events:?}"
    );
    assert!(events.iter().any(|e| e["type"] == "run.interrupted"));
    let tasks = harness.tasks(&run_id).await;
    assert_eq!(task(&tasks, "api")["state"], "completed");
    assert_eq!(task(&tasks, "api")["candidate_commit"], api_commit);
    assert_eq!(task(&tasks, "shared")["state"], "interrupted");
    let api_worktree = PathBuf::from(
        harness
            .request("GET", &format!("/api/v1/runs/{run_id}/worktrees"), None)
            .await
            .1[0]["path"]
            .as_str()
            .unwrap(),
    );
    assert!(api_worktree.join("src/main.py").exists());
    assert_eq!(git(&api_worktree, &["rev-parse", "HEAD"]), api_commit);

    // Restart: the graph is visible with completed tasks intact. The
    // interrupted writer was mid-prompt, so its attempt reserved the remaining
    // approved cost budget (ADR 0009 point 5); the task-state gate admits the
    // resumption, the budget gate refuses it with its re-plan requirement.
    let root = std::mem::take(&mut harness.root);
    drop(harness);
    let harness = Harness::open(root);
    let tasks = harness.tasks(&run_id).await;
    assert_eq!(task(&tasks, "api")["state"], "completed");
    assert_eq!(task(&tasks, "api")["candidate_commit"], api_commit);
    assert_eq!(task(&tasks, "shared")["state"], "interrupted");
    assert_eq!(task(&tasks, "consumer")["state"], "interrupted");
    assert_eq!(git(&api_worktree, &["rev-parse", "HEAD"]), api_commit);
    let (status, body) = harness.implement(&run_id, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(
        body["error"].as_str().unwrap().contains("task_id"),
        "{body}"
    );
    let (status, body) = harness.implement(&run_id, Some("shared")).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(
        body["error"].as_str().unwrap().contains("re-plan"),
        "{body}"
    );
    let attempts = harness.attempts(&run_id).await;
    assert_eq!(attempts.len(), 2, "{attempts:?}");
    assert_eq!(attempts[1]["state"], "interrupted");
    assert!(attempts[1]["payload"]["reason"]
        .as_str()
        .unwrap()
        .contains("remaining approved cost budget is reserved"));
    assert_eq!(fixture.snapshot(), before);
}

#[tokio::test]
async fn a_failed_task_resumes_by_task_id_and_completed_tasks_keep_their_commits() {
    let harness = Harness::new();
    let dir = tempfile::tempdir().unwrap();
    let fixture = Fixture::new(dir.path());
    ready(&harness, &fixture).await;
    let before = fixture.snapshot();
    let (run_id, _) = harness
        .approved(
            &[
                ("api", "write_in_scope", &[]),
                ("shared", "write_if_released", &["api"]),
                ("consumer", "write_in_scope", &["shared"]),
            ],
            json!({"max_attempts": 5, "timeout_seconds": 600}),
        )
        .await;
    assert_eq!(
        harness.implement(&run_id, None).await.0,
        StatusCode::ACCEPTED
    );
    let settled = harness.settled(&run_id).await;
    assert_eq!(settled["state"], "failed", "{settled}");
    let tasks = harness.tasks(&run_id).await;
    assert_eq!(task(&tasks, "api")["state"], "completed");
    assert_eq!(task(&tasks, "shared")["state"], "failed");
    assert!(task(&tasks, "shared")["reason"]
        .as_str()
        .unwrap()
        .contains("without changing any file"));
    assert_eq!(task(&tasks, "consumer")["state"], "blocked");
    let api_commit = task(&tasks, "api")["candidate_commit"]
        .as_str()
        .unwrap()
        .to_owned();
    // A completed task cannot be resumed; the failed one resumes the graph
    // under the original approval and requeues the blocked consumer.
    assert_eq!(
        harness.implement(&run_id, Some("api")).await.0,
        StatusCode::CONFLICT
    );
    fs::write(
        harness.root.join("worktrees").join(&run_id).join("RELEASE"),
        "go\n",
    )
    .unwrap();
    let (status, body) = harness.implement(&run_id, Some("shared")).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    let events = harness.events(&run_id).await;
    let resumed = events
        .iter()
        .rfind(|e| e["type"] == "run.implementing")
        .unwrap();
    assert_eq!(resumed["payload"]["resumed_task"], "shared");
    assert_eq!(
        resumed["payload"]["requeued"],
        json!(["shared", "consumer"])
    );
    let settled = harness.settled(&run_id).await;
    assert_eq!(settled["state"], "validating", "{settled}");
    let tasks = harness.tasks(&run_id).await;
    for t in &tasks {
        assert_eq!(t["state"], "completed", "{t}");
    }
    assert_eq!(task(&tasks, "api")["candidate_commit"], api_commit);
    let attempts = harness.attempts(&run_id).await;
    assert_eq!(attempts.len(), 4, "{attempts:?}");
    assert_eq!(attempts[1]["state"], "failed");
    assert_eq!(attempts[2]["task_id"], "shared");
    assert_eq!(attempts[2]["state"], "completed");
    let set = &harness.candidate(&run_id).await["evidence"]["candidate"];
    assert_eq!(set["repository_commits"]["api"], api_commit);
    assert_eq!(
        set["repository_commits"]["shared"],
        task(&tasks, "shared")["candidate_commit"]
    );
    assert_eq!(set["dependency_bindings"]["shared:api"], api_commit);
    assert_eq!(
        set["dependency_bindings"]["consumer:shared"],
        task(&tasks, "shared")["candidate_commit"]
    );
    assert_eq!(fixture.snapshot(), before);
}

#[tokio::test]
async fn a_hard_kill_interrupts_the_running_task_and_keeps_completed_commits() {
    let mut harness = Harness::new();
    let dir = tempfile::tempdir().unwrap();
    let fixture = Fixture::new(dir.path());
    ready(&harness, &fixture).await;
    let (run_id, _) = harness
        .approved(
            &[
                ("api", "write_in_scope", &[]),
                ("shared", "write_until_released", &["api"]),
            ],
            json!({"max_attempts": 4, "timeout_seconds": 600}),
        )
        .await;
    assert_eq!(
        harness.implement(&run_id, None).await.0,
        StatusCode::ACCEPTED
    );
    harness.wait_for_events(&run_id, "task.completed", 1).await;
    harness.wait_for_events(&run_id, "pi.agent_start", 2).await;
    let api_commit = task(&harness.tasks(&run_id).await, "api")["candidate_commit"]
        .as_str()
        .unwrap()
        .to_owned();
    // Startup recovery on the same database, as a restarted runtime performs
    // it after a hard kill: the durable graph settles before anything runs.
    {
        let mut store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
        assert_eq!(store.interrupt_active_runs().unwrap(), 1);
        let tasks = store.run_tasks(&run_id).unwrap();
        let state_of = |id: &str| tasks.iter().find(|t| t.task_id == id).unwrap().state;
        assert_eq!(state_of("api"), luuna_domain::TaskState::Completed);
        assert_eq!(state_of("shared"), luuna_domain::TaskState::Interrupted);
        assert_eq!(
            tasks
                .iter()
                .find(|t| t.task_id == "api")
                .unwrap()
                .candidate_commit
                .as_deref(),
            Some(api_commit.as_str())
        );
        assert!(store.active_worktree_leases().unwrap().is_empty());
    }
    assert_eq!(harness.run(&run_id).await["state"], "interrupted");
    let events = harness.events(&run_id).await;
    assert!(events.iter().any(|e| e["type"] == "task.interrupted"
        && e["payload"]["task_id"] == "shared"
        && e["payload"]["reason"].as_str().unwrap().contains("task_id")));
    // The stale scheduler cannot resurrect the settled run.
    harness.state.shutdown().await;
    let root = std::mem::take(&mut harness.root);
    drop(harness);
    let harness = Harness::open(root);
    let tasks = harness.tasks(&run_id).await;
    assert_eq!(task(&tasks, "api")["state"], "completed");
    assert_eq!(task(&tasks, "api")["candidate_commit"], api_commit);
    assert_eq!(task(&tasks, "shared")["state"], "interrupted");
    // The attempt lost to the restart reserved the remaining approved time
    // and cost (ADR 0009), so resumption is refused with its re-plan
    // requirement; the evidence and worktrees stay.
    fs::write(
        harness.root.join("worktrees").join(&run_id).join("RELEASE"),
        "go\n",
    )
    .unwrap();
    let (status, body) = harness.implement(&run_id, Some("shared")).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(
        body["error"].as_str().unwrap().contains("re-plan"),
        "{body}"
    );
    assert_eq!(harness.run(&run_id).await["state"], "interrupted");
}

#[tokio::test]
async fn cancellation_stops_every_running_task_and_records_cancelled() {
    let harness = Harness::new();
    let dir = tempfile::tempdir().unwrap();
    let fixture = Fixture::new(dir.path());
    ready(&harness, &fixture).await;
    let (run_id, _) = harness
        .approved_with(
            tasks_json(&[
                ("api", "slow", &[]),
                ("shared", "slow", &[]),
                ("consumer", "write_in_scope", &["api", "shared"]),
            ]),
            json!({"max_workers": 2, "max_attempts": 3, "timeout_seconds": 600}),
            vec![waive("shared", "api"), add("consumer", "api")],
        )
        .await;
    assert_eq!(
        harness.implement(&run_id, None).await.0,
        StatusCode::ACCEPTED
    );
    harness.wait_for_events(&run_id, "pi.agent_start", 2).await;
    let (status, _) = harness
        .request("POST", &format!("/api/v1/runs/{run_id}/cancel"), None)
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let settled = harness.settled(&run_id).await;
    assert_eq!(settled["state"], "cancelled", "{settled}");
    let tasks = harness.tasks(&run_id).await;
    assert_eq!(task(&tasks, "api")["state"], "cancelled");
    assert_eq!(task(&tasks, "shared")["state"], "cancelled");
    assert_eq!(task(&tasks, "consumer")["state"], "cancelled");
    let attempts = harness.attempts(&run_id).await;
    assert_eq!(attempts.len(), 2);
    assert!(
        attempts.iter().all(|a| a["state"] == "cancelled"),
        "{attempts:?}"
    );
    let store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    assert!(store.active_worktree_leases().unwrap().is_empty());
}

#[tokio::test]
async fn a_failed_producer_blocks_its_consumers_with_the_reason() {
    let harness = Harness::new();
    let dir = tempfile::tempdir().unwrap();
    let fixture = Fixture::new(dir.path());
    ready(&harness, &fixture).await;
    let (run_id, _) = harness
        .approved_with(
            tasks_json(&[
                ("api", "no_change", &[]),
                ("shared", "write_in_scope", &["api"]),
                ("consumer", "write_in_scope", &[]),
            ]),
            json!({"max_workers": 2, "max_attempts": 3, "timeout_seconds": 600}),
            vec![waive("consumer", "shared")],
        )
        .await;
    assert_eq!(
        harness.implement(&run_id, None).await.0,
        StatusCode::ACCEPTED
    );
    let settled = harness.settled(&run_id).await;
    assert_eq!(settled["state"], "failed", "{settled}");
    let tasks = harness.tasks(&run_id).await;
    assert_eq!(task(&tasks, "api")["state"], "failed");
    assert_eq!(task(&tasks, "shared")["state"], "blocked");
    let reason = task(&tasks, "shared")["reason"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(reason.contains("dependency task api failed"), "{reason}");
    assert!(reason.contains("without changing any file"), "{reason}");
    // The independent task still ran to completion; its commit is kept.
    assert_eq!(task(&tasks, "consumer")["state"], "completed");
    let events = harness.events(&run_id).await;
    assert!(events
        .iter()
        .any(|e| e["type"] == "task.blocked" && e["payload"]["task_id"] == "shared"));
    assert!(events
        .iter()
        .any(|e| e["type"] == "task.failed" && e["payload"]["task_id"] == "api"));
    // The failed task resumes by name; the blocked consumer is requeued too.
    let (status, body) = harness.implement(&run_id, Some("consumer")).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    let _ = fixture;
}

#[tokio::test]
async fn cyclic_plans_and_unconfirmed_relationships_are_refused() {
    let harness = Harness::new();
    let dir = tempfile::tempdir().unwrap();
    let fixture = Fixture::new(dir.path());
    let repositories: Vec<Value> = fixture
        .roots
        .iter()
        .map(|(id, root)| json!({"id": id, "path": root.to_string_lossy()}))
        .collect();
    let (status, view) = harness
        .request(
            "POST",
            "/api/v1/projects",
            Some(json!({"id":"fixture","name":"Fixture","repositories":repositories})),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{view}");
    // Discovery proposes the package relationships from package.json with
    // evidence and confirmed: false.
    let (status, discovery) = harness
        .request("POST", "/api/v1/projects/fixture/discover", None)
        .await;
    assert_eq!(status, StatusCode::CREATED, "{discovery}");
    let proposed = discovery["proposed_manifest"]["relationships"]
        .as_array()
        .cloned()
        .unwrap();
    let edges: Vec<(String, String)> = proposed
        .iter()
        .map(|r| {
            (
                r["producer"].as_str().unwrap().to_owned(),
                r["consumer"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    assert_eq!(
        edges,
        [
            ("api".to_owned(), "shared".to_owned()),
            ("shared".to_owned(), "consumer".to_owned())
        ],
        "{proposed:?}"
    );
    assert!(proposed
        .iter()
        .all(|r| r["confirmed"] == false && r["kind"] == "package"));
    assert!(proposed[0]["evidence"][0]
        .as_str()
        .unwrap()
        .contains("shared/package.json dependencies"));
    // Confirming the proposal as-is is refused until each relationship is
    // confirmed or removed.
    let (status, refused) = harness.confirm(0, proposed.clone()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    let error = refused["error"].as_str().unwrap();
    assert!(error.contains("not confirmed"), "{error}");
    assert!(error.contains("api -> shared"), "{error}");
    // A confirmed cycle is refused by the manifest contract.
    let (status, refused) = harness
        .confirm(
            0,
            vec![
                relationship("api", "shared", true),
                relationship("shared", "api", true),
            ],
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert!(
        refused["error"].as_str().unwrap().contains("cycle"),
        "{refused}"
    );
    let (status, view) = harness.confirm(0, confirmed_relationships()).await;
    assert_eq!(status, StatusCode::OK, "{view}");
    // A cyclic task graph is refused at plan creation with the cycle named.
    let ticket = harness.ticket().await;
    let (status, refused) = harness
        .plan(
            ticket["id"].as_str().unwrap(),
            &[
                ("api", "write_in_scope", &["consumer"]),
                ("shared", "write_in_scope", &["api"]),
                ("consumer", "write_in_scope", &["shared"]),
            ],
            json!({}),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    let error = refused["error"].as_str().unwrap();
    assert!(error.contains("cycle"), "{error}");
    assert!(
        error.contains("api -> consumer -> shared -> api"),
        "{error}"
    );
    for (tasks, expected) in [
        (
            vec![("api", "write_in_scope", &["nope"][..])],
            "depends on unknown task nope",
        ),
        (
            vec![("api", "write_in_scope", &["api"][..])],
            "depends on itself",
        ),
        (
            vec![
                ("api", "write_in_scope", &[][..]),
                ("api", "write_in_scope", &[][..]),
            ],
            "distinct repositories",
        ),
    ] {
        let (status, refused) = harness
            .plan(ticket["id"].as_str().unwrap(), &tasks, json!({}))
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
        assert!(
            refused["error"].as_str().unwrap().contains(expected),
            "{refused}"
        );
    }
}

#[tokio::test]
async fn a_plan_missing_a_confirmed_dependency_is_refused_unless_waived_and_the_waiver_is_traced() {
    let harness = Harness::new();
    let dir = tempfile::tempdir().unwrap();
    let fixture = Fixture::new(dir.path());
    ready(&harness, &fixture).await;
    let before = fixture.snapshot();
    let ticket = harness.ticket().await;
    let ticket_id = ticket["id"].as_str().unwrap();
    let independent_consumer: [(&str, &str, &[&str]); 3] = [
        ("api", "write_in_scope", &[]),
        ("shared", "write_in_scope", &["api"]),
        ("consumer", "write_in_scope", &[]),
    ];
    // The confirmed `shared -> consumer` relationship implies the dependency;
    // the refusal names the relationship and the waiver that would allow it.
    let (status, refused) = harness
        .plan(ticket_id, &independent_consumer, json!({}))
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    let error = refused["error"].as_str().unwrap();
    assert!(
        error.contains(
            "task consumer in repository consumer must depend on task shared in repository shared"
        ),
        "{error}"
    );
    assert!(
        error.contains("confirmed relationship shared -> consumer (package npm:@fixture/shared)"),
        "{error}"
    );
    assert!(error.contains("\"action\": \"waive\""), "{error}");
    // Malformed overrides are refused by the plan contract.
    for (overrides, expected) in [
        (
            vec![
                json!({"consumer": "consumer", "producer": "shared", "action": "waive", "justification": "   "}),
            ],
            "needs a justification",
        ),
        (
            vec![waive("consumer", "shared"), waive("consumer", "shared")],
            "listed more than once",
        ),
        (vec![waive("consumer", "nope")], "names unknown task nope"),
        (
            vec![waive("consumer", "shared"), waive("shared", "api")],
            "dependency override waive shared <- api does not apply",
        ),
    ] {
        let (status, refused) = harness
            .plan_with(
                ticket_id,
                tasks_json(&independent_consumer),
                json!({}),
                overrides,
            )
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
        assert!(
            refused["error"].as_str().unwrap().contains(expected),
            "{expected}: {refused}"
        );
    }
    // Waived with a justification, the plan is accepted and the override is
    // part of the sealed plan.
    let waiver = waive("consumer", "shared");
    let (status, opened) = harness
        .plan_with(
            ticket_id,
            tasks_json(&independent_consumer),
            json!({"max_workers": 2, "max_attempts": 3, "timeout_seconds": 600}),
            vec![waiver.clone()],
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{opened}");
    let plan = &opened["plan"];
    assert_eq!(plan["dependency_overrides"], json!([waiver]));
    assert_eq!(plan["tasks"][0]["role"], "implementer");
    assert!(plan["tasks"][0].get("derived_from_task").is_none());
    harness.approve(plan).await;
    let run_id = opened["run"]["id"].as_str().unwrap().to_owned();
    assert_eq!(
        harness.implement(&run_id, None).await.0,
        StatusCode::ACCEPTED
    );
    assert_eq!(harness.settled(&run_id).await["state"], "validating");
    // The trace: every task records who assigned it (the developer's exact
    // approval), its role and the overrides that name it.
    let tasks = harness.tasks(&run_id).await;
    for t in &tasks {
        assert_eq!(t["state"], "completed", "{t}");
        assert_eq!(t["role"], "implementer", "{t}");
        assert_eq!(t["assigned_by"]["approved_by"], "developer", "{t}");
        assert_eq!(t["assigned_by"]["plan_hash"], plan["hash"], "{t}");
        assert_eq!(t["assigned_by"]["plan_revision"], plan["revision"], "{t}");
        assert!(t.get("derived_from_task").is_none(), "{t}");
    }
    assert_eq!(
        task(&tasks, "consumer")["dependency_overrides"],
        json!([waiver])
    );
    assert_eq!(
        task(&tasks, "shared")["dependency_overrides"],
        json!([waiver])
    );
    assert!(task(&tasks, "api").get("dependency_overrides").is_none());
    let events = harness.events(&run_id).await;
    let assigned: Vec<&Value> = events
        .iter()
        .filter(|e| e["type"] == "task.assigned")
        .collect();
    assert_eq!(assigned.len(), 3, "{events:?}");
    for event in &assigned {
        assert_eq!(event["payload"]["role"], "implementer");
        assert_eq!(event["payload"]["assigned_by"]["approved_by"], "developer");
        assert_eq!(event["payload"]["plan_hash"], plan["hash"]);
    }
    for kind in ["task.scheduled", "task.completed"] {
        let consumer = events
            .iter()
            .find(|e| e["type"] == kind && e["payload"]["task_id"] == "consumer")
            .unwrap_or_else(|| panic!("{kind} for consumer missing"));
        assert_eq!(consumer["payload"]["dependency_overrides"], json!([waiver]));
        assert_eq!(consumer["payload"]["role"], "implementer");
    }
    // The candidate set view lists the overrides and the traced tasks; the
    // waived pair is not bound.
    let candidate = harness.candidate(&run_id).await;
    assert_eq!(candidate["dependency_overrides"], json!([waiver]));
    assert_eq!(candidate["tasks"].as_array().unwrap().len(), 3);
    let set = &candidate["evidence"]["candidate"];
    assert_eq!(set["repository_commits"].as_object().unwrap().len(), 3);
    assert_eq!(
        set["dependency_bindings"],
        json!({"shared:api": task(&tasks, "api")["candidate_commit"]})
    );
    assert_eq!(fixture.snapshot(), before);
}

#[tokio::test]
async fn a_dependency_without_a_confirmed_relationship_needs_an_add_override() {
    let harness = Harness::new();
    let dir = tempfile::tempdir().unwrap();
    let fixture = Fixture::new(dir.path());
    ready(&harness, &fixture).await;
    let ticket = harness.ticket().await;
    let ticket_id = ticket["id"].as_str().unwrap();
    let chain_plus: [(&str, &str, &[&str]); 3] = [
        ("api", "write_in_scope", &[]),
        ("shared", "write_in_scope", &["api"]),
        ("consumer", "write_in_scope", &["shared", "api"]),
    ];
    let (status, refused) = harness.plan(ticket_id, &chain_plus, json!({})).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    let error = refused["error"].as_str().unwrap();
    assert!(
        error.contains("task consumer in repository consumer depends on task api in repository api, but no confirmed relationship api -> consumer exists"),
        "{error}"
    );
    assert!(error.contains("\"action\": \"add\""), "{error}");
    // An add override for a pair the confirmed graph already covers is idle.
    let (status, refused) = harness
        .plan_with(
            ticket_id,
            tasks_json(&chain_plus),
            json!({}),
            vec![add("consumer", "api"), add("shared", "api")],
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert!(
        refused["error"]
            .as_str()
            .unwrap()
            .contains("dependency override add shared <- api does not apply"),
        "{refused}"
    );
    let addition = add("consumer", "api");
    let (status, opened) = harness
        .plan_with(
            ticket_id,
            tasks_json(&chain_plus),
            json!({"max_attempts": 3, "timeout_seconds": 600}),
            vec![addition.clone()],
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{opened}");
    assert_eq!(opened["plan"]["dependency_overrides"], json!([addition]));
    harness.approve(&opened["plan"]).await;
    let run_id = opened["run"]["id"].as_str().unwrap().to_owned();
    assert_eq!(
        harness.implement(&run_id, None).await.0,
        StatusCode::ACCEPTED
    );
    assert_eq!(harness.settled(&run_id).await["state"], "validating");
    let tasks = harness.tasks(&run_id).await;
    assert_eq!(
        task(&tasks, "consumer")["dependency_overrides"],
        json!([addition])
    );
    assert_eq!(
        task(&tasks, "api")["dependency_overrides"],
        json!([addition])
    );
    // The added edge binds the producer's exact commit like a confirmed one.
    let api_commit = task(&tasks, "api")["candidate_commit"].clone();
    let shared_commit = task(&tasks, "shared")["candidate_commit"].clone();
    let set = &harness.candidate(&run_id).await["evidence"]["candidate"];
    assert_eq!(
        set["dependency_bindings"],
        json!({"consumer:api": api_commit, "consumer:shared": shared_commit, "shared:api": api_commit})
    );
    let events = harness.events(&run_id).await;
    let consumer_args = events
        .iter()
        .filter(|e| e["type"] == "pi.fixture_args")
        .map(|e| &e["payload"])
        .nth(2)
        .unwrap();
    assert_eq!(
        consumer_args["dependency_env"]["LUUNA_DEPENDENCY_API_COMMIT"],
        api_commit
    );
}

#[tokio::test]
async fn an_orchestrator_task_runs_first_records_its_advisory_result_and_the_trace() {
    let harness = Harness::new();
    let dir = tempfile::tempdir().unwrap();
    let fixture = Fixture::new(dir.path());
    ready(&harness, &fixture).await;
    let before = fixture.snapshot();
    // Revision 1: one project orchestrator, nothing else. It reads, writes
    // nothing, and the run completes with its result and no candidate.
    let ticket = harness.ticket().await;
    let ticket_id = ticket["id"].as_str().unwrap();
    // An advisory task is read-only by contract.
    let (status, refused) = harness
        .plan_with(
            ticket_id,
            vec![json!({"id": "orchestrate", "repository_id": "api", "role": "project_orchestrator",
                "paths": ["."], "operations": ["read", "write"], "acceptance_criteria": ["fixture:advise_json"]})],
            json!({}),
            vec![],
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert!(
        refused["error"].as_str().unwrap().contains(
            "advisory role project_orchestrator and must carry exactly the read operation"
        ),
        "{refused}"
    );
    let (status, refused) = harness
        .plan_with(
            ticket_id,
            vec![json!({"id": "orchestrate", "repository_id": "api", "role": "wizard",
                "paths": ["."], "operations": ["read"], "acceptance_criteria": ["fixture:advise_json"]})],
            json!({}),
            vec![],
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert!(
        refused["error"]
            .as_str()
            .unwrap()
            .contains("role \"wizard\""),
        "{refused}"
    );
    let (status, opened) = harness
        .plan_with(
            ticket_id,
            vec![advisory(
                "orchestrate",
                "project_orchestrator",
                "api",
                "advise_json",
                &[],
            )],
            json!({"max_attempts": 2, "timeout_seconds": 600}),
            vec![],
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{opened}");
    let first = opened["plan"].clone();
    assert_eq!(first["tasks"][0]["role"], "project_orchestrator");
    harness.approve(&first).await;
    let run_id = opened["run"]["id"].as_str().unwrap().to_owned();
    assert_eq!(
        harness.implement(&run_id, None).await.0,
        StatusCode::ACCEPTED
    );
    let settled = harness.settled(&run_id).await;
    assert_eq!(settled["state"], "completed", "{settled}");
    let tasks = harness.tasks(&run_id).await;
    let orchestrate = task(&tasks, "orchestrate");
    assert_eq!(orchestrate["state"], "completed", "{orchestrate}");
    assert_eq!(orchestrate["role"], "project_orchestrator");
    assert!(
        orchestrate.get("candidate_commit").is_none(),
        "{orchestrate}"
    );
    assert_eq!(
        orchestrate["advisory_result"]["risks"][0],
        "renaming helper breaks the consumer import"
    );
    assert_eq!(
        orchestrate["advisory_result"]["proposed_tasks"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(orchestrate["assigned_by"]["approved_by"], "developer");
    assert_eq!(orchestrate["assigned_by"]["plan_hash"], first["hash"]);
    let events = harness.events(&run_id).await;
    assert!(events.iter().any(|e| e["type"] == "task.assigned"
        && e["payload"]["task_id"] == "orchestrate"
        && e["payload"]["role"] == "project_orchestrator"));
    let completed = events
        .iter()
        .find(|e| e["type"] == "task.completed")
        .unwrap();
    assert_eq!(completed["payload"]["role"], "project_orchestrator");
    assert!(completed["payload"]["advisory_result"]["findings"].is_array());
    assert!(completed["payload"]["candidate_commit"].is_null());
    // The session had read-only tools, the scope guard and the role contract.
    let args = events
        .iter()
        .find(|e| e["type"] == "pi.fixture_args")
        .unwrap();
    let tools = args["payload"]["tools"].as_str().unwrap();
    assert!(
        !tools.contains("write") && !tools.contains("edit") && tools.contains("read"),
        "{tools}"
    );
    assert_eq!(args["payload"]["system_prompt_from_file"], true);
    let attempts = harness.attempts(&run_id).await;
    assert_eq!(attempts.len(), 1);
    assert_eq!(attempts[0]["state"], "completed");
    assert_eq!(
        attempts[0]["payload"]["advisory_result"],
        orchestrate["advisory_result"]
    );
    assert_eq!(attempts[0]["payload"]["role"], "project_orchestrator");
    let candidate = harness.candidate(&run_id).await;
    assert!(candidate["evidence"].is_null(), "{candidate}");
    assert_eq!(
        candidate["tasks"][0]["advisory_result"],
        orchestrate["advisory_result"]
    );
    let store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    assert!(store.active_worktree_leases().unwrap().is_empty());
    assert_eq!(fixture.snapshot(), before);

    // Revision 2: the developer copies the orchestrator's proposal. Each
    // implementer names the advisory task it derives from (the trace's
    // parent); a repository lead in `shared` advises before the api writer
    // runs and shares its repository with the shared implementer.
    let mut derived = tasks_json(&CHAIN);
    for task in &mut derived {
        task["derived_from_task"] = json!("orchestrate");
    }
    derived[0]["depends_on"] = json!(["lead"]);
    let mut unknown = derived.clone();
    unknown[1]["derived_from_task"] = json!("nope");
    let (status, refused) = harness
        .plan_with(ticket_id, unknown, json!({}), vec![])
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert!(
        refused["error"]
            .as_str()
            .unwrap()
            .contains("names no advisory task of an earlier revision"),
        "{refused}"
    );
    let mut tasks = vec![advisory(
        "lead",
        "repository_lead",
        "shared",
        "advise_json",
        &[],
    )];
    tasks.extend(derived);
    let (status, opened) = harness
        .plan_with(
            ticket_id,
            tasks,
            json!({"max_attempts": 4, "timeout_seconds": 600}),
            vec![],
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{opened}");
    let second = opened["plan"].clone();
    assert_eq!(second["revision"], 2);
    assert_eq!(second["tasks"][1]["derived_from_task"], "orchestrate");
    assert_eq!(second["tasks"][0]["role"], "repository_lead");
    harness.approve(&second).await;
    let run_id = opened["run"]["id"].as_str().unwrap().to_owned();
    assert_eq!(
        harness.implement(&run_id, None).await.0,
        StatusCode::ACCEPTED
    );
    let settled = harness.settled(&run_id).await;
    assert_eq!(settled["state"], "validating", "{settled}");
    let tasks = harness.tasks(&run_id).await;
    assert_eq!(tasks.len(), 4);
    for t in &tasks {
        assert_eq!(t["state"], "completed", "{t}");
    }
    let lead = task(&tasks, "lead");
    assert_eq!(lead["role"], "repository_lead");
    assert!(lead.get("candidate_commit").is_none());
    assert!(lead["advisory_result"]["findings"].is_array());
    assert!(lead.get("derived_from_task").is_none());
    for id in REPOSITORIES {
        let t = task(&tasks, id);
        assert_eq!(t["derived_from_task"], "orchestrate", "{t}");
        assert_eq!(t["role"], "implementer");
        assert!(t["candidate_commit"].is_string());
        assert_eq!(t["assigned_by"]["plan_revision"], 2);
    }
    let events = harness.events(&run_id).await;
    let scheduled: Vec<&str> = events
        .iter()
        .filter(|e| e["type"] == "task.scheduled")
        .map(|e| e["payload"]["task_id"].as_str().unwrap())
        .collect();
    assert_eq!(scheduled, ["lead", "api", "shared", "consumer"]);
    assert!(events.iter().any(|e| e["type"] == "task.assigned"
        && e["payload"]["task_id"] == "api"
        && e["payload"]["derived_from_task"] == "orchestrate"
        && e["payload"]["role"] == "implementer"));
    // The api writer depended only on the lead: no commit binding, but the
    // lead's recorded result stated as fenced reference data.
    let fixture_args: Vec<&Value> = events
        .iter()
        .filter(|e| e["type"] == "pi.fixture_args")
        .map(|e| &e["payload"])
        .collect();
    assert_eq!(fixture_args.len(), 4);
    assert_eq!(fixture_args[0]["advisories_stated"], false);
    assert_eq!(fixture_args[1]["dependency_env"], json!({}));
    assert_eq!(fixture_args[1]["advisories_stated"], true);
    assert_eq!(fixture_args[2]["advisories_stated"], false);
    let set = &harness.candidate(&run_id).await["evidence"]["candidate"];
    assert_eq!(set["repository_commits"].as_object().unwrap().len(), 3);
    assert_eq!(
        set["dependency_bindings"],
        json!({"consumer:shared": task(&tasks, "shared")["candidate_commit"], "shared:api": task(&tasks, "api")["candidate_commit"]})
    );
    assert_eq!(fixture.snapshot(), before);
}

#[tokio::test]
async fn an_advisory_task_that_changes_files_fails_with_a_scope_reason() {
    let harness = Harness::new();
    let dir = tempfile::tempdir().unwrap();
    let fixture = Fixture::new(dir.path());
    ready(&harness, &fixture).await;
    let before = fixture.snapshot();
    let mut consumer = tasks_json(&[("consumer", "write_in_scope", &[])]);
    consumer[0]["depends_on"] = json!(["lead"]);
    let (run_id, _) = harness
        .approved_with(
            vec![
                advisory("lead", "repository_lead", "shared", "advise_writes", &[]),
                consumer[0].clone(),
            ],
            json!({"max_attempts": 2, "timeout_seconds": 600}),
            vec![],
        )
        .await;
    assert_eq!(
        harness.implement(&run_id, None).await.0,
        StatusCode::ACCEPTED
    );
    let settled = harness.settled(&run_id).await;
    assert_eq!(settled["state"], "failed", "{settled}");
    let tasks = harness.tasks(&run_id).await;
    let lead = task(&tasks, "lead");
    assert_eq!(lead["state"], "failed", "{lead}");
    let reason = lead["reason"].as_str().unwrap();
    assert!(reason.contains("scope violation"), "{reason}");
    assert!(
        reason.contains("advisory role repository_lead must leave the worktree unchanged"),
        "{reason}"
    );
    assert!(reason.contains("src/main.py"), "{reason}");
    assert!(lead.get("advisory_result").is_none(), "{lead}");
    let dependent = task(&tasks, "consumer");
    assert_eq!(dependent["state"], "blocked");
    assert!(dependent["reason"]
        .as_str()
        .unwrap()
        .contains("dependency task lead failed"));
    let attempts = harness.attempts(&run_id).await;
    assert_eq!(attempts.len(), 1);
    assert_eq!(attempts[0]["state"], "failed");
    // An advisory session that returns prose instead of the structured
    // result fails by name as well.
    let (run_id, _) = harness
        .approved_with(
            vec![advisory(
                "lead",
                "repository_lead",
                "shared",
                "advise_malformed",
                &[],
            )],
            json!({"max_attempts": 2, "timeout_seconds": 600}),
            vec![],
        )
        .await;
    assert_eq!(
        harness.implement(&run_id, None).await.0,
        StatusCode::ACCEPTED
    );
    assert_eq!(harness.settled(&run_id).await["state"], "failed");
    let reason = task(&harness.tasks(&run_id).await, "lead")["reason"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        reason.contains("advisory role repository_lead task lead returned no usable result"),
        "{reason}"
    );
    let store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    assert!(store.active_worktree_leases().unwrap().is_empty());
    assert_eq!(fixture.snapshot(), before);
}
