//! Read-only repository inspection through the pinned host `git` executable.
//!
//! Every command runs with optional locks disabled, so even `git status` leaves
//! the index and working tree byte-identical. Repository-controlled hooks and
//! filesystem monitors are neutralised from the command line, no network
//! operation is issued, and remote URLs are redacted before they leave this crate.
use chrono::{SecondsFormat, Utc};
use luuna_domain::{
    DirtyState, RepositoryIdentity, RepositoryObservation, MAX_RECORDED_DIRTY_PATHS,
};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use thiserror::Error;
use tokio::{io::AsyncReadExt, process::Command};

pub const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_ROOT_COMMITS: usize = 64;

#[derive(Debug, Error)]
pub enum GitError {
    #[error("repository path must be an existing absolute directory")]
    InvalidPath,
    #[error("not a Git repository")]
    NotRepository,
    #[error("bare repositories cannot be imported")]
    Bare,
    #[error("path is inside a repository whose root is {0}")]
    NotRoot(String),
    #[error("repository has no commits on HEAD")]
    Unborn,
    #[error("repository has {0} root commits; more than {MAX_ROOT_COMMITS} cannot form a stable identity")]
    TooManyRoots(usize),
    #[error("{0}")]
    Identity(#[from] luuna_domain::DomainError),
    #[error("git {command} failed: {detail}")]
    Command { command: String, detail: String },
    #[error("git {0} timed out")]
    Timeout(String),
    #[error("git output exceeded the configured limit")]
    Oversized,
    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone, Debug)]
pub struct GitInspector {
    pub program: PathBuf,
    pub command_timeout: Duration,
    /// Per-stream output cap enforced while reading; the child is killed beyond it.
    pub max_output_bytes: usize,
}

impl Default for GitInspector {
    fn default() -> Self {
        Self {
            program: PathBuf::from("git"),
            command_timeout: Duration::from_secs(30),
            max_output_bytes: MAX_OUTPUT_BYTES,
        }
    }
}

struct Output {
    status: Option<i32>,
    stdout: Vec<u8>,
    stderr: String,
}

impl GitInspector {
    async fn git(&self, cwd: Option<&Path>, args: &[&str]) -> Result<Output, GitError> {
        let mut command = Command::new(&self.program);
        command.arg("--no-pager");
        if let Some(cwd) = cwd {
            command.arg("-C").arg(cwd);
        }
        // Repository configuration cannot reintroduce these: -c wins over every file.
        command.args([
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
        ]);
        command.args(args);
        // Every inherited GIT_* variable (GIT_DIR, GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY,
        // GIT_CONFIG_*, ...) could redirect inspection away from the path given to -C.
        for (name, _) in std::env::vars_os() {
            if name.to_string_lossy().starts_with("GIT_") {
                command.env_remove(&name);
            }
        }
        command
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let name = args.first().copied().unwrap_or("git").to_owned();
        let mut child = command.spawn()?;
        let mut stdout_pipe = child.stdout.take().expect("stdout is piped");
        let mut stderr_pipe = child.stderr.take().expect("stderr is piped");
        let limit = self.max_output_bytes as u64 + 1;
        let read = async {
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            let mut stdout_reader = (&mut stdout_pipe).take(limit);
            let mut stderr_reader = (&mut stderr_pipe).take(limit);
            let (out, err) = tokio::join!(
                stdout_reader.read_to_end(&mut stdout),
                stderr_reader.read_to_end(&mut stderr),
            );
            out?;
            err?;
            Ok::<_, std::io::Error>((stdout, stderr))
        };
        let (stdout, stderr) = match tokio::time::timeout(self.command_timeout, read).await {
            Ok(result) => result?,
            Err(_) => {
                let _ = child.kill().await;
                return Err(GitError::Timeout(name));
            }
        };
        // The streams were capped while reading; a child still writing is stopped here.
        if stdout.len() > self.max_output_bytes || stderr.len() > self.max_output_bytes {
            let _ = child.kill().await;
            return Err(GitError::Oversized);
        }
        let status = match tokio::time::timeout(self.command_timeout, child.wait()).await {
            Ok(status) => status?,
            Err(_) => {
                let _ = child.kill().await;
                return Err(GitError::Timeout(name));
            }
        };
        Ok(Output {
            status: status.code(),
            stdout,
            stderr: String::from_utf8_lossy(&stderr).chars().take(400).collect(),
        })
    }

