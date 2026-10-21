//! Candidate validation helpers on synthetic repositories: review diffs that no
//! attribute can make opaque, bounded without refusing, and generation resets
//! that leave exactly the candidate tree.
use luuna_git::{DiffShown, GitError, GitInspector};
use std::{fs, path::Path, process::Command};

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

fn repository(dir: &Path) -> String {
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::write(dir.join("README.md"), "fixture\n").unwrap();
    fs::write(
        dir.join("src/auth.py"),
        "def allowed(user):\n    return user.admin\n",
    )
    .unwrap();
    fs::write(dir.join("src/legacy.txt"), b"caf\xe9\n").unwrap();
    // A repository-wide attribute that already hides lockfile changes.
    fs::write(dir.join(".gitattributes"), "*.lock binary\n").unwrap();
    fs::write(dir.join("deps.lock"), "a==1\n").unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "initial"]);
    git(dir, &["rev-parse", "HEAD"])
}

/// A candidate whose writer hid its source change behind a `-diff` attribute.
async fn candidate(
    inspector: &GitInspector,
    developer: &Path,
    worktree: &Path,
) -> (String, String) {
    let base = repository(developer);
    // The developer's own attributes apply to every repository they open.
    fs::write(developer.join(".git/info/attributes"), "*.txt -diff\n").unwrap();
    inspector
        .add_detached_worktree(developer, worktree, &base)
        .await
        .unwrap();
    fs::write(worktree.join("src/.gitattributes"), "* -diff\n").unwrap();
    fs::write(
        worktree.join("src/auth.py"),
        "def allowed(user):\n    return True  # gap\n",
    )
    .unwrap();
    fs::write(worktree.join("src/legacy.txt"), b"caf\xe8\n").unwrap();
    fs::write(worktree.join("deps.lock"), "a==2\n").unwrap();
    fs::write(worktree.join("src/logo.bin"), b"\x89PNG\0\0\0binary").unwrap();
    let commit = inspector.commit_all(worktree, "candidate").await.unwrap();
    (base, commit)
}

#[tokio::test]
async fn review_diffs_show_attribute_hidden_changes_as_text_and_summarise_real_binaries() {
    let developer = tempfile::tempdir().unwrap();
    let private = tempfile::tempdir().unwrap();
    let inspector = GitInspector::default();
    let worktree = private.path().join("candidate");
    let (base, commit) = candidate(&inspector, developer.path(), &worktree).await;

    let diff = inspector
        .review_diff(&worktree, &base, &commit, 256 * 1024)
        .await
        .unwrap();
    assert!(!diff.truncated);
    assert!(!diff.text.contains("GIT binary patch"), "{}", diff.text);
    assert!(!diff.text.contains("Binary files"), "{}", diff.text);
    // The hiding attribute itself and the change it tried to hide are text.
    assert!(diff.text.contains("+* -diff"), "{}", diff.text);
    assert!(
        diff.text.contains("-    return user.admin"),
        "{}",
        diff.text
    );
    assert!(
        diff.text.contains("+    return True  # gap"),
        "{}",
        diff.text
    );
    assert!(diff.text.contains("+a==2"), "{}", diff.text);
    let shown: Vec<(&str, &str, DiffShown)> = diff
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.status.as_str(), f.shown))
        .collect();
    assert_eq!(
        shown,
        vec![
            ("deps.lock", "M", DiffShown::Text),
            ("src/.gitattributes", "A", DiffShown::Text),
            ("src/auth.py", "M", DiffShown::Text),
            ("src/legacy.txt", "M", DiffShown::Summary),
            ("src/logo.bin", "A", DiffShown::Summary),
        ]
    );
    // Real binaries and non-UTF-8 text are named with their blobs, never
    // decoded lossily into apparently exact text.
    let logo = diff
        .files
        .iter()
        .find(|f| f.path == "src/logo.bin")
        .unwrap();
    assert_eq!(logo.old_blob, "0".repeat(40));
    assert!(diff.text.contains(&format!(
        "Luuna: A src/logo.bin: binary or non-UTF-8 content is not shown as text (old blob {}, new blob {})",
        logo.old_blob, logo.new_blob
    )));
    assert!(diff.text.contains("Luuna: M src/legacy.txt:"));
    assert!(!diff.text.contains('\u{fffd}'), "{}", diff.text);
}

