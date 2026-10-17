//! Stack and check-recipe discovery for registered repositories.
//!
//! Discovery reads a bounded set of well-known manifest files and proposes
//! recipes with file-level evidence and uncertainty markers. It never executes
//! repository text: a `package.json` script becomes a proposed `npm run …`
//! recipe that the developer confirms, and the M2b executor later runs under
//! runtime policy. Imported text cannot widen scope or request secrets.
use luuna_domain::{
    Confidence, Discovery, DiscoveryQuestion, ExecutionProfile, ManifestCheck, ProjectManifest,
    ProjectPolicy, ProposedCheck, RepositoryDiscovery, RepositoryManifest, RepositoryObservation,
    SCHEMA_VERSION,
};
use std::path::{Path, PathBuf};
use thiserror::Error;

pub const MAX_MANIFEST_FILE_BYTES: u64 = 1024 * 1024;
const EVIDENCE_EXCERPT_CHARS: usize = 160;

#[derive(Debug, Error)]
pub enum DiscoveryError {
    #[error("repository root is not a readable directory: {0}")]
    Unreadable(String),
    #[error("{0}")]
    Domain(#[from] luuna_domain::DomainError),
}

pub struct RepositoryInput {
    pub repository_id: String,
    pub root: PathBuf,
    pub observation: RepositoryObservation,
}

pub struct DiscoveryRequest {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    /// Revision the confirmed manifest would carry (current revision + 1).
    pub manifest_revision: u64,
    pub created_at: String,
    pub repositories: Vec<RepositoryInput>,
}

/// A proposed command: executable plus argument array, never shell text.
struct Recipe<'a> {
    id: &'a str,
    executable: &'a str,
    args: &'a [&'a str],
    required: bool,
    timeout_seconds: u64,
    capabilities: &'a [&'a str],
}

struct Facts {
    profiles: Vec<String>,
    evidence: Vec<String>,
    checks: Vec<ProposedCheck>,
    questions: Vec<DiscoveryQuestion>,
}

impl Facts {
    fn question(&mut self, repository_id: &str, topic: &str, detail: impl Into<String>) {
        self.questions.push(DiscoveryQuestion {
            repository_id: Some(repository_id.into()),
            topic: topic.into(),
            detail: detail.into(),
        });
    }
    fn profile(&mut self, name: &str, evidence: impl Into<String>) {
        if !self.profiles.iter().any(|p| p == name) {
            self.profiles.push(name.into());
        }
        self.evidence.push(evidence.into());
    }
    fn check(&mut self, recipe: Recipe<'_>, evidence: Vec<String>, confidence: Confidence) {
        if self.checks.iter().any(|c| c.check.id == recipe.id) {
            return;
        }
        self.checks.push(ProposedCheck {
            check: ManifestCheck {
                id: recipe.id.into(),
                executable: recipe.executable.into(),
                args: recipe.args.iter().map(|a| (*a).to_owned()).collect(),
                required: recipe.required,
                timeout_seconds: recipe.timeout_seconds,
                capabilities: recipe
                    .capabilities
                    .iter()
                    .map(|c| (*c).to_owned())
                    .collect(),
                cwd: ".".into(),
            },
            evidence,
            confidence,
        });
    }
}

