//! Luuna-owned detached worktrees (M2c). These are the only write operations in
//! this crate: they create a worktree under Luuna's private data directory at an
//! exact commit, report what a writer changed there, and record a candidate
//! commit. The developer checkout's files are never touched; `git worktree add`
//! records its bookkeeping under the repository's `.git/worktrees`. Hooks stay
//! neutralised and every inherited `GIT_*` variable is removed, as for inspection.

use crate::{GitError, GitInspector};
use luuna_domain::ChangedPath;
use std::path::Path;

/// Identity recorded on candidate commits; never the developer's identity.
pub const WRITER_AUTHOR_NAME: &str = "Luuna Writer";
pub const WRITER_AUTHOR_EMAIL: &str = "writer@luuna.invalid";

impl GitInspector {
    /// Verify the exact frozen candidate before and after validation/review.
    /// Check-created untracked artifacts do not alter the commit/tree; tracked
    /// edits, staged changes, conflicts and a moved HEAD always invalidate it.
    pub async fn verify_candidate(
        &self,
        worktree: &Path,
        expected_commit: &str,
        expected_tree: &str,
    ) -> Result<(), GitError> {
        require_object_id(expected_commit)?;
        require_object_id(expected_tree)?;
        let head = self.head_commit(worktree).await?;
        let tree = self.commit_tree(worktree, &head).await?;
        if head != expected_commit || tree != expected_tree {
            return Err(GitError::Command {
                command: "verify candidate".into(),
                detail: "candidate HEAD or tree changed".into(),
            });
        }
        let mut overrides = self.filter_overrides(worktree).await?;
        overrides.extend([
            "core.ignoreStat=false".to_owned(),
            "core.trustctime=true".to_owned(),
            "core.checkStat=default".to_owned(),
        ]);
        #[cfg(unix)]
        overrides.push("core.filemode=true".to_owned());
        // Status intentionally trusts assume-unchanged/skip-worktree flags.
        // Checks can run Git under native permissions; those flags cannot hide
        // a tracked edit and turn it into evidence for an immutable candidate.
        let index = self
            .git(Some(worktree), &["ls-files", "-v", "-z"], &overrides)
            .await?;
        if index.status != Some(0) {
            return Err(GitError::Command {
                command: "ls-files".into(),
                detail: index.stderr,
            });
        }
        if index.stdout.split(|byte| *byte == 0).any(|entry| {
            entry
                .first()
                .is_some_and(|flag| *flag == b'S' || flag.is_ascii_lowercase())
        }) {
            return Err(GitError::Command {
                command: "verify candidate".into(),
                detail: "candidate index hides tracked paths with assume-unchanged or skip-worktree flags".into(),
            });
        }
        let status = self
            .expect(
                worktree,
                &[
                    "status",
                    "--porcelain=v2",
                    "-z",
                    "--no-renames",
                    "--untracked-files=no",
                    "--ignore-submodules=none",
                ],
                &overrides,
            )
            .await?;
        if !status.is_empty() {
            return Err(GitError::Command {
                command: "verify candidate".into(),
                detail: "candidate has tracked changes".into(),
            });
        }
        Ok(())
    }

