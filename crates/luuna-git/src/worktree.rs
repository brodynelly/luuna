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
    /// Create a detached worktree for `commit` at `path`, which must not exist yet,
    /// and verify its HEAD is exactly that commit. Content filters are left as the
    /// repository configures them so the checkout matches a normal one.
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
        let target = path.to_string_lossy().into_owned();
        self.expect(
            root,
            &["worktree", "add", "--detach", "--quiet", &target, commit],
            &[],
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
                &[],
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
        self.expect(worktree, &["add", "--all"], &[]).await?;
        let identity = [
            format!("user.name={WRITER_AUTHOR_NAME}"),
            format!("user.email={WRITER_AUTHOR_EMAIL}"),
            "commit.gpgsign=false".to_owned(),
            "core.editor=false".to_owned(),
        ];
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