/// Produce a proposal for every registered repository. Read-only.
pub fn discover(request: DiscoveryRequest) -> Result<Discovery, DiscoveryError> {
    let mut repositories = Vec::new();
    let mut questions = Vec::new();
    let mut manifests = Vec::new();
    for input in request.repositories {
        let id = input.repository_id;
        if !input.root.is_dir() {
            return Err(DiscoveryError::Unreadable(input.root.display().to_string()));
        }
        let mut facts = inspect_stack(&input.root, &id);
        let observation = input.observation;
        if !observation.dirty.is_clean() {
            facts.question(
                &id,
                "dirty-checkout",
                format!(
                    "{} staged, {} unstaged, {} untracked and {} conflicted paths are present; Luuna preserves them and later works from task worktrees based on explicit commits",
                    observation.dirty.staged,
                    observation.dirty.unstaged,
                    observation.dirty.untracked,
                    observation.dirty.conflicted
                ),
            );
        }
        let remote = match &observation.identity.remote {
            Some(remote) => remote.clone(),
            None => {
                facts.question(
                    &id,
                    "remote",
                    "no origin remote is configured; confirm an explicit local: identity or add a remote before publication work",
                );
                format!("local:{id}")
            }
        };
        let default_branch = propose_default_branch(&observation, &id, &mut facts);
        if facts.profiles.is_empty() {
            facts.question(
                &id,
                "stack",
                "no supported stack manifest was recognised; supply the profile and check recipes manually",
            );
            facts.profiles.push("unrecognized".into());
        }
        if !facts.checks.iter().any(|c| c.check.required) {
            facts.question(
                &id,
                "checks",
                "no required check recipe could be proposed; feature work stays blocked until a usable testing setup is confirmed (M2b prerequisite)",
            );
        }
        manifests.push(RepositoryManifest {
            id: id.clone(),
            remote,
            default_branch,
            profiles: facts.profiles.clone(),
            execution: ExecutionProfile::Native,
            checks: facts.checks.iter().map(|c| c.check.clone()).collect(),
        });
        questions.append(&mut facts.questions);
        repositories.push(RepositoryDiscovery {
            repository_id: id,
            observation,
            profiles: facts.profiles,
            evidence: facts.evidence,
            proposed_checks: facts.checks,
        });
    }
    let proposed_manifest = ProjectManifest {
        schema_version: SCHEMA_VERSION.into(),
        id: request.project_id.clone(),
        name: request.project_name,
        revision: request.manifest_revision,
        repositories: manifests,
        relationships: Vec::new(),
        policy: ProjectPolicy::v1(1, 1, 2),
    };
    let manifest_problems = match proposed_manifest.validate() {
        Ok(()) => Vec::new(),
        Err(error) => vec![error.to_string()],
    };
    Ok(Discovery {
        schema_version: SCHEMA_VERSION.into(),
        id: request.id,
        project_id: request.project_id,
        created_at: request.created_at,
        repositories,
        proposed_manifest,
        manifest_problems,
        questions,
    })
}

fn propose_default_branch(
    observation: &RepositoryObservation,
    id: &str,
    facts: &mut Facts,
) -> String {
    if let Some(branch) = &observation.remote_default_branch {
        facts
            .evidence
            .push(format!("{id}:refs/remotes/origin/HEAD -> {branch}"));
        return branch.clone();
    }
    if let Some(branch) = &observation.branch {
        facts.evidence.push(format!("{id}:HEAD -> {branch}"));
        return branch.clone();
    }
    for candidate in ["main", "master", "trunk", "develop"] {
        if observation.local_branches.iter().any(|b| b == candidate) {
            facts.question(
                id,
                "default-branch",
                format!("HEAD is detached; `{candidate}` was assumed from local branches"),
            );
            return candidate.to_owned();
        }
    }
    let fallback = observation
        .local_branches
        .first()
        .cloned()
        .unwrap_or_else(|| "main".into());
    facts.question(
        id,
        "default-branch",
        format!(
            "HEAD is detached and no conventional branch exists; `{fallback}` is a placeholder"
        ),
    );
    fallback
}