#[tokio::test]
async fn review_diffs_keep_whole_sections_within_the_bound_and_list_every_file() {
    let developer = tempfile::tempdir().unwrap();
    let private = tempfile::tempdir().unwrap();
    let inspector = GitInspector::default();
    let worktree = private.path().join("candidate");
    let (base, commit) = candidate(&inspector, developer.path(), &worktree).await;
    let full = inspector
        .review_diff(&worktree, &base, &commit, usize::MAX)
        .await
        .unwrap();
    let first = full.text.find("diff --git a/src/.gitattributes").unwrap();
    let bounded = inspector
        .review_diff(&worktree, &base, &commit, first)
        .await
        .unwrap();
    assert!(bounded.truncated);
    assert_eq!(bounded.files.len(), full.files.len());
    assert_eq!(bounded.files[0].shown, DiffShown::Text);
    assert_eq!(bounded.files[1].shown, DiffShown::Omitted);
    assert!(bounded.text.len() <= first);
    assert!(bounded.text.starts_with("diff --git a/deps.lock"));
    assert!(!bounded.text.contains("auth.py"));

    // A patch beyond Git's output cap still yields the file list, not a refusal.
    fs::write(
        worktree.join("src/auth.py"),
        format!("# {}\n", "x".repeat(20_000)),
    )
    .unwrap();
    let large = inspector.commit_all(&worktree, "large").await.unwrap();
    let capped = GitInspector {
        max_output_bytes: 4096,
        ..inspector.clone()
    };
    let listed = capped
        .review_diff(&worktree, &base, &large, 256 * 1024)
        .await
        .unwrap();
    assert!(listed.truncated);
    assert!(listed.text.is_empty());
    assert_eq!(listed.files.len(), 5);
    assert!(listed.files.iter().all(|f| f.shown == DiffShown::Omitted));
    for invalid in ["HEAD", "--output=/tmp/unapproved", "abc"] {
        assert!(inspector
            .review_diff(&worktree, invalid, &large, 1024)
            .await
            .is_err());
    }
}

#[tokio::test]
async fn cleaning_a_candidate_worktree_leaves_exactly_the_candidate_tree() {
    let developer = tempfile::tempdir().unwrap();
    let private = tempfile::tempdir().unwrap();
    let inspector = GitInspector::default();
    let worktree = private.path().join("candidate");
    let (_, commit) = candidate(&inspector, developer.path(), &worktree).await;
    let tree = inspector.commit_tree(&worktree, &commit).await.unwrap();
    fs::write(worktree.join(".gitignore"), "local_settings.py\nbuild/\n").unwrap();
    git(&worktree, &["add", ".gitignore"]);
    let commit = inspector.commit_all(&worktree, "ignore").await.unwrap();
    let tree_after = inspector.commit_tree(&worktree, &commit).await.unwrap();
    assert_ne!(tree, tree_after);
    // Ignored and untracked content a writer, a person or a check left behind.
    fs::write(worktree.join("src/local_settings.py"), "TOKEN = 1\n").unwrap();
    fs::create_dir_all(worktree.join("build/cache")).unwrap();
    fs::write(worktree.join("build/cache/out.o"), "object").unwrap();
    fs::write(worktree.join("notes.txt"), "scratch\n").unwrap();
    fs::create_dir_all(worktree.join("vendor/nested")).unwrap();
    git(&worktree.join("vendor/nested"), &["init", "-q"]);
    let before = fs::read(developer.path().join("README.md")).unwrap();

    let mut removed = inspector.clean_candidate_worktree(&worktree).await.unwrap();
    removed.sort();
    assert_eq!(
        removed,
        vec!["build/", "notes.txt", "src/local_settings.py", "vendor/"]
    );
    for gone in ["src/local_settings.py", "build", "notes.txt", "vendor"] {
        assert!(!worktree.join(gone).exists(), "{gone}");
    }
    inspector
        .verify_candidate(&worktree, &commit, &tree_after)
        .await
        .unwrap();
    assert!(inspector
        .tracked_changes(&worktree)
        .await
        .unwrap()
        .is_empty());
    // Nothing left: a second reset removes nothing and the checkout is intact.
    assert!(inspector
        .clean_candidate_worktree(&worktree)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        fs::read(developer.path().join("README.md")).unwrap(),
        before
    );

    // Tracked drift is named, so a refusal can say what changed.
    fs::write(worktree.join("src/auth.py"), "edited by hand\n").unwrap();
    assert_eq!(
        inspector.tracked_changes(&worktree).await.unwrap(),
        vec!["src/auth.py"]
    );
    assert!(matches!(
        inspector
            .verify_candidate(&worktree, &commit, &tree_after)
            .await,
        Err(GitError::Command { .. })
    ));
}

