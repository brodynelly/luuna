//! Synthetic repositories built with the real host git; nothing here is modified by inspection.
use luuna_git::{GitError, GitInspector};
use std::{collections::BTreeMap, fs, path::Path, process::Command};

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_AUTHOR_NAME", "Fixture")
        .env("GIT_AUTHOR_EMAIL", "fixture@example.invalid")
        .env("GIT_COMMITTER_NAME", "Fixture")
        .env("GIT_COMMITTER_EMAIL", "fixture@example.invalid")
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?}");
}

/// Snapshot every byte under the directory, including `.git/index`.
fn snapshot(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                let key = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned();
                out.insert(key, fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

pub fn synthetic_repository(dir: &Path) {
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
    fs::write(dir.join("README.md"), "fixture\n").unwrap();
    fs::write(
        dir.join("Cargo.toml"),
        "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\n",
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
            "https://ci:secret-token@example.invalid/fixture.git",
        ],
    );
    fs::write(dir.join("README.md"), "fixture modified but not staged\n").unwrap();
    fs::write(dir.join("staged.txt"), "staged\n").unwrap();
    git(dir, &["add", "staged.txt"]);
    fs::write(dir.join("untracked.txt"), "untracked\n").unwrap();
}

#[tokio::test]
async fn inspects_a_dirty_synthetic_repository_without_changing_a_byte() {
    let dir = tempfile::tempdir().unwrap();
    synthetic_repository(dir.path());
    let before = snapshot(dir.path());
    let observation = GitInspector::default().inspect(dir.path()).await.unwrap();
    assert_eq!(
        snapshot(dir.path()),
        before,
        "inspection must not touch the checkout or index"
    );
    assert_eq!(observation.branch.as_deref(), Some("main"));
    assert_eq!(observation.identity.root_commits.len(), 1);
    assert!(!observation.identity.shallow);
    assert_eq!(
        observation.identity.remote.as_deref(),
        Some("https://example.invalid/fixture.git"),
        "credentials must be redacted"
    );
    assert_eq!(observation.dirty.staged, 1);
    assert_eq!(observation.dirty.unstaged, 1);
    assert_eq!(observation.dirty.untracked, 1);
    assert_eq!(observation.dirty.conflicted, 0);
    assert!(observation.dirty.paths.contains(&"README.md".to_owned()));
    assert!(observation.local_branches.contains(&"main".to_owned()));
    assert!(observation.git_version.starts_with("git version"));
    let serialized = serde_json::to_string(&observation).unwrap();
    assert!(!serialized.contains("secret-token"));
}

#[tokio::test]
async fn rejects_invalid_and_non_root_paths() {
    let inspector = GitInspector::default();
    let plain = tempfile::tempdir().unwrap();
    assert!(matches!(
        inspector.inspect(plain.path()).await,
        Err(GitError::NotRepository)
    ));
    assert!(matches!(
        inspector.inspect(Path::new("relative/path")).await,
        Err(GitError::InvalidPath)
    ));
    assert!(matches!(
        inspector.inspect(&plain.path().join("missing")).await,
        Err(GitError::InvalidPath)
    ));
    let repo = tempfile::tempdir().unwrap();
    synthetic_repository(repo.path());
    fs::create_dir(repo.path().join("nested")).unwrap();
    assert!(matches!(
        inspector.inspect(&repo.path().join("nested")).await,
        Err(GitError::NotRoot(_))
    ));
    let unborn = tempfile::tempdir().unwrap();
    git(unborn.path(), &["init", "-q"]);
    assert!(matches!(
        inspector.inspect(unborn.path()).await,
        Err(GitError::Unborn)
    ));
    let bare = tempfile::tempdir().unwrap();
    git(bare.path(), &["init", "-q", "--bare"]);
    assert!(matches!(
        inspector.inspect(bare.path()).await,
        Err(GitError::Bare)
    ));
}

#[tokio::test]
async fn repository_clean_filters_are_not_executed_and_push_urls_are_observed() {
    let dir = tempfile::tempdir().unwrap();
    synthetic_repository(dir.path());
    let marker = dir.path().join("clean-filter-ran");
    fs::write(dir.path().join(".gitattributes"), "* filter=marker\n").unwrap();
    let clean = format!("sh -c 'touch {} && cat'", marker.display());
    git(dir.path(), &["config", "filter.marker.clean", &clean]);
    git(dir.path(), &["config", "filter.marker.process", &clean]);
    git(dir.path(), &["config", "filter.marker.required", "true"]);
    git(
        dir.path(),
        &[
            "remote",
            "set-url",
            "--push",
            "origin",
            "https://push:tok@example.invalid/mirror.git",
        ],
    );
    // README.md is modified in the working tree, so status must re-hash it.
    let observation = GitInspector::default().inspect(dir.path()).await.unwrap();
    assert!(
        !marker.exists(),
        "repository clean/process filters must not run during inspection"
    );
    assert_eq!(observation.dirty.unstaged, 1);
    assert_eq!(
        observation.identity.push_remote.as_deref(),
        Some("https://example.invalid/mirror.git")
    );
    assert_eq!(
        observation.identity.remote.as_deref(),
        Some("https://example.invalid/fixture.git")
    );
}

#[tokio::test]
async fn filesystem_origins_are_not_portable_identities() {
    let upstream = tempfile::tempdir().unwrap();
    synthetic_repository(upstream.path());
    let dir = tempfile::tempdir().unwrap();
    synthetic_repository(dir.path());
    git(
        dir.path(),
        &[
            "remote",
            "set-url",
            "origin",
            &upstream.path().to_string_lossy(),
        ],
    );
    let observation = GitInspector::default().inspect(dir.path()).await.unwrap();
    assert_eq!(observation.identity.remote, None);
    assert_eq!(observation.identity.push_remote, None);
    assert_eq!(observation.identity.root_commits.len(), 1);
}

#[tokio::test]
async fn output_limit_is_enforced_while_reading() {
    let dir = tempfile::tempdir().unwrap();
    synthetic_repository(dir.path());
    let inspector = GitInspector {
        max_output_bytes: 8,
        ..GitInspector::default()
    };
    assert!(matches!(
        inspector.inspect(dir.path()).await,
        Err(GitError::Oversized)
    ));
}

#[tokio::test]
async fn repository_fsmonitor_configuration_is_not_executed() {
    let dir = tempfile::tempdir().unwrap();
    synthetic_repository(dir.path());
    let marker = dir.path().join("fsmonitor-ran");
    let hook = format!("sh -c 'touch {}'", marker.display());
    git(dir.path(), &["config", "core.fsmonitor", &hook]);
    let observation = GitInspector::default().inspect(dir.path()).await.unwrap();
    assert!(
        !marker.exists(),
        "repository config must not run commands during inspection"
    );
    assert!(!observation.dirty.is_clean());
}

/// Rewrite a tracked file with identical bytes: the size is unchanged and the
/// mtime moves, so `git status` must hash the content through its clean filter.
fn restat(path: &Path) {
    let bytes = fs::read(path).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    fs::write(path, bytes).unwrap();
}

#[tokio::test]
async fn filters_configured_only_in_a_populated_submodule_are_not_executed() {
    let dir = tempfile::tempdir().unwrap();
    let sub = dir.path().join("sub-origin");
    let sup = dir.path().join("super");
    fs::create_dir_all(&sub).unwrap();
    fs::create_dir_all(&sup).unwrap();
    git(&sub, &["init", "-q", "-b", "main"]);
    fs::write(sub.join(".gitattributes"), "*.txt filter=submodule-local\n").unwrap();
    fs::write(sub.join("data.txt"), "same size\n").unwrap();
    git(&sub, &["add", "."]);
    git(&sub, &["commit", "-q", "-m", "sub"]);
    synthetic_repository(&sup);
    git(
        &sup,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            &sub.to_string_lossy(),
            "mod",
        ],
    );
    git(&sup, &["commit", "-q", "-m", "add submodule"]);
    let marker = dir.path().join("submodule-filter-ran");
    let clean = format!("sh -c 'touch {} && cat'", marker.display());
    // Only the submodule's own configuration (.git/modules/mod/config) names it.
    git(
        &sup.join("mod"),
        &["config", "filter.submodule-local.clean", &clean],
    );
    git(
        &sup.join("mod"),
        &["config", "filter.submodule-local.required", "true"],
    );
    restat(&sup.join("mod").join("data.txt"));
    let observation = GitInspector::default().inspect(&sup).await.unwrap();
    assert!(
        !marker.exists(),
        "a submodule-local clean filter must not run during inspection"
    );
    assert!(!observation.dirty.is_clean());
}