fn read_bounded(root: &Path, name: &str) -> Option<String> {
    let path = root.join(name);
    let metadata = std::fs::metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_MANIFEST_FILE_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

fn exists(root: &Path, name: &str) -> bool {
    root.join(name).exists()
}

fn excerpt(value: &str) -> String {
    let mut text: String = value.chars().take(EVIDENCE_EXCERPT_CHARS).collect();
    if value.chars().count() > EVIDENCE_EXCERPT_CHARS {
        text.push('…');
    }
    text
}

fn inspect_stack(root: &Path, id: &str) -> Facts {
    let mut facts = Facts {
        profiles: Vec::new(),
        evidence: Vec::new(),
        checks: Vec::new(),
        questions: Vec::new(),
    };
    rust(root, id, &mut facts);
    node(root, id, &mut facts);
    go(root, id, &mut facts);
    python(root, id, &mut facts);
    dart(root, id, &mut facts);
    android(root, id, &mut facts);
    ios(root, id, &mut facts);
    facts
}

fn rust(root: &Path, id: &str, facts: &mut Facts) {
    let Some(cargo) = read_bounded(root, "Cargo.toml") else {
        return;
    };
    facts.profile("rust", format!("{id}:Cargo.toml"));
    let workspace = cargo.contains("[workspace]");
    if workspace {
        facts.evidence.push(format!("{id}:Cargo.toml#[workspace]"));
    }
    let locked = exists(root, "Cargo.lock");
    let mut args = vec!["test"];
    if locked {
        args.push("--locked");
        facts.evidence.push(format!("{id}:Cargo.lock"));
    } else {
        facts.question(
            id,
            "rust-lockfile",
            "Cargo.lock is absent, so the proposed cargo recipes cannot pin dependencies",
        );
    }
    if workspace {
        args.push("--workspace");
    }
    facts.check(
        Recipe {
            id: "cargo-test",
            executable: "cargo",
            args: &args,
            required: true,
            timeout_seconds: 1800,
            capabilities: &["rust", "cargo"],
        },
        vec![format!("{id}:Cargo.toml")],
        Confidence::Observed,
    );
    let mut clippy = vec!["clippy"];
    if locked {
        clippy.push("--locked");
    }
    if workspace {
        clippy.push("--workspace");
    }
    clippy.extend(["--all-targets", "--", "-D", "warnings"]);
    facts.check(
        Recipe {
            id: "cargo-clippy",
            executable: "cargo",
            args: &clippy,
            required: false,
            timeout_seconds: 1800,
            capabilities: &["rust", "cargo", "clippy"],
        },
        vec![format!("{id}:Cargo.toml")],
        Confidence::Inferred,
    );
}

fn node(root: &Path, id: &str, facts: &mut Facts) {
    let Some(raw) = read_bounded(root, "package.json") else {
        return;
    };
    facts.profile("node", format!("{id}:package.json"));
    let package: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => {
            facts.question(id, "node-manifest", "package.json is not valid JSON");
            return;
        }
    };
    let manager = if exists(root, "bun.lock") || exists(root, "bun.lockb") {
        facts.evidence.push(format!("{id}:bun.lock"));
        "bun"
    } else if exists(root, "pnpm-lock.yaml") {
        facts.evidence.push(format!("{id}:pnpm-lock.yaml"));
        "pnpm"
    } else if exists(root, "yarn.lock") {
        facts.evidence.push(format!("{id}:yarn.lock"));
        "yarn"
    } else if exists(root, "package-lock.json") {
        facts.evidence.push(format!("{id}:package-lock.json"));
        "npm"
    } else {
        facts.question(
            id,
            "node-lockfile",
            "no package manager lockfile was found; npm was assumed",
        );
        "npm"
    };
    if let Some(declared) = package["packageManager"].as_str() {
        facts.evidence.push(format!(
            "{id}:package.json#packageManager = {}",
            excerpt(declared)
        ));
    }
    if exists(root, "tsconfig.json") {
        facts.profile("typescript", format!("{id}:tsconfig.json"));
    }
    let dependencies = ["dependencies", "devDependencies"]
        .iter()
        .filter_map(|key| package[key].as_object())
        .flat_map(|map| map.keys().cloned())
        .collect::<Vec<_>>();
    if dependencies.iter().any(|d| d == "next") {
        facts.profile("nextjs", format!("{id}:package.json#dependencies.next"));
    } else if dependencies.iter().any(|d| d == "react") {
        facts.profile("react", format!("{id}:package.json#dependencies.react"));
    }
    if package["workspaces"].is_array() || package["workspaces"].is_object() {
        facts.evidence.push(format!("{id}:package.json#workspaces"));
    }
    let scripts = package["scripts"].as_object();
    let script = |name: &str| -> Option<String> {
        scripts
            .and_then(|s| s.get(name))
            .and_then(|v| v.as_str())
            .filter(|body| !body.trim().is_empty() && !body.contains("no test specified"))
            .map(ToOwned::to_owned)
    };
    let run = |name: &str| -> Vec<String> {
        if name == "test" && manager != "bun" {
            vec!["test".into()]
        } else {
            vec!["run".into(), name.into()]
        }
    };
    for (name, required, capabilities) in [
        ("test", true, "test"),
        ("typecheck", false, "typecheck"),
        ("lint", false, "lint"),
        ("build", false, "build"),
    ] {
        if let Some(body) = script(name) {
            let args = run(name);
            let args: Vec<&str> = args.iter().map(String::as_str).collect();
            facts.check(
                Recipe {
                    id: &format!("{manager}-{name}"),
                    executable: manager,
                    args: &args,
                    required,
                    timeout_seconds: 900,
                    capabilities: &["node", manager, capabilities],
                },
                vec![format!(
                    "{id}:package.json#scripts.{name} = {}",
                    excerpt(&body)
                )],
                Confidence::Observed,
            );
        }
    }
    if script("test").is_none() {
        facts.question(
            id,
            "node-tests",
            "package.json declares no usable test script; a testing prerequisite task will be required before feature work",
        );
    }
}