#[tokio::test]
async fn review_diffs_pair_type_changes_and_never_run_repository_commands() {
    let developer = tempfile::tempdir().unwrap();
    let private = tempfile::tempdir().unwrap();
    let base = repository(developer.path());
    let inspector = GitInspector::default();
    let worktree = private.path().join("candidate");
    inspector
        .add_detached_worktree(developer.path(), &worktree, &base)
        .await
        .unwrap();
    // A type change (README.md becomes a gitlink) next to an ordinary edit.
    git(&worktree, &["rm", "-q", "--cached", "README.md"]);
    fs::remove_file(worktree.join("README.md")).unwrap();
    git(
        &worktree,
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("160000,{base},README.md"),
        ],
    );
    fs::write(worktree.join("deps.lock"), "a==3\n").unwrap();
    git(&worktree, &["add", "deps.lock"]);
    git(
        &worktree,
        &["commit", "-q", "--no-verify", "-m", "type change"],
    );
    let commit = git(&worktree, &["rev-parse", "HEAD"]);
    // A later candidate moves that gitlink to another commit.
    git(
        &worktree,
        &[
            "update-index",
            "--cacheinfo",
            &format!("160000,{commit},README.md"),
        ],
    );
    git(&worktree, &["commit", "-q", "--no-verify", "-m", "gitlink"]);
    let moved = git(&worktree, &["rev-parse", "HEAD"]);
    // Repository-selected drivers, text conversion and filters that would
    // leave a marker if review diffs or generation resets ever ran them.
    fs::write(
        developer.path().join(".git/info/attributes"),
        "* diff=unsafe filter=unsafe\n",
    )
    .unwrap();
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
    // Hiding submodule changes in configuration does not hide them here.
    git(
        developer.path(),
        &["config", "diff.ignoreSubmodules", "all"],
    );

    let diff = inspector
        .review_diff(&worktree, &base, &commit, 256 * 1024)
        .await
        .unwrap();
    let shown: Vec<(&str, &str, DiffShown)> = diff
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.status.as_str(), f.shown))
        .collect();
    assert_eq!(
        shown,
        vec![
            ("README.md", "T", DiffShown::Text),
            ("deps.lock", "M", DiffShown::Text),
        ]
    );
    assert!(diff.text.contains("-fixture"), "{}", diff.text);
    assert!(
        diff.text.contains(&format!("+Subproject commit {base}")),
        "{}",
        diff.text
    );
    assert!(diff.text.contains("+a==3"), "{}", diff.text);
    // A bound that cannot hold both halves omits the whole type change.
    let first = diff.text.find("diff --git a/deps.lock").unwrap();
    let bounded = inspector
        .review_diff(&worktree, &base, &commit, first - 1)
        .await
        .unwrap();
    assert_eq!(bounded.files[0].shown, DiffShown::Omitted);
    assert!(!bounded.text.contains("README.md"), "{}", bounded.text);

    let gitlink = inspector
        .review_diff(&worktree, &commit, &moved, 256 * 1024)
        .await
        .unwrap();
    assert_eq!(gitlink.files.len(), 1, "{gitlink:?}");
    assert_eq!(gitlink.files[0].path, "README.md");
    assert!(
        gitlink
            .text
            .contains(&format!("+Subproject commit {commit}")),
        "{}",
        gitlink.text
    );

    fs::write(worktree.join("scratch.py"), "print('untracked')\n").unwrap();
    assert_eq!(
        inspector.clean_candidate_worktree(&worktree).await.unwrap(),
        vec!["scratch.py"]
    );
    assert!(
        !marker.exists(),
        "candidate inspection executed repository commands"
    );
}
