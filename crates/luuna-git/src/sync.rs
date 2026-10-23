//! Orbit (ADR 0036): upstream tracking for status, and the two network
//! operations a developer's sync asks for. Same environment as inspection: no
//! hooks, filesystem monitor, prompts or inherited `GIT_*` state.
use crate::{GitError, GitInspector};
use serde::{Deserialize, Serialize};
use std::{path::Path, time::Duration};

/// The branch HEAD tracks and how far apart they are.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Upstream {
    /// For example `origin/main`.
    pub name: String,
    pub ahead: u64,
    pub behind: u64,
}

impl GitInspector {
    /// HEAD's upstream and the commit counts on each side; `None` when HEAD is
    /// detached or tracks nothing. Read-only: no worktree content is read.
    pub async fn upstream(&self, root: &Path) -> Result<Option<Upstream>, GitError> {
        let Some(name) = self
            .optional(
                root,
                &[
                    "rev-parse",
                    "--abbrev-ref",
                    "--symbolic-full-name",
                    "@{upstream}",
                ],
                &[],
            )
            .await?
            .filter(|name| !name.is_empty())
        else {
            return Ok(None);
        };
        let counts = self
            .expect(
                root,
                &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
                &[],
            )
            .await?;
        let mut parts = counts.split_whitespace().map(str::parse::<u64>);
        match (parts.next(), parts.next()) {
            (Some(Ok(ahead)), Some(Ok(behind))) => Ok(Some(Upstream {
                name,
                ahead,
                behind,
            })),
            _ => Err(GitError::Command {
                command: "rev-list --left-right --count".into(),
                detail: format!("unexpected output {counts:?}"),
            }),
        }
    }

    fn with_timeout(&self, timeout: Duration) -> GitInspector {
        GitInspector {
            command_timeout: timeout,
            ..self.clone()
        }
    }

    /// `git fetch --prune origin`; returns Git's one-line summary (stderr).
    pub async fn fetch_origin(&self, root: &Path, timeout: Duration) -> Result<String, GitError> {
        let output = self
            .with_timeout(timeout)
            .git(
                Some(root),
                &["fetch", "--prune", "--no-recurse-submodules", "origin"],
                &[],
            )
            .await?;
        if output.status != Some(0) {
            return Err(GitError::Command {
                command: "fetch".into(),
                detail: output.stderr,
            });
        }
        Ok(output
            .stderr
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" "))
    }

    /// Clone `remote` into `destination`, which must not exist yet or be an empty
    /// directory. Submodules are not populated.
    pub async fn clone_repository(
        &self,
        remote: &str,
        destination: &Path,
        timeout: Duration,
    ) -> Result<(), GitError> {
        if remote.is_empty() || remote.starts_with('-') {
            return Err(GitError::Command {
                command: "clone".into(),
                detail: "the registered remote cannot be cloned".into(),
            });
        }
        if destination.exists()
            && std::fs::read_dir(destination)
                .map(|mut d| d.next().is_some())
                .unwrap_or(true)
        {
            return Err(GitError::Command {
                command: "clone".into(),
                detail: format!("{} exists and is not empty", destination.display()),
            });
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let destination_text = destination.to_string_lossy().into_owned();
        let output = self
            .with_timeout(timeout)
            .git(
                None,
                &[
                    "clone",
                    "--no-recurse-submodules",
                    "--",
                    remote,
                    &destination_text,
                ],
                &[],
            )
            .await?;
        if output.status != Some(0) {
            return Err(GitError::Command {
                command: "clone".into(),
                detail: output.stderr,
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    }

    fn commit(dir: &Path, name: &str) {
        std::fs::write(dir.join(name), name).unwrap();
        git(dir, &["add", name]);
        git(
            dir,
            &[
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@example.invalid",
                "commit",
                "-q",
                "-m",
                name,
            ],
        );
    }

    #[tokio::test]
    async fn upstream_counts_clone_and_fetch() {
        let temp = tempfile::tempdir().unwrap();
        let origin = temp.path().join("origin");
        std::fs::create_dir(&origin).unwrap();
        git(&origin, &["init", "-q", "-b", "main"]);
        commit(&origin, "a");
        let inspector = GitInspector::default();
        let clone = temp.path().join("nested").join("clone");
        inspector
            .clone_repository(&origin.to_string_lossy(), &clone, Duration::from_secs(60))
            .await
            .unwrap();
        let tracking = inspector.upstream(&clone).await.unwrap().unwrap();
        assert_eq!(
            tracking,
            Upstream {
                name: "origin/main".into(),
                ahead: 0,
                behind: 0
            }
        );
        commit(&origin, "b");
        commit(&clone, "c");
        inspector
            .fetch_origin(&clone, Duration::from_secs(60))
            .await
            .unwrap();
        let tracking = inspector.upstream(&clone).await.unwrap().unwrap();
        assert_eq!((tracking.ahead, tracking.behind), (1, 1));
        // A second clone onto a populated directory is refused.
        assert!(inspector
            .clone_repository(&origin.to_string_lossy(), &clone, Duration::from_secs(60))
            .await
            .is_err());
        assert!(inspector
            .clone_repository(
                "--upload-pack=x",
                &temp.path().join("x"),
                Duration::from_secs(5)
            )
            .await
            .is_err());
        git(&clone, &["checkout", "-q", "--detach"]);
        assert_eq!(inspector.upstream(&clone).await.unwrap(), None);
    }
}