fn go(root: &Path, id: &str, facts: &mut Facts) {
    if read_bounded(root, "go.mod").is_none() {
        return;
    }
    facts.profile("go", format!("{id}:go.mod"));
    facts.check(
        Recipe {
            id: "go-test",
            executable: "go",
            args: &["test", "./..."],
            required: true,
            timeout_seconds: 1800,
            capabilities: &["go"],
        },
        vec![format!("{id}:go.mod")],
        Confidence::Inferred,
    );
    facts.check(
        Recipe {
            id: "go-vet",
            executable: "go",
            args: &["vet", "./..."],
            required: false,
            timeout_seconds: 900,
            capabilities: &["go"],
        },
        vec![format!("{id}:go.mod")],
        Confidence::Inferred,
    );
}

fn python(root: &Path, id: &str, facts: &mut Facts) {
    let pyproject = read_bounded(root, "pyproject.toml");
    let setup = exists(root, "setup.py") || exists(root, "setup.cfg");
    let requirements = exists(root, "requirements.txt");
    if pyproject.is_none() && !setup && !requirements {
        return;
    }
    let marker = if pyproject.is_some() {
        "pyproject.toml"
    } else if setup {
        "setup.py"
    } else {
        "requirements.txt"
    };
    facts.profile("python", format!("{id}:{marker}"));
    let pytest_configured = pyproject
        .as_deref()
        .is_some_and(|p| p.contains("[tool.pytest") || p.contains("pytest"))
        || exists(root, "pytest.ini")
        || exists(root, "conftest.py")
        || exists(root, "tests");
    if pytest_configured {
        facts.check(
            Recipe {
                id: "pytest",
                executable: "pytest",
                args: &["-q"],
                required: true,
                timeout_seconds: 1800,
                capabilities: &["python", "pytest"],
            },
            vec![format!("{id}:{marker}")],
            Confidence::Inferred,
        );
    } else {
        facts.question(
            id,
            "python-tests",
            "no pytest configuration or tests directory was found; confirm the test runner",
        );
    }
    if exists(root, "uv.lock") {
        facts.evidence.push(format!("{id}:uv.lock"));
    }
}