#[tokio::test]
async fn filter_drivers_whose_names_cannot_be_overridden_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    synthetic_repository(dir.path());
    let marker = dir.path().join("equals-filter-ran");
    fs::write(dir.path().join(".gitattributes"), "* filter=a=b\n").unwrap();
    git(dir.path(), &["add", ".gitattributes"]);
    let clean = format!("sh -c 'touch {} && cat'", marker.display());
    git(dir.path(), &["config", "filter.a=b.clean", &clean]);
    restat(&dir.path().join("Cargo.toml"));
    let result = GitInspector::default().inspect(dir.path()).await;
    assert!(
        !marker.exists(),
        "a driver named with '=' must not run during inspection"
    );
    let error = result.expect_err("an un-overridable driver is refused");
    assert!(
        error.to_string().contains("a=b") && error.to_string().contains('='),
        "{error}"
    );
}

#[tokio::test]
async fn oversized_output_is_refused_promptly_rather_than_timing_out() {
    let dir = tempfile::tempdir().unwrap();
    synthetic_repository(dir.path());
    // Far more status output than a pipe buffer holds.
    for index in 0..3000 {
        fs::write(
            dir.path()
                .join(format!("untracked-generated-output-{index:05}.txt")),
            "x",
        )
        .unwrap();
    }
    let inspector = GitInspector {
        max_output_bytes: 16 * 1024,
        command_timeout: std::time::Duration::from_secs(15),
        ..GitInspector::default()
    };
    let started = std::time::Instant::now();
    let result = inspector.inspect(dir.path()).await;
    assert!(matches!(result, Err(GitError::Oversized)), "{result:?}");
    assert!(
        started.elapsed() < std::time::Duration::from_secs(10),
        "the cap must stop the child at once, took {:?}",
        started.elapsed()
    );
    assert!(GitError::Oversized.to_string().contains("too large"));
}

