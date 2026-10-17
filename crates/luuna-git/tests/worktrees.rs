//! Luuna-owned worktrees on a synthetic repository; the checkout's files stay untouched.
use luuna_git::GitInspector;
use std::{collections::BTreeMap, fs, path::Path, process::Command};

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
    assert!(output.status.success(), "git {args:?}");
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

/// Every file except git's own worktree bookkeeping, which `worktree add` must write.
fn snapshot(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let key = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if key == ".git/worktrees" {
                continue;
            }
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                out.insert(key, fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

fn repository(dir: &Path) -> String {
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::write(dir.join("README.md"), "fixture\n").unwrap();
    fs::write(dir.join("src/main.py"), "print('fixture')\n").unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "initial"]);
    git(dir, &["rev-parse", "HEAD"])
}

#[tokio::test]
async fn detached_worktree_reports_changes_and_commits_without_touching_the_checkout() {
    let developer = tempfile::tempdir().unwrap();
    let private = tempfile::tempdir().unwrap();
    let base = repository(developer.path());
    fs::write(
        developer.path().join("scratch.txt"),
        "developer work in progress\n",
    )
    .unwrap();
    let before = snapshot(developer.path());
    let inspector = GitInspector::default();
    let worktree = private.path().join("worktrees").join("run-1").join("app");

    inspector
        .add_detached_worktree(developer.path(), &worktree, &base)
        .await
        .unwrap();
    assert_eq!(inspector.head_commit(&worktree).await.unwrap(), base);
    assert!(
        !worktree.join("scratch.txt").exists(),
        "uncommitted developer files are not copied"
    );
    assert!(inspector.changed_paths(&worktree).await.unwrap().is_empty());
    assert!(inspector
        .add_detached_worktree(developer.path(), &worktree, &base)
        .await
        .is_err());

    fs::write(worktree.join("src/main.py"), "print('changed')\n").unwrap();
    fs::create_dir_all(worktree.join("src/new dir")).unwrap();
    fs::write(worktree.join("src/new dir/file.py"), "x = 1\n").unwrap();
    let mut changed = inspector.changed_paths(&worktree).await.unwrap();
    changed.sort_by(|a, b| a.path.cmp(&b.path));
    assert_eq!(
        changed
            .iter()
            .map(|c| (c.status.as_str(), c.path.as_str()))
            .collect::<Vec<_>>(),
        vec![("M", "src/main.py"), ("?", "src/new dir/file.py")]
    );

    let candidate = inspector
        .commit_all(&worktree, "Luuna candidate")
        .await
        .unwrap();
    assert_ne!(candidate, base);
    assert_eq!(inspector.head_commit(&worktree).await.unwrap(), candidate);
    assert!(inspector.changed_paths(&worktree).await.unwrap().is_empty());
    assert!(inspector.commit_all(&worktree, "nothing").await.is_err());
    let author = git(&worktree, &["log", "-1", "--format=%an <%ae>"]);
    assert_eq!(author, "Luuna Writer <writer@luuna.invalid>");

    // The developer checkout: every pre-existing file (including `.git/index`,
    // refs and logs) is byte-identical, same HEAD and branch. The shared object
    // store gains the candidate's objects, which is how worktrees work.
    let after = snapshot(developer.path());
    for (path, bytes) in &before {
        assert_eq!(after.get(path), Some(bytes), "{path} changed");
    }
    let added: Vec<&String> = after.keys().filter(|k| !before.contains_key(*k)).collect();
    assert!(
        added.iter().all(|k| k.starts_with(".git/objects/")),
        "unexpected new files in the developer checkout: {added:?}"
    );
    assert_eq!(git(developer.path(), &["rev-parse", "HEAD"]), base);
    assert_eq!(git(developer.path(), &["branch", "--show-current"]), "main");
    assert!(developer.path().join("scratch.txt").exists());

    inspector
        .remove_worktree(developer.path(), &worktree)
        .await
        .unwrap();
    assert!(!worktree.exists());
}

