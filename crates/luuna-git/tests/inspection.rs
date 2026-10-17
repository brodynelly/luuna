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