#[tokio::test]
async fn the_configured_origin_is_observed_not_an_instead_of_rewrite() {
    let dir = tempfile::tempdir().unwrap();
    synthetic_repository(dir.path());
    git(
        dir.path(),
        &[
            "remote",
            "set-url",
            "origin",
            "https://example.invalid/org/app.git",
        ],
    );
    // A transport rewrite is machine-local configuration, often in ~/.gitconfig.
    git(
        dir.path(),
        &[
            "config",
            "url.git@example.invalid:.insteadOf",
            "https://example.invalid/",
        ],
    );
    git(
        dir.path(),
        &[
            "config",
            "url.ssh://push.example.invalid/.pushInsteadOf",
            "https://example.invalid/",
        ],
    );
    let observation = GitInspector::default().inspect(dir.path()).await.unwrap();
    assert_eq!(
        observation.identity.remote.as_deref(),
        Some("https://example.invalid/org/app.git")
    );
    assert_eq!(observation.identity.push_remote, None);
}

#[tokio::test]
async fn same_named_tags_do_not_disguise_branch_names() {
    let dir = tempfile::tempdir().unwrap();
    synthetic_repository(dir.path());
    git(dir.path(), &["tag", "main"]);
    git(
        dir.path(),
        &["update-ref", "refs/remotes/origin/main", "HEAD"],
    );
    git(
        dir.path(),
        &["update-ref", "refs/remotes/origin/develop", "HEAD"],
    );
    git(
        dir.path(),
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        ],
    );
    git(dir.path(), &["tag", "origin/main"]);
    let inspector = GitInspector::default();
    let observation = inspector.inspect(dir.path()).await.unwrap();
    assert_eq!(observation.branch.as_deref(), Some("main"));
    assert_eq!(observation.local_branches, vec!["main".to_owned()]);
    assert_eq!(observation.remote_default_branch.as_deref(), Some("main"));
    assert!(inspector
        .has_remote_branch(dir.path(), "develop")
        .await
        .unwrap());
    assert!(!inspector
        .has_remote_branch(dir.path(), "release")
        .await
        .unwrap());
}