#[tokio::test]
async fn managed_operations_never_execute_configured_content_filters() {
    for process in [false, true] {
        let developer = tempfile::tempdir().unwrap();
        let private = tempfile::tempdir().unwrap();
        repository(developer.path());
        fs::write(
            developer.path().join(".gitattributes"),
            "*.py filter=unsafe\n",
        )
        .unwrap();
        git(developer.path(), &["add", "."]);
        git(developer.path(), &["commit", "-qm", "attributes"]);
        let base = git(developer.path(), &["rev-parse", "HEAD"]);
        let marker = private.path().join("escaped");
        let command = format!("touch '{}'; cat", marker.display());
        for key in ["filter.unsafe.clean", "filter.unsafe.smudge"] {
            git(developer.path(), &["config", key, &command]);
        }
        if process {
            git(
                developer.path(),
                &["config", "filter.unsafe.process", &command],
            );
        }
        git(
            developer.path(),
            &["config", "filter.unsafe.required", "true"],
        );
        let before = snapshot(developer.path());
        let inspector = GitInspector::default();
        let worktree = private.path().join("writer");
        inspector
            .add_detached_worktree(developer.path(), &worktree, &base)
            .await
            .unwrap();
        assert!(!marker.exists(), "checkout executed a filter");
        assert_eq!(
            fs::read(worktree.join("src/main.py")).unwrap(),
            b"print('fixture')\n"
        );
        fs::write(worktree.join("src/main.py"), "print('candidate')\n").unwrap();
        assert_eq!(inspector.changed_paths(&worktree).await.unwrap().len(), 1);
        assert!(!marker.exists(), "status executed a filter");
        inspector.commit_all(&worktree, "candidate").await.unwrap();
        assert!(!marker.exists(), "staging or commit executed a filter");
        assert_eq!(
            git(&worktree, &["show", "HEAD:src/main.py"]),
            "print('candidate')"
        );
        for (path, bytes) in before {
            assert_eq!(
                snapshot(developer.path()).get(&path),
                Some(&bytes),
                "{path}"
            );
        }
    }
}

