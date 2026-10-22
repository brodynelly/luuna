//! ADR 0022: the testing-setup prerequisite through the authenticated API with
//! the synthetic Pi fixture. A repository whose baseline shows no usable
//! testing setup blocks feature implementation and is offered a
//! `testing_setup` ticket; that ticket's approved plan is admitted without a
//! baseline, its candidate is validated with the recipes it proposes (which
//! must execute real tests) and reviewed, and the explicit handoff (merge,
//! confirm the recipes, run the baseline) is what admits feature work.
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
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/pi-rpc/mock_pi.py")
            .canonicalize()
            .unwrap();
        let root =
            std::env::temp_dir().join(format!("luuna-testing-setup-test-{}", uuid::Uuid::new_v4()));
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

    /// Start a baseline and return its settled run.
    async fn baseline(&self) -> Value {
        let (status, run) = self
            .request(
                "POST",
                "/api/v1/projects/fixture/baselines",
                Some(json!({"repository_id": "app"})),
            )
            .await;
        assert_eq!(status, StatusCode::ACCEPTED, "{run}");
        self.settled(run["id"].as_str().unwrap()).await
    }

    async fn ticket(&self, scenario: &str, purpose: Option<&str>) -> Value {
        let mut body = json!({
            "idempotency_key": format!("key-{}", uuid::Uuid::new_v4()),
            "title": "Establish the baseline",
            "intent": "Add a minimal meaningful test harness for src/main.py.",
            "acceptance_criteria": [format!("fixture:{scenario}"), "python -m unittest runs at least one real test"],
            "repository_ids": ["app"],
        });
        if let Some(purpose) = purpose {
            body["purpose"] = json!(purpose);
        }
        let (status, ticket) = self
            .request("POST", "/api/v1/projects/fixture/tickets", Some(body))
            .await;
        assert_eq!(status, StatusCode::CREATED, "{ticket}");
        ticket
    }

    async fn plan(&self, ticket_id: &str, body: Value) -> (StatusCode, Value) {
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

    /// Ticket, plan and exact approval for a feature on `src`.
    async fn approved_feature(&self, scenario: &str) -> String {
        let ticket = self.ticket(scenario, None).await;
        let (status, opened) = self
            .plan(
                ticket["id"].as_str().unwrap(),
                json!({"task": {"repository_id": "app", "paths": ["src"], "operations": ["read", "write"]}}),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{opened}");
        assert_eq!(opened["plan"].get("purpose"), None, "{opened}");
        assert_eq!(opened["plan"]["tasks"][0]["role"], "implementer");
        self.approve(&opened["plan"]).await;
        opened["run"]["id"].as_str().unwrap().to_owned()
    }

    /// Ticket, plan and exact approval for the testing-setup prerequisite.
    async fn approved_setup(&self, scenario: &str, checks: Vec<Value>) -> (String, Value) {
        let ticket = self.ticket(scenario, Some("testing_setup")).await;
        assert_eq!(ticket["purpose"], "testing_setup", "{ticket}");
        let (status, opened) = self
            .plan(
                ticket["id"].as_str().unwrap(),
                json!({
                    "task": {"repository_id": "app", "paths": ["tests"], "operations": ["read", "write"]},
                    "checks": checks,
                }),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{opened}");
        let plan = &opened["plan"];
        assert_eq!(plan["purpose"], "testing_setup", "{plan}");
        assert_eq!(plan["tasks"][0]["role"], "testing-setup");
        self.approve(plan).await;
        (
            opened["run"]["id"].as_str().unwrap().to_owned(),
            plan.clone(),
        )
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

    async fn validated(&self, run_id: &str) -> Value {
        let hash = self.candidate(run_id).await["evidence"]["candidate"]["hash"].clone();
        let (status, response) = self
            .request(
                "POST",
                &format!("/api/v1/runs/{run_id}/validate"),
                Some(json!({"candidate_hash": hash, "provider": "test", "model": "synthetic"})),
            )
            .await;
        assert_eq!(status, StatusCode::ACCEPTED, "{response}");
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

fn check(id: &str, args: Vec<&str>) -> Value {
    json!({"id": id, "executable": python(), "args": args, "required": true,
        "timeout_seconds": 60, "capabilities": ["python"], "cwd": "."})
}

/// The discovered recipe of a repository without tests: pytest-style output
/// reporting that nothing ran, with exit 0.
fn empty_suite_check() -> Value {
    check(
        "unit",
        vec![
            "-c",
            "print('collected 0 items'); print('============ no tests ran in 0.01s ============')",
        ],
    )
}

/// The recipe the setup plan proposes and the developer later confirms.
fn unittest_check() -> Value {
    check(
        "unit",
        vec!["-B", "-m", "unittest", "discover", "-s", "tests", "-v"],
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

/// A committed repository with source but no tests.
fn untested_repository(dir: &Path) {
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::write(dir.join("README.md"), "fixture without tests\n").unwrap();
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

/// Register the untested repository, confirm its discovered recipe and run
/// the baseline that shows the missing testing setup.
async fn untested_project(harness: &Harness, repo: &Path) -> Value {
    untested_repository(repo);
    let (status, view) = harness
        .request(
            "POST",
            "/api/v1/projects",
            Some(json!({"id":"fixture","name":"Fixture","repositories":[{"id":"app","path":repo.to_string_lossy()}]})),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{view}");
    harness.confirm(0, vec![empty_suite_check()]).await;
    harness.baseline().await
}

#[tokio::test]
async fn a_missing_testing_setup_blocks_features_and_the_setup_prerequisite_establishes_the_baseline(
) {
    // Acceptance A06: feature execution is blocked and a prerequisite setup
    // ticket is offered; the setup workflow then makes the baseline possible.
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    let baseline_run = untested_project(&harness, repo.path()).await;
    assert_eq!(baseline_run["state"], "failed", "{baseline_run}");
    let baseline_id = baseline_run["id"].as_str().unwrap().to_owned();

    // The offer is durable on the baseline run and in the settlement payload.
    let events = harness.events(&baseline_id).await;
    let offered = events
        .iter()
        .find(|e| e["type"] == "baseline.prerequisite_offered")
        .unwrap_or_else(|| panic!("no offer in {events:?}"));
    assert_eq!(offered["payload"]["kind"], "testing_setup");
    assert_eq!(offered["payload"]["repository_id"], "app");
    assert!(offered["payload"]["next"]
        .as_str()
        .unwrap()
        .contains("POST /api/v1/projects/fixture/tickets with purpose testing_setup"));
    let failed = events.iter().find(|e| e["type"] == "run.failed").unwrap();
    assert_eq!(failed["payload"]["baseline_status"], "blocked");
    assert_eq!(failed["payload"]["prerequisite"]["kind"], "testing_setup");
    assert!(failed["payload"]["prerequisite"]["reason"]
        .as_str()
        .unwrap()
        .contains("empty or skip-only suite"));

    // Both read views carry the offer for clients.
    let (_, baselines) = harness
        .request("GET", "/api/v1/projects/fixture/baselines", None)
        .await;
    assert_eq!(baselines[0]["status"], "blocked", "{baselines}");
    assert_eq!(baselines[0]["prerequisite"]["kind"], "testing_setup");
    let (_, project) = harness
        .request("GET", "/api/v1/projects/fixture", None)
        .await;
    assert_eq!(
        project["prerequisites"][0]["repository_id"], "app",
        "{project}"
    );
    assert_eq!(
        project["prerequisites"][0]["baseline_id"], baselines[0]["id"],
        "{project}"
    );

    // A feature plan is approved but refused with the structured offer.
    let feature = harness.approved_feature("write_in_scope").await;
    let (status, refused) = harness.implement(&feature).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert!(refused["error"]
        .as_str()
        .unwrap()
        .contains("no usable testing setup"));
    assert_eq!(refused["prerequisite"]["kind"], "testing_setup");
    assert_eq!(refused["prerequisite"]["repository_id"], "app");
    assert_eq!(harness.run(&feature).await["state"], "approved");

    // The prerequisite: a testing_setup ticket whose plan proposes the recipe.
    let (setup, plan) = harness
        .approved_setup("write_testing_setup", vec![unittest_check()])
        .await;
    assert_eq!(plan["required_checks"].as_array().unwrap().len(), 1);
    assert_eq!(plan["required_checks"][0]["id"], "unit");
    assert_eq!(plan["required_checks"][0]["args"][2], "unittest");
    let before = harness.candidate(&setup).await;
    assert_eq!(before["prerequisite"]["kind"], "testing_setup", "{before}");
    assert_eq!(before["prerequisite"]["reviewed"], false);
    assert_eq!(before["prerequisite"]["checks"][0]["id"], "unit");

    // Admitted without a baseline; every other gate still applied.
    let (status, run) = harness.implement(&setup).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{run}");
    assert_eq!(harness.settled(&setup).await["state"], "validating");
    let implementing = harness
        .events(&setup)
        .await
        .into_iter()
        .find(|e| e["type"] == "run.implementing")
        .unwrap();
    assert_eq!(implementing["payload"]["prerequisite"], "testing_setup");
    assert_eq!(implementing["payload"]["baselines"], json!({}));
    // The writer received the role contract and the recipes it must satisfy.
    let fixture = harness
        .events(&setup)
        .await
        .into_iter()
        .find(|e| e["type"] == "pi.fixture_args")
        .unwrap();
    assert_eq!(
        fixture["payload"]["role_contract_stated"], true,
        "{fixture}"
    );
    assert_eq!(fixture["payload"]["recipes_stated"], true, "{fixture}");

    // The candidate is validated with the proposed recipe, which executed a
    // real unittest case, and reviewed.
    let reviewed = harness.validated(&setup).await;
    assert_eq!(reviewed["evidence"]["status"], "reviewed", "{reviewed}");
    assert_eq!(reviewed["evidence"]["review"]["verdict"], "passed");
    let result = &reviewed["evidence"]["results"][0];
    assert_eq!(result["recipe_id"], "unit");
    assert_eq!(result["status"], "passed");
    assert_eq!(result["tests_detected"], 1, "{result}");
    assert_eq!(result["command"][2], "-m");
    assert_eq!(reviewed["prerequisite"]["reviewed"], true);
    let next = reviewed["prerequisite"]["next"].as_str().unwrap();
    assert!(
        next.contains("PUT /api/v1/projects/fixture/manifest"),
        "{next}"
    );
    assert!(
        next.contains("POST /api/v1/projects/fixture/baselines"),
        "{next}"
    );
    let commit = reviewed["prerequisite"]["candidate_commit"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        reviewed["evidence"]["candidate"]["repository_commits"]["app"],
        commit
    );
    // The developer checkout is untouched: still no tests, still the base.
    assert!(!repo.path().join("tests").exists());

    // A feature plan is still refused: the setup candidate is not a baseline.
    let (status, refused) = harness.implement(&feature).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["prerequisite"]["kind"], "testing_setup");

    // The explicit handoff: the developer merges the reviewed candidate,
    // confirms the recipe and runs a normal baseline on the checkout.
    git(repo.path(), &["merge", "--ff-only", &commit]);
    assert!(repo.path().join("tests/test_main.py").is_file());
    harness.confirm(1, vec![unittest_check()]).await;
    let established = harness.baseline().await;
    assert_eq!(established["state"], "completed", "{established}");
    let (_, project) = harness
        .request("GET", "/api/v1/projects/fixture", None)
        .await;
    assert_eq!(project["prerequisites"], json!([]), "{project}");

    // The earlier feature plan is bound to the old manifest; a new one is admitted.
    let (status, refused) = harness.implement(&feature).await;
    assert_ne!(status, StatusCode::ACCEPTED, "{refused}");
    assert!(refused.get("prerequisite").is_none(), "{refused}");
    let feature = harness.approved_feature("write_in_scope").await;
    let (status, run) = harness.implement(&feature).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{run}");
    assert_eq!(harness.settled(&feature).await["state"], "validating");
    let implementing = harness
        .events(&feature)
        .await
        .into_iter()
        .find(|e| e["type"] == "run.implementing")
        .unwrap();
    assert!(implementing["payload"]["prerequisite"].is_null());
    assert!(
        implementing["payload"]["baselines"]["app"].is_string(),
        "{implementing}"
    );
    let fixture = harness
        .events(&feature)
        .await
        .into_iter()
        .find(|e| e["type"] == "pi.fixture_args")
        .unwrap();
    assert_eq!(
        fixture["payload"]["role_contract_stated"], false,
        "{fixture}"
    );
}

#[tokio::test]
async fn a_setup_candidate_whose_checks_execute_no_test_cannot_pass() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    untested_project(&harness, repo.path()).await;

    // Skip-only harness: the executor blocks the empty suite.
    let (setup, _) = harness
        .approved_setup("write_testing_setup_without_tests", vec![unittest_check()])
        .await;
    let (status, run) = harness.implement(&setup).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{run}");
    assert_eq!(harness.settled(&setup).await["state"], "validating");
    let settled = harness.validated(&setup).await;
    assert_eq!(
        settled["evidence"]["status"], "testing_blocked",
        "{settled}"
    );
    assert_eq!(settled["evidence"]["results"][0]["status"], "blocked");
    assert_eq!(settled["evidence"]["results"][0]["tests_detected"], 0);
    assert!(settled["evidence"]["review"].is_null());
    assert_eq!(settled["prerequisite"]["reviewed"], false);

    // A recipe that exits 0 without any recognised runner summary: not a
    // testing setup either, by the purpose-specific rule.
    let (setup, _) = harness
        .approved_setup(
            "write_testing_setup",
            vec![check("smoke", vec!["-c", "print('ok')"])],
        )
        .await;
    let (status, run) = harness.implement(&setup).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{run}");
    assert_eq!(harness.settled(&setup).await["state"], "validating");
    let settled = harness.validated(&setup).await;
    assert_eq!(
        settled["evidence"]["status"], "testing_blocked",
        "{settled}"
    );
    assert_eq!(settled["evidence"]["results"][0]["status"], "passed");
    assert!(settled["evidence"]["results"][0]["tests_detected"].is_null());
    assert!(settled["evidence"]["reason"]
        .as_str()
        .unwrap()
        .contains("executed no recognised test"));
}

#[tokio::test]
async fn only_a_testing_setup_plan_proposes_recipes_or_skips_the_baseline() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    untested_project(&harness, repo.path()).await;

    // A feature plan cannot carry recipes of its own.
    let ticket = harness.ticket("write_in_scope", None).await;
    let (status, refused) = harness
        .plan(
            ticket["id"].as_str().unwrap(),
            json!({
                "task": {"repository_id": "app", "paths": ["src"], "operations": ["read", "write"]},
                "checks": [unittest_check()],
            }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert!(refused["error"]
        .as_str()
        .unwrap()
        .contains("only on a testing_setup plan"));

    // A setup plan is one task on one repository with validated recipes.
    let setup = harness
        .ticket("write_testing_setup", Some("testing_setup"))
        .await;
    let (status, refused) = harness
        .plan(
            setup["id"].as_str().unwrap(),
            json!({
                "task": {"repository_id": "app", "paths": ["tests"], "operations": ["read", "write"]},
                "checks": [{"id": "unit", "executable": "/usr/bin/python3", "args": [], "timeout_seconds": 60}],
            }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert!(refused["error"]
        .as_str()
        .unwrap()
        .contains("invalid check recipe"));
    let (status, refused) = harness
        .plan(
            setup["id"].as_str().unwrap(),
            json!({
                "tasks": [
                    {"id": "a", "repository_id": "app", "paths": ["tests"], "operations": ["read", "write"]},
                    {"id": "b", "repository_id": "app", "paths": ["src"], "operations": ["read"], "depends_on": ["a"]}
                ],
                "checks": [unittest_check()],
            }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert!(refused["error"]
        .as_str()
        .unwrap()
        .contains("exactly one task"));

    // Without recipes of its own, a setup plan takes the manifest's required
    // recipes (here the discovered empty-suite one), and its purpose shows.
    let (status, opened) = harness
        .plan(
            setup["id"].as_str().unwrap(),
            json!({"task": {"repository_id": "app", "paths": ["tests"], "operations": ["read", "write"]}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{opened}");
    assert_eq!(opened["plan"]["purpose"], "testing_setup");
    assert_eq!(opened["plan"]["required_checks"][0]["args"][0], "-c");

    // The same request keyed twice replays; a different recipe set is a new identity.
    let (status, first) = harness
        .plan(
            setup["id"].as_str().unwrap(),
            json!({
                "task": {"repository_id": "app", "paths": ["tests"], "operations": ["read", "write"]},
                "checks": [unittest_check()], "idempotency_key": "setup-plan",
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    let (status, replay) = harness
        .plan(
            setup["id"].as_str().unwrap(),
            json!({
                "task": {"repository_id": "app", "paths": ["tests"], "operations": ["read", "write"]},
                "checks": [unittest_check()], "idempotency_key": "setup-plan",
            }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay["plan"]["hash"], first["plan"]["hash"]);
    let (status, conflict) = harness
        .plan(
            setup["id"].as_str().unwrap(),
            json!({
                "task": {"repository_id": "app", "paths": ["tests"], "operations": ["read", "write"]},
                "checks": [check("unit", vec!["-m", "pytest"])], "idempotency_key": "setup-plan",
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{conflict}");

    // A feature workflow never uses the no-baseline admission: the purpose is
    // part of the approved hash, and an approved feature plan with no
    // baseline at all keeps the ordinary baseline refusal.
    let feature = harness.approved_feature("write_in_scope").await;
    let (status, refused) = harness.implement(&feature).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["prerequisite"]["kind"], "testing_setup");
    assert_eq!(harness.run(&feature).await["state"], "approved");
}