#[tokio::test]
async fn a_root_directory_name_ending_in_whitespace_is_inspected() {
    let parent = tempfile::tempdir().unwrap();
    let dir = parent.path().join("trailing ");
    fs::create_dir(&dir).unwrap();
    synthetic_repository(&dir);
    let observation = GitInspector::default().inspect(&dir).await.unwrap();
    assert!(
        observation.local_path.ends_with("trailing "),
        "{}",
        observation.local_path
    );
}

#[tokio::test]
async fn registration_roots_follow_head_and_observed_roots_cover_local_branches() {
    let dir = tempfile::tempdir().unwrap();
    synthetic_repository(dir.path());
    git(dir.path(), &["commit", "-q", "-am", "work"]);
    let inspector = GitInspector::default();
    let registered = inspector
        .inspect_for_registration(dir.path())
        .await
        .unwrap();
    assert_eq!(registered.identity.root_commits.len(), 1);
    // An orphan branch (gh-pages style) adds a root reachable from a local branch.
    git(dir.path(), &["checkout", "-q", "--orphan", "pages"]);
    git(dir.path(), &["commit", "-q", "-m", "pages"]);
    let on_orphan = inspector
        .inspect_for_registration(dir.path())
        .await
        .unwrap();
    assert_eq!(on_orphan.identity.root_commits.len(), 1);
    assert_ne!(
        on_orphan.identity.root_commits,
        registered.identity.root_commits
    );
    let observed = inspector.inspect(dir.path()).await.unwrap();
    assert_eq!(observed.identity.root_commits.len(), 2);
    assert!(registered
        .identity
        .root_commits
        .iter()
        .all(|root| observed.identity.root_commits.contains(root)));
    registered.identity.matches(&observed.identity).unwrap();
}

#[tokio::test]
async fn gits_reason_is_kept_when_it_refuses_a_repository() {
    let dir = tempfile::tempdir().unwrap();
    synthetic_repository(dir.path());
    // Another account must own the checkout; only possible with privileges.
    let owned = Command::new("chown")
        .args(["-R", "65534:65534"])
        .arg(dir.path())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !owned {
        eprintln!("skipping: cannot give the checkout to another account");
        return;
    }
    // A host whose Git configuration trusts every directory never refuses.
    let refused = Command::new("git")
        .arg("-C")
        .arg(dir.path())
        .args(["rev-parse", "--is-bare-repository"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stderr).contains("dubious ownership"))
        .unwrap_or(false);
    if !refused {
        eprintln!("skipping: this host's Git configuration trusts the checkout");
        return;
    }
    let error = GitInspector::default()
        .inspect(dir.path())
        .await
        .expect_err("Git refuses a repository owned by another account");
    let text = error.to_string();
    assert!(matches!(error, GitError::UnsafeOwnership(_)), "{text}");
    assert!(text.contains("safe.directory"), "{text}");
    assert!(!text.contains("not a Git repository"), "{text}");
}

#[tokio::test]
async fn submodules_that_are_not_populated_do_not_count_toward_the_bound() {
    let dir = tempfile::tempdir().unwrap();
    synthetic_repository(dir.path());
    // More recorded gitlinks than populated submodules are allowed; Git never
    // recurses into a submodule without a checkout, so none has drivers to read.
    let head = String::from_utf8(
        Command::new("git")
            .arg("-C")
            .arg(dir.path())
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    for index in 0..300 {
        git(
            dir.path(),
            &[
                "update-index",
                "--add",
                "--cacheinfo",
                &format!("160000,{},vendor/m{index:03}", head.trim()),
            ],
        );
    }
    git(dir.path(), &["commit", "-q", "-m", "record submodules"]);
    for index in 0..300 {
        // An uninitialised submodule is an empty directory.
        fs::create_dir_all(dir.path().join(format!("vendor/m{index:03}"))).unwrap();
    }
    let observation = GitInspector::default().inspect(dir.path()).await.unwrap();
    assert!(
        !observation
            .dirty
            .paths
            .iter()
            .any(|path| path.starts_with("vendor/")),
        "{:?}",
        observation.dirty
    );
}