fn dart(root: &Path, id: &str, facts: &mut Facts) {
    let Some(pubspec) = read_bounded(root, "pubspec.yaml") else {
        return;
    };
    if pubspec.contains("flutter") {
        facts.profile("flutter", format!("{id}:pubspec.yaml#flutter"));
        facts.check(
            Recipe {
                id: "flutter-test",
                executable: "flutter",
                args: &["test"],
                required: true,
                timeout_seconds: 1800,
                capabilities: &["flutter"],
            },
            vec![format!("{id}:pubspec.yaml")],
            Confidence::Inferred,
        );
        facts.check(
            Recipe {
                id: "flutter-analyze",
                executable: "flutter",
                args: &["analyze"],
                required: false,
                timeout_seconds: 900,
                capabilities: &["flutter"],
            },
            vec![format!("{id}:pubspec.yaml")],
            Confidence::Inferred,
        );
    } else {
        facts.profile("dart", format!("{id}:pubspec.yaml"));
        facts.check(
            Recipe {
                id: "dart-test",
                executable: "dart",
                args: &["test"],
                required: true,
                timeout_seconds: 1800,
                capabilities: &["dart"],
            },
            vec![format!("{id}:pubspec.yaml")],
            Confidence::Inferred,
        );
    }
}

fn android(root: &Path, id: &str, facts: &mut Facts) {
    let wrapper = exists(root, "gradlew");
    let gradle = wrapper
        || exists(root, "build.gradle")
        || exists(root, "build.gradle.kts")
        || exists(root, "settings.gradle")
        || exists(root, "settings.gradle.kts");
    if !gradle {
        return;
    }
    facts.profile("android", format!("{id}:gradle"));
    if wrapper {
        facts.check(
            Recipe {
                id: "gradle-test",
                executable: "./gradlew",
                args: &["test"],
                required: true,
                timeout_seconds: 3600,
                capabilities: &["jdk", "android-sdk"],
            },
            vec![format!("{id}:gradlew")],
            Confidence::Inferred,
        );
        facts.question(
            id,
            "android-host",
            "Gradle tests need a JDK and Android SDK on the execution host; Windows hosts use gradlew.bat",
        );
    } else {
        facts.question(
            id,
            "android-wrapper",
            "Gradle build files exist without a wrapper; supply the gradle executable and recipe",
        );
    }
}

