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