    /// A bounded patch between exact commits, never an external diff driver or
    /// textconv command selected by repository configuration/attributes. Filters
    /// are disabled as for all managed worktree operations. Oversized output is
    /// rejected rather than truncated into apparently complete review evidence.
    pub async fn candidate_diff(
        &self,
        worktree: &Path,
        base_commit: &str,
        candidate_commit: &str,
    ) -> Result<String, GitError> {
        require_object_id(base_commit)?;
        require_object_id(candidate_commit)?;
        let overrides = self.filter_overrides(worktree).await?;
        self.expect(
            worktree,
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--no-renames",
                "--binary",
                "--no-color",
                "--no-relative",
                "--src-prefix=a/",
                "--dst-prefix=b/",
                base_commit,
                candidate_commit,
                "--",
            ],
            &overrides,
        )
        .await
    }

    /// Create a detached worktree for `commit` at `path`, which must not exist yet,
    /// and verify its HEAD is exactly that commit. Repository-selected content
    /// filters are disabled: executing them is outside the writer approval.
    pub async fn add_detached_worktree(
        &self,
        root: &Path,
        path: &Path,
        commit: &str,
    ) -> Result<(), GitError> {
        if path.exists() {
            return Err(GitError::Command {
                command: "worktree add".into(),
                detail: format!("{} already exists", path.display()),
            });
        }
        let overrides = self.filter_overrides(root).await?;
        let target = path.to_string_lossy().into_owned();
        self.expect(
            root,
            &["worktree", "add", "--detach", "--quiet", &target, commit],
            &overrides,
        )
        .await?;
        let head = self.head_commit(path).await?;
        if head != commit {
            return Err(GitError::Command {
                command: "worktree add".into(),
                detail: format!("worktree HEAD {head} is not {commit}"),
            });
        }
        Ok(())
    }

    /// Exact HEAD of a worktree or repository.
    pub async fn head_commit(&self, worktree: &Path) -> Result<String, GitError> {
        self.optional(worktree, &["rev-parse", "--verify", "--quiet", "HEAD"], &[])
            .await?
            .filter(|c| c.len() == 40 || c.len() == 64)
            .ok_or_else(|| GitError::Command {
                command: "rev-parse".into(),
                detail: "worktree has no HEAD commit".into(),
            })
    }

    /// Every path whose content differs from HEAD, including untracked files and
    /// files inside untracked directories. Output beyond the configured cap is an
    /// error: a change set too large to list is never judged in scope.
    pub async fn changed_paths(&self, worktree: &Path) -> Result<Vec<ChangedPath>, GitError> {
        let overrides = self.filter_overrides(worktree).await?;
        let output = self
            .git(
                Some(worktree),
                &[
                    "status",
                    "--porcelain=v2",
                    "-z",
                    "--no-renames",
                    "--untracked-files=all",
                ],
                &overrides,
            )
            .await?;
        if output.status != Some(0) {
            return Err(GitError::Command {
                command: "status".into(),
                detail: output.stderr,
            });
        }
        Ok(parse_changed_paths(&output.stdout))
    }

    /// Stage everything in the worktree and commit it as the Luuna writer.
    /// Returns the new HEAD. Hooks do not run; validation is a separate gate.
    pub async fn commit_all(&self, worktree: &Path, message: &str) -> Result<String, GitError> {
        let before = self.head_commit(worktree).await?;
        let overrides = self.filter_overrides(worktree).await?;
        self.expect(worktree, &["add", "--all"], &overrides).await?;
        let mut identity = vec![
            format!("user.name={WRITER_AUTHOR_NAME}"),
            format!("user.email={WRITER_AUTHOR_EMAIL}"),
            "commit.gpgsign=false".to_owned(),
            "core.editor=false".to_owned(),
        ];
        identity.extend(overrides);
        self.expect(
            worktree,
            &["commit", "--quiet", "--no-verify", "--message", message],
            &identity,
        )
        .await?;
        let after = self.head_commit(worktree).await?;
        if after == before {
            return Err(GitError::Command {
                command: "commit".into(),
                detail: "no commit was created".into(),
            });
        }
        Ok(after)
    }

    /// Remove a Luuna-owned worktree and its bookkeeping. Only tests and explicit
    /// operator cleanup call this; attempts preserve their worktrees.
    pub async fn remove_worktree(&self, root: &Path, path: &Path) -> Result<(), GitError> {
        let target = path.to_string_lossy().into_owned();
        self.expect(root, &["worktree", "remove", "--force", &target], &[])
            .await?;
        Ok(())
    }
}

fn require_object_id(value: &str) -> Result<(), GitError> {
    if matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Ok(());
    }
    Err(GitError::Command {
        command: "verify candidate".into(),
        detail: "candidate identities must be full Git object IDs".into(),
    })
}

/// `git status --porcelain=v2 -z --no-renames --untracked-files=all` entries.
pub fn parse_changed_paths(bytes: &[u8]) -> Vec<ChangedPath> {
    let mut changes = Vec::new();
    for entry in bytes.split(|b| *b == 0).filter(|e| !e.is_empty()) {
        let text = String::from_utf8_lossy(entry);
        let mut fields = text.splitn(2, ' ');
        let kind = fields.next().unwrap_or("");
        let rest = fields.next().unwrap_or("");
        let (status, path) = match kind {
            "1" => {
                let xy = rest.get(0..2).unwrap_or("..").replace('.', "");
                (xy, rest.splitn(8, ' ').last().unwrap_or(""))
            }
            "2" => {
                let xy = rest.get(0..2).unwrap_or("..").replace('.', "");
                (xy, rest.splitn(9, ' ').last().unwrap_or(""))
            }
            "u" => ("U".to_owned(), rest.splitn(10, ' ').last().unwrap_or("")),
            "?" => ("?".to_owned(), rest),
            _ => continue,
        };
        if path.is_empty() {
            continue;
        }
        changes.push(ChangedPath {
            path: path.to_owned(),
            status,
            original_path: None,
        });
    }
    changes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn porcelain_entries_become_changed_paths() {
        let raw = b"1 .M N... 100644 100644 100644 abc def src/main.rs\0\
1 A. N... 000000 100644 100644 000 def docs/new file.md\0\
? untracked/dir/file.txt\0! ignored.log\0";
        let changes = parse_changed_paths(raw);
        assert_eq!(
            changes
                .iter()
                .map(|c| (c.status.as_str(), c.path.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("M", "src/main.rs"),
                ("A", "docs/new file.md"),
                ("?", "untracked/dir/file.txt"),
            ]
        );
        assert!(parse_changed_paths(b"").is_empty());
    }
}