    async fn expect(&self, cwd: &Path, args: &[&str]) -> Result<String, GitError> {
        let output = self.git(Some(cwd), args).await?;
        if output.status != Some(0) {
            return Err(GitError::Command {
                command: args.join(" "),
                detail: output.stderr,
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    async fn optional(&self, cwd: &Path, args: &[&str]) -> Result<Option<String>, GitError> {
        let output = self.git(Some(cwd), args).await?;
        Ok((output.status == Some(0))
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned()))
    }

    pub async fn version(&self) -> Result<String, GitError> {
        let output = self.git(None, &["--version"]).await?;
        if output.status != Some(0) {
            return Err(GitError::Command {
                command: "--version".into(),
                detail: output.stderr,
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }

    /// Observe a repository root without modifying it. The path must be the
    /// repository's top level so that registration identity stays stable.
    pub async fn inspect(&self, path: &Path) -> Result<RepositoryObservation, GitError> {
        if !path.is_absolute() || !path.is_dir() {
            return Err(GitError::InvalidPath);
        }
        let canonical = std::fs::canonicalize(path).map_err(|_| GitError::InvalidPath)?;
        let git_version = self.version().await?;
        // Git for Windows does not accept `\\?\` verbatim paths; use the plain form for -C.
        let canonical = strip_verbatim_prefix(&canonical);
        let probe = self
            .git(
                Some(&canonical),
                &[
                    "rev-parse",
                    "--is-bare-repository",
                    "--is-shallow-repository",
                ],
            )
            .await?;
        if probe.status != Some(0) {
            return Err(GitError::NotRepository);
        }
        let text = String::from_utf8_lossy(&probe.stdout);
        let mut lines = text.lines();
        if lines.next() == Some("true") {
            return Err(GitError::Bare);
        }
        let shallow = lines.next() == Some("true");
        let toplevel = self
            .optional(&canonical, &["rev-parse", "--show-toplevel"])
            .await?
            .filter(|t| !t.is_empty())
            .ok_or(GitError::NotRepository)?;
        let toplevel = toplevel.trim();
        let toplevel_path = std::fs::canonicalize(toplevel)
            .map(|p| strip_verbatim_prefix(&p))
            .map_err(|_| GitError::NotRepository)?;
        if toplevel_path != canonical {
            return Err(GitError::NotRoot(toplevel.to_owned()));
        }
        let head_commit = self
            .optional(
                &canonical,
                &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
            )
            .await?
            .filter(|c| c.len() == 40 || c.len() == 64)
            .ok_or(GitError::Unborn)?;
        let branch = self
            .optional(&canonical, &["symbolic-ref", "--quiet", "--short", "HEAD"])
            .await?
            .filter(|b| !b.is_empty());
        let remote = self
            .optional(&canonical, &["remote", "get-url", "origin"])
            .await?
            .filter(|r| !r.is_empty())
            .map(|r| redact_remote(&r));
        let remote_default_branch = self
            .optional(
                &canonical,
                &[
                    "symbolic-ref",
                    "--quiet",
                    "--short",
                    "refs/remotes/origin/HEAD",
                ],
            )
            .await?
            .and_then(|r| r.strip_prefix("origin/").map(ToOwned::to_owned));
        let mut root_commits: Vec<String> = if shallow {
            Vec::new()
        } else {
            self.expect(&canonical, &["rev-list", "--max-parents=0", "HEAD"])
                .await?
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        };
        root_commits.sort();
        root_commits.dedup();
        // Identity must cover every root; truncating would let a history change slip past.
        if root_commits.len() > MAX_ROOT_COMMITS {
            return Err(GitError::TooManyRoots(root_commits.len()));
        }
        let local_branches = self
            .expect(
                &canonical,
                &["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
            )
            .await?
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(ToOwned::to_owned)
            .collect();
        let status = self
            .git(
                Some(&canonical),
                &[
                    "status",
                    "--porcelain=v2",
                    "-z",
                    "--untracked-files=normal",
                    "--no-renames",
                ],
            )
            .await?;
        if status.status != Some(0) {
            return Err(GitError::Command {
                command: "status".into(),
                detail: status.stderr,
            });
        }
        let observation = RepositoryObservation {
            local_path: canonical.to_string_lossy().into_owned(),
            identity: RepositoryIdentity {
                remote,
                root_commits,
                shallow,
            },
            head_commit,
            branch,
            remote_default_branch,
            local_branches,
            dirty: parse_porcelain_v2(&status.stdout),
            git_version,
            observed_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        };
        observation.validate()?;
        Ok(observation)
    }
}

/// `std::fs::canonicalize` returns `\\?\C:\…` on Windows; Git and users expect `C:\…`.
pub fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

/// Strip user information, query strings and fragments from remotes so tokens never persist.
pub fn redact_remote(remote: &str) -> String {
    let remote = remote.split(['?', '#']).next().unwrap_or(remote);
    if let Some((scheme, rest)) = remote.split_once("://") {
        if let Some((authority, path)) = rest.split_once('/') {
            let host = authority.rsplit('@').next().unwrap_or(authority);
            return format!("{scheme}://{host}/{path}");
        }
        let host = rest.rsplit('@').next().unwrap_or(rest);
        return format!("{scheme}://{host}");
    }
    remote.to_owned()
}

/// `git status --porcelain=v2 -z --no-renames` entries: `1 XY ...`, `u XY ...`, `? path`, `! path`.
pub fn parse_porcelain_v2(bytes: &[u8]) -> DirtyState {
    let mut state = DirtyState::default();
    for entry in bytes.split(|b| *b == 0).filter(|e| !e.is_empty()) {
        let text = String::from_utf8_lossy(entry);
        let mut fields = text.splitn(2, ' ');
        let kind = fields.next().unwrap_or("");
        let rest = fields.next().unwrap_or("");
        let path = match kind {
            "1" | "2" => {
                let xy = rest.get(0..2).unwrap_or("..");
                if !xy.starts_with('.') {
                    state.staged += 1;
                }
                if !xy.ends_with('.') {
                    state.unstaged += 1;
                }
                let columns = if kind == "1" { 8 } else { 9 };
                rest.splitn(columns, ' ').last().unwrap_or("")
            }
            "u" => {
                state.conflicted += 1;
                rest.splitn(10, ' ').last().unwrap_or("")
            }
            "?" => {
                state.untracked += 1;
                rest
            }
            _ => continue,
        };
        if state.paths.len() < MAX_RECORDED_DIRTY_PATHS {
            state.paths.push(path.to_owned());
        } else {
            state.truncated = true;
        }
    }
    state
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verbatim_prefixes_are_removed_for_git_and_display() {
        assert_eq!(
            strip_verbatim_prefix(Path::new(r"\\?\C:\work\repo")),
            PathBuf::from(r"C:\work\repo")
        );
        assert_eq!(
            strip_verbatim_prefix(Path::new(r"\\?\UNC\server\share\repo")),
            PathBuf::from(r"\\server\share\repo")
        );
        assert_eq!(
            strip_verbatim_prefix(Path::new("/srv/repo")),
            PathBuf::from("/srv/repo")
        );
    }

    #[test]
    fn remote_redaction_removes_credentials_only() {
        assert_eq!(
            redact_remote("https://user:tok3n@github.com/org/repo.git"),
            "https://github.com/org/repo.git"
        );
        assert_eq!(
            redact_remote("ssh://git@github.com/org/repo.git"),
            "ssh://github.com/org/repo.git"
        );
        assert_eq!(
            redact_remote("git@github.com:org/repo.git"),
            "git@github.com:org/repo.git"
        );
        assert_eq!(redact_remote("https://x@host"), "https://host");
        assert_eq!(
            redact_remote("https://host/org/repo.git?access_token=secret#frag"),
            "https://host/org/repo.git"
        );
        assert_eq!(
            redact_remote("git@github.com:org/repo.git?token=secret"),
            "git@github.com:org/repo.git"
        );
    }

    #[test]
    fn porcelain_v2_counts_each_change_class() {
        let raw = b"1 M. N... 100644 100644 100644 abc def staged.txt\0\
1 .M N... 100644 100644 100644 abc def unstaged.txt\0\
1 MM N... 100644 100644 100644 abc def both.txt\0\
u UU N... 100644 100644 100644 100644 a b c conflicted.txt\0\
? new dir/\0! ignored.log\0";
        let state = parse_porcelain_v2(raw);
        assert_eq!(
            (
                state.staged,
                state.unstaged,
                state.untracked,
                state.conflicted
            ),
            (2, 2, 1, 1)
        );
        assert_eq!(
            state.paths,
            vec![
                "staged.txt",
                "unstaged.txt",
                "both.txt",
                "conflicted.txt",
                "new dir/"
            ]
        );
        assert!(!state.truncated);
        assert!(parse_porcelain_v2(b"").is_clean());
    }
}