#[tokio::test]
async fn candidate_verification_rejects_tracked_edits_and_moved_identity_but_allows_check_artifacts(
) {
    let developer = tempfile::tempdir().unwrap();
    let private = tempfile::tempdir().unwrap();
    let base = repository(developer.path());
    let inspector = GitInspector::default();
    let worktree = private.path().join("candidate");
    inspector
        .add_detached_worktree(developer.path(), &worktree, &base)
        .await
        .unwrap();
    fs::write(worktree.join("src/main.py"), "print('candidate')\n").unwrap();
    let candidate = inspector.commit_all(&worktree, "candidate").await.unwrap();
    let tree = inspector.commit_tree(&worktree, &candidate).await.unwrap();
    inspector
        .verify_candidate(&worktree, &candidate, &tree)
        .await
        .unwrap();
    fs::create_dir(worktree.join("test-results")).unwrap();
    fs::write(
        worktree.join("test-results/output.txt"),
        "checks generated this\n",
    )
    .unwrap();
    inspector
        .verify_candidate(&worktree, &candidate, &tree)
        .await
        .unwrap();
    assert!(inspector
        .verify_candidate(&worktree, &base, &tree)
        .await
        .is_err());
    let base_tree = inspector.commit_tree(&worktree, &base).await.unwrap();
    assert!(inspector
        .verify_candidate(&worktree, &candidate, &base_tree)
        .await
        .is_err());
    fs::write(
        worktree.join("src/main.py"),
        "print('check mutated a tracked file')\n",
    )
    .unwrap();
    assert!(inspector
        .verify_candidate(&worktree, &candidate, &tree)
        .await
        .is_err());
    git(&worktree, &["add", "src/main.py"]);
    assert!(inspector
        .verify_candidate(&worktree, &candidate, &tree)
        .await
        .is_err());
    git(&worktree, &["reset", "--hard", "-q", &candidate]);
    inspector
        .verify_candidate(&worktree, &candidate, &tree)
        .await
        .unwrap();
    for flag in ["--assume-unchanged", "--skip-worktree"] {
        git(&worktree, &["update-index", flag, "src/main.py"]);
        fs::write(
            worktree.join("src/main.py"),
            "print('hidden tracked drift')\n",
        )
        .unwrap();
        assert!(git(
            &worktree,
            &["status", "--porcelain=v2", "--untracked-files=no"]
        )
        .is_empty());
        assert!(inspector
            .verify_candidate(&worktree, &candidate, &tree)
            .await
            .is_err());
        git(
            &worktree,
            &["update-index", "--no-assume-unchanged", "src/main.py"],
        );
        git(
            &worktree,
            &["update-index", "--no-skip-worktree", "src/main.py"],
        );
        git(&worktree, &["reset", "--hard", "-q", &candidate]);
        inspector
            .verify_candidate(&worktree, &candidate, &tree)
            .await
            .unwrap();
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        git(&worktree, &["config", "core.filemode", "false"]);
        fs::set_permissions(
            worktree.join("src/main.py"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        assert!(git(
            &worktree,
            &["status", "--porcelain=v2", "--untracked-files=no"]
        )
        .is_empty());
        assert!(inspector
            .verify_candidate(&worktree, &candidate, &tree)
            .await
            .is_err());
        fs::set_permissions(
            worktree.join("src/main.py"),
            fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        inspector
            .verify_candidate(&worktree, &candidate, &tree)
            .await
            .unwrap();
    }
    git(&worktree, &["checkout", "--detach", "-q", &base]);
    assert!(inspector
        .verify_candidate(&worktree, &candidate, &tree)
        .await
        .is_err());
}

#[tokio::test]
async fn candidate_diff_never_executes_external_drivers_or_textconv_and_refuses_oversized_output() {
    let developer = tempfile::tempdir().unwrap();
    let private = tempfile::tempdir().unwrap();
    repository(developer.path());
    fs::write(
        developer.path().join(".gitattributes"),
        "*.py diff=unsafe filter=unsafe\n",
    )
    .unwrap();
    git(developer.path(), &["add", "."]);
    git(developer.path(), &["commit", "-qm", "attributes"]);
    let base = git(developer.path(), &["rev-parse", "HEAD"]);
    let marker = private.path().join("external-command-ran");
    let command = format!("touch '{}'; cat", marker.display());
    for key in [
        "diff.external",
        "diff.unsafe.command",
        "diff.unsafe.textconv",
        "filter.unsafe.clean",
        "filter.unsafe.smudge",
        "filter.unsafe.process",
    ] {
        git(developer.path(), &["config", key, &command]);
    }
    git(
        developer.path(),
        &["config", "filter.unsafe.required", "true"],
    );
    let inspector = GitInspector::default();
    let worktree = private.path().join("candidate");
    inspector
        .add_detached_worktree(developer.path(), &worktree, &base)
        .await
        .unwrap();
    fs::write(
        worktree.join("src/main.py"),
        format!("print('candidate')\n# {}\n", "x".repeat(10_000)),
    )
    .unwrap();
    let candidate = inspector.commit_all(&worktree, "candidate").await.unwrap();
    let tree = inspector.commit_tree(&worktree, &candidate).await.unwrap();
    inspector
        .verify_candidate(&worktree, &candidate, &tree)
        .await
        .unwrap();
    let patch = inspector
        .candidate_diff(&worktree, &base, &candidate)
        .await
        .unwrap();
    assert!(patch.contains("-print('fixture')"));
    assert!(patch.contains("+print('candidate')"));
    assert!(
        !marker.exists(),
        "candidate inspection executed repository commands"
    );
    let capped = GitInspector {
        max_output_bytes: 2048,
        ..inspector
    };
    assert!(matches!(
        capped.candidate_diff(&worktree, &base, &candidate).await,
        Err(luuna_git::GitError::Oversized)
    ));
    for invalid in ["HEAD", "--output=/tmp/unapproved", "-p", "abc"] {
        assert!(capped
            .candidate_diff(&worktree, invalid, &candidate)
            .await
            .is_err());
        assert!(capped
            .verify_candidate(&worktree, &candidate, invalid)
            .await
            .is_err());
    }
    assert!(!marker.exists());
}