fn ios(root: &Path, id: &str, facts: &mut Facts) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let projects: Vec<String> = entries
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.ends_with(".xcodeproj") || name.ends_with(".xcworkspace"))
        .take(8)
        .collect();
    if projects.is_empty() {
        return;
    }
    for project in &projects {
        facts.profile("ios", format!("{id}:{project}"));
    }
    facts.question(
        id,
        "ios-scheme",
        "xcodebuild requires an explicit scheme, destination and a capable Mac; no recipe was proposed",
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use luuna_domain::{DirtyState, RepositoryIdentity};
    use std::fs;

    fn observation(
        path: &Path,
        branch: Option<&str>,
        remote: Option<&str>,
    ) -> RepositoryObservation {
        RepositoryObservation {
            local_path: path.display().to_string(),
            identity: RepositoryIdentity {
                remote: remote.map(Into::into),
                root_commits: vec!["c".repeat(40)],
                shallow: false,
            },
            head_commit: "d".repeat(40),
            branch: branch.map(Into::into),
            remote_default_branch: None,
            local_branches: vec!["main".into()],
            dirty: DirtyState::default(),
            git_version: "git version 2.43.0".into(),
            observed_at: "2026-10-17T00:00:00.000Z".into(),
        }
    }
    fn request(root: &Path, observation: RepositoryObservation) -> DiscoveryRequest {
        DiscoveryRequest {
            id: "discovery-1".into(),
            project_id: "fixture".into(),
            project_name: "Fixture".into(),
            manifest_revision: 1,
            created_at: "2026-10-17T00:00:00.000Z".into(),
            repositories: vec![RepositoryInput {
                repository_id: "app".into(),
                root: root.to_path_buf(),
                observation,
            }],
        }
    }

    #[test]
    fn node_scripts_are_proposed_as_recipes_with_evidence_not_executed() {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("executed");
        fs::write(
            dir.path().join("package.json"),
            format!(
                r#"{{"name":"x","scripts":{{"test":"touch {} && vitest run","typecheck":"tsc --noEmit"}},"devDependencies":{{"react":"19.0.0"}}}}"#,
                marker.display()
            ),
        )
        .unwrap();
        fs::write(dir.path().join("package-lock.json"), "{}").unwrap();
        fs::write(dir.path().join("tsconfig.json"), "{}").unwrap();
        let discovery = discover(request(
            dir.path(),
            observation(
                dir.path(),
                Some("main"),
                Some("https://example.invalid/x.git"),
            ),
        ))
        .unwrap();
        assert!(!marker.exists(), "discovery must never run repository text");
        let repo = &discovery.repositories[0];
        assert_eq!(repo.profiles, vec!["node", "typescript", "react"]);
        let test = repo
            .proposed_checks
            .iter()
            .find(|c| c.check.id == "npm-test")
            .unwrap();
        assert_eq!(test.check.executable, "npm");
        assert_eq!(test.check.args, vec!["test"]);
        assert!(test.check.required);
        assert_eq!(test.confidence, Confidence::Observed);
        assert!(test.evidence[0].contains("scripts.test = touch"));
        let typecheck = repo
            .proposed_checks
            .iter()
            .find(|c| c.check.id == "npm-typecheck")
            .unwrap();
        assert_eq!(typecheck.check.args, vec!["run", "typecheck"]);
        assert!(!typecheck.check.required);
        assert!(
            discovery.manifest_problems.is_empty(),
            "{:?}",
            discovery.manifest_problems
        );
        assert_eq!(
            discovery.proposed_manifest.repositories[0].remote,
            "https://example.invalid/x.git"
        );
        assert_eq!(
            discovery.proposed_manifest.repositories[0].default_branch,
            "main"
        );
        assert!(discovery.questions.is_empty(), "{:?}", discovery.questions);
    }

    #[test]
    fn unknown_stacks_and_missing_facts_become_questions_and_an_invalid_proposal() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "nothing to discover").unwrap();
        let mut detached = observation(dir.path(), None, None);
        detached.dirty.untracked = 1;
        detached.dirty.paths.push("notes.txt".into());
        let discovery = discover(request(dir.path(), detached)).unwrap();
        let topics: Vec<&str> = discovery
            .questions
            .iter()
            .map(|q| q.topic.as_str())
            .collect();
        for topic in [
            "dirty-checkout",
            "remote",
            "default-branch",
            "stack",
            "checks",
        ] {
            assert!(topics.contains(&topic), "{topics:?}");
        }
        assert_eq!(
            discovery.proposed_manifest.repositories[0].remote,
            "local:app"
        );
        assert_eq!(
            discovery.proposed_manifest.repositories[0].profiles,
            vec!["unrecognized"]
        );
        assert!(!discovery.manifest_problems.is_empty());
    }

    #[test]
    fn rust_workspace_with_lockfile_is_pinned_and_bun_uses_run() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Cargo.toml"), "[workspace]\nmembers=[]\n").unwrap();
        fs::write(dir.path().join("Cargo.lock"), "").unwrap();
        fs::write(
            dir.path().join("package.json"),
            r#"{"scripts":{"test":"bun test"}}"#,
        )
        .unwrap();
        fs::write(dir.path().join("bun.lock"), "").unwrap();
        let discovery = discover(request(
            dir.path(),
            observation(dir.path(), Some("main"), None),
        ))
        .unwrap();
        let checks = &discovery.repositories[0].proposed_checks;
        let cargo = checks.iter().find(|c| c.check.id == "cargo-test").unwrap();
        assert_eq!(cargo.check.args, vec!["test", "--locked", "--workspace"]);
        let bun = checks.iter().find(|c| c.check.id == "bun-test").unwrap();
        assert_eq!(bun.check.args, vec!["run", "test"]);
        assert_eq!(discovery.repositories[0].profiles, vec!["rust", "node"]);
    }
}
