//! Luuna-owned detached worktrees (M2c). These are the only write operations in
//! this crate: they create a worktree under Luuna's private data directory at an
//! exact commit, report what a writer changed there, and record a candidate
//! commit. The developer checkout's files are never touched; `git worktree add`
//! records its bookkeeping under the repository's `.git/worktrees`. Hooks stay
//! neutralised and every inherited `GIT_*` variable is removed, as for inspection.
//!
//! The worktree's `.git` file lies inside the writer's reach, so no managed
//! operation trusts it: each one first verifies the binding from both ends (the
//! gitfile names an administrative directory whose own `gitdir` names this
//! worktree back) and then runs Git with explicit `--git-dir`/`--work-tree`.

use crate::{strip_verbatim_prefix, GitError, GitInspector, Output};
use luuna_domain::ChangedPath;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::SystemTime,
};

/// Identity recorded on candidate commits; never the developer's identity.
pub const WRITER_AUTHOR_NAME: &str = "Luuna Writer";
pub const WRITER_AUTHOR_EMAIL: &str = "writer@luuna.invalid";

/// The Git administrative directory of one Luuna-owned linked worktree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeBinding {
    /// `<common>/worktrees/<name>`, as `git worktree add` wrote it.
    pub git_dir: PathBuf,
    /// The repository's common directory that owns `git_dir`.
    pub common_dir: PathBuf,
}

fn binding_error(detail: &str) -> GitError {
    GitError::Command {
        command: "worktree binding".into(),
        detail: detail.into(),
    }
}

/// Read a worktree's binding without asking Git, which would follow whatever the
/// gitfile names. The gitfile must be the regular file `git worktree add` wrote,
/// naming an absolute `<common>/worktrees/<name>` whose `gitdir` points back at
/// this worktree and whose common directory lies outside it. A writer confined
/// to the worktree cannot forge an administrative directory that satisfies this.
pub fn worktree_binding(worktree: &Path) -> Result<WorktreeBinding, GitError> {
    let gitfile = worktree.join(".git");
    let metadata = std::fs::symlink_metadata(&gitfile)
        .map_err(|_| binding_error("the worktree has no .git file"))?;
    if !metadata.file_type().is_file() || metadata.len() > 4096 {
        return Err(binding_error(
            "the worktree's .git is no longer the gitfile Git wrote",
        ));
    }
    let text = std::fs::read_to_string(&gitfile)
        .map_err(|_| binding_error("the worktree's .git file cannot be read"))?;
    let git_dir = text
        .strip_prefix("gitdir: ")
        .and_then(|rest| rest.strip_suffix('\n'))
        .map(|rest| rest.strip_suffix('\r').unwrap_or(rest))
        .filter(|rest| !rest.is_empty() && !rest.contains(['\n', '\r']))
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| binding_error("the worktree's .git file is not an absolute gitdir line"))?;
    let common_dir = git_dir
        .parent()
        .filter(|parent| parent.file_name().is_some_and(|name| name == "worktrees"))
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            binding_error("the gitfile does not name a worktree administrative directory")
        })?;
    let canonical = |path: &Path| {
        std::fs::canonicalize(path)
            .map_err(|_| binding_error("the worktree's administrative directory is missing"))
    };
    let read_line = |name: &str| {
        std::fs::read_to_string(git_dir.join(name))
            .map(|text| text.trim_end_matches(['\n', '\r']).to_owned())
            .map_err(|_| binding_error("the worktree's administrative directory is incomplete"))
    };
    if canonical(Path::new(&read_line("gitdir")?))? != canonical(&gitfile)? {
        return Err(binding_error(
            "the gitfile names an administrative directory of a different worktree",
        ));
    }
    if canonical(&git_dir.join(read_line("commondir")?))? != canonical(&common_dir)? {
        return Err(binding_error(
            "the administrative directory belongs to a different repository",
        ));
    }
    if canonical(&common_dir)?.starts_with(canonical(worktree)?) {
        return Err(binding_error(
            "the gitfile names repository metadata inside the worktree",
        ));
    }
    Ok(WorktreeBinding {
        git_dir,
        common_dir,
    })
}

fn path_argument(flag: &str, path: &Path) -> Result<String, GitError> {
    let path = strip_verbatim_prefix(path);
    path.to_str()
        .map(|text| format!("{flag}={text}"))
        .ok_or_else(|| binding_error("worktree paths must be valid UTF-8"))
}

/// One tracked path whose effect Git cannot see from inside the worktree.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Unseen {
    /// A symbolic link: where a write through it would land outside the
    /// worktree (`None` when it cannot resolve) and that location's metadata.
    Link(Option<PathBuf>, Option<Stamp>),
    /// An unpopulated gitlink (submodule) directory: Git never lists its contents.
    Gitlink(Option<Stamp>, usize),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Stamp {
    directory: bool,
    len: u64,
    modified: Option<SystemTime>,
}

fn stamp(path: &Path) -> Option<Stamp> {
    std::fs::metadata(path).ok().map(|metadata| Stamp {
        directory: metadata.is_dir(),
        len: metadata.len(),
        modified: metadata.modified().ok(),
    })
}

/// Where a write to `path` would land: symbolic links in the existing prefix
/// are followed by the filesystem, and a dangling link is followed to its
/// target, which a write would create. `None` beyond 40 links.
fn landing(path: &Path, depth: u8) -> Option<PathBuf> {
    if depth > 40 {
        return None;
    }
    let mut existing = path.to_path_buf();
    let mut missing = Vec::new();
    loop {
        match std::fs::symlink_metadata(&existing) {
            Ok(metadata) if metadata.file_type().is_symlink() && !existing.exists() => {
                let mut next = existing.parent()?.join(std::fs::read_link(&existing).ok()?);
                next.extend(missing.iter().rev());
                return landing(&next, depth + 1);
            }
            Ok(_) => break,
            Err(_) => {
                missing.push(existing.file_name()?.to_owned());
                existing = existing.parent()?.to_path_buf();
            }
        }
    }
    let mut real = std::fs::canonicalize(&existing).ok()?;
    real.extend(missing.iter().rev());
    Some(real)
}

/// What a writer session could change without Git reporting it: the outside
/// targets of tracked symbolic links (dangling ones included) and the contents
/// of unpopulated gitlink directories. Record it before the session and compare
/// afterwards; an unchanged record means no such write happened.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UnseenState(BTreeMap<String, Unseen>);

impl UnseenState {
    /// Tracked paths whose unseen state differs from `earlier`, sorted.
    pub fn changed_since(&self, earlier: &UnseenState) -> Vec<String> {
        self.0
            .iter()
            .filter(|(path, now)| earlier.0.get(*path) != Some(now))
            .map(|(path, _)| path.clone())
            .chain(
                earlier
                    .0
                    .keys()
                    .filter(|path| !self.0.contains_key(*path))
                    .cloned(),
            )
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect()
    }
}

impl GitInspector {
    /// Run Git on a Luuna-owned worktree through its verified binding, so no
    /// repository is discovered from the writer-reachable gitfile.
    async fn bound(
        &self,
        worktree: &Path,
        args: &[&str],
        overrides: &[String],
    ) -> Result<Output, GitError> {
        let binding = worktree_binding(worktree)?;
        let git_dir = path_argument("--git-dir", &binding.git_dir)?;
        let work_tree = path_argument("--work-tree", worktree)?;
        let mut full = vec![git_dir.as_str(), work_tree.as_str()];
        full.extend_from_slice(args);
        // Errors name the subcommand, never the private paths placed before it.
        let subcommand = args.first().copied().unwrap_or("git").to_owned();
        let output = match self.git(Some(worktree), &full, overrides).await {
            Err(GitError::Timeout(_)) => return Err(GitError::Timeout(subcommand)),
            other => other?,
        };
        Ok(output)
    }

    async fn bound_expect(
        &self,
        worktree: &Path,
        args: &[&str],
        overrides: &[String],
    ) -> Result<String, GitError> {
        let output = self.bound(worktree, args, overrides).await?;
        if output.status != Some(0) {
            return Err(GitError::Command {
                command: args.join(" "),
                detail: output.stderr,
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    /// Verify that `worktree` is still bound to the repository registered at
    /// `root`: the structural binding plus the same common directory.
    pub async fn verify_worktree_binding(
        &self,
        root: &Path,
        worktree: &Path,
    ) -> Result<WorktreeBinding, GitError> {
        let binding = worktree_binding(worktree)?;
        let common = self
            .optional(root, &["rev-parse", "--git-common-dir"], &[])
            .await?
            .filter(|common| !common.is_empty())
            .map(|common| root.join(common))
            .ok_or_else(|| binding_error("the registered repository has no common directory"))?;
        let canonical = |path: &Path| std::fs::canonicalize(path).ok();
        if canonical(&common).is_none() || canonical(&common) != canonical(&binding.common_dir) {
            return Err(binding_error(
                "the worktree is bound to a different repository than the registered one",
            ));
        }
        Ok(binding)
    }

    /// Record what Git cannot see in a Luuna-owned worktree; see [`UnseenState`].
    pub async fn unseen_state(&self, worktree: &Path) -> Result<UnseenState, GitError> {
        let listed = self
            .bound(worktree, &["ls-files", "--stage", "-z"], &[])
            .await?;
        if listed.status != Some(0) {
            return Err(GitError::Command {
                command: "ls-files".into(),
                detail: listed.stderr,
            });
        }
        let inside = std::fs::canonicalize(worktree)?;
        let mut state = BTreeMap::new();
        for entry in listed.stdout.split(|byte| *byte == 0) {
            let Some(tab) = entry.iter().position(|byte| *byte == b'\t') else {
                continue;
            };
            let (meta, raw) = (&entry[..tab], &entry[tab + 1..]);
            let path = String::from_utf8_lossy(raw).into_owned();
            #[cfg(unix)]
            let local =
                worktree.join(<std::ffi::OsStr as std::os::unix::ffi::OsStrExt>::from_bytes(raw));
            #[cfg(not(unix))]
            let local = worktree.join(&path);
            match meta.split(|byte| *byte == b' ').next() {
                Some(b"120000") => {
                    if !std::fs::symlink_metadata(&local)
                        .is_ok_and(|metadata| metadata.file_type().is_symlink())
                    {
                        // Checked out as a plain file (no symlink support): Git sees it.
                        continue;
                    }
                    let target = landing(&local, 0);
                    if target
                        .as_ref()
                        .is_some_and(|target| target.starts_with(&inside))
                    {
                        // A write through it lands in the worktree, where Git reports it.
                        continue;
                    }
                    let stamp = target.as_deref().and_then(stamp);
                    state.insert(path, Unseen::Link(target, stamp));
                }
                Some(b"160000") => {
                    let entries = std::fs::read_dir(&local)
                        .map(|entries| entries.take(64).count())
                        .unwrap_or(0);
                    state.insert(path, Unseen::Gitlink(stamp(&local), entries));
                }
                _ => {}
            }
        }
        Ok(UnseenState(state))
    }

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
        let tree = self.candidate_tree(worktree, &head).await?;
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
            .bound(worktree, &["ls-files", "-v", "-z"], &overrides)
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
            .bound_expect(
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
        worktree_binding(worktree)?;
        let overrides = self.filter_overrides(worktree).await?;
        self.bound_expect(
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
    /// and verify its binding to `root` and that its HEAD is exactly that commit.
    /// Repository-selected content filters are disabled: executing them is outside
    /// the writer approval. The gitfile is written with an absolute path and
    /// submodules are never populated, whatever the developer's configuration.
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
        let mut overrides = self.filter_overrides(root).await?;
        overrides.extend([
            "worktree.useRelativePaths=false".to_owned(),
            "submodule.recurse=false".to_owned(),
        ]);
        let target = path.to_string_lossy().into_owned();
        self.expect(
            root,
            &["worktree", "add", "--detach", "--quiet", &target, commit],
            &overrides,
        )
        .await?;
        self.verify_worktree_binding(root, path).await?;
        let head = self.head_commit(path).await?;
        if head != commit {
            return Err(GitError::Command {
                command: "worktree add".into(),
                detail: format!("worktree HEAD {head} is not {commit}"),
            });
        }
        Ok(())
    }

    /// Exact HEAD of a Luuna-owned worktree, read through its verified binding.
    pub async fn head_commit(&self, worktree: &Path) -> Result<String, GitError> {
        let output = self
            .bound(worktree, &["rev-parse", "--verify", "--quiet", "HEAD"], &[])
            .await?;
        Some(String::from_utf8_lossy(&output.stdout).trim().to_owned())
            .filter(|c| output.status == Some(0) && (c.len() == 40 || c.len() == 64))
            .ok_or_else(|| GitError::Command {
                command: "rev-parse".into(),
                detail: "worktree has no HEAD commit".into(),
            })
    }

    /// Exact tree of a commit, read through a Luuna-owned worktree's binding.
    pub async fn candidate_tree(&self, worktree: &Path, commit: &str) -> Result<String, GitError> {
        require_object_id(commit)?;
        let spec = format!("{commit}^{{tree}}");
        let output = self
            .bound(worktree, &["rev-parse", "--verify", "--quiet", &spec], &[])
            .await?;
        Some(String::from_utf8_lossy(&output.stdout).trim().to_owned())
            .filter(|t| output.status == Some(0) && (t.len() == 40 || t.len() == 64))
            .ok_or_else(|| GitError::Command {
                command: "rev-parse".into(),
                detail: format!("commit {commit} has no tree"),
            })
    }

    /// Every path whose content differs from HEAD, including untracked files,
    /// files inside untracked directories and ignored files (status `!`), which
    /// `add --all` would leave out of a candidate. Output beyond the configured
    /// cap is an error: a change set too large to list is never judged in scope.
    pub async fn changed_paths(&self, worktree: &Path) -> Result<Vec<ChangedPath>, GitError> {
        worktree_binding(worktree)?;
        let overrides = self.filter_overrides(worktree).await?;
        let output = self
            .bound(
                worktree,
                &[
                    "status",
                    "--porcelain=v2",
                    "-z",
                    "--no-renames",
                    "--untracked-files=all",
                    "--ignored=matching",
                    "--ignore-submodules=none",
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
    /// Returns the new HEAD. Hooks, signing and automatic maintenance do not
    /// run; validation is a separate gate. The commit is read back: its only
    /// parent must be the previous HEAD and both identities the Luuna writer.
    pub async fn commit_all(&self, worktree: &Path, message: &str) -> Result<String, GitError> {
        let before = self.head_commit(worktree).await?;
        let overrides = self.filter_overrides(worktree).await?;
        self.bound_expect(worktree, &["add", "--all"], &overrides)
            .await?;
        // `author.*` and `committer.*` outrank `user.*`, so all of them are set.
        let mut identity = vec![
            format!("user.name={WRITER_AUTHOR_NAME}"),
            format!("user.email={WRITER_AUTHOR_EMAIL}"),
            format!("author.name={WRITER_AUTHOR_NAME}"),
            format!("author.email={WRITER_AUTHOR_EMAIL}"),
            format!("committer.name={WRITER_AUTHOR_NAME}"),
            format!("committer.email={WRITER_AUTHOR_EMAIL}"),
            "commit.gpgsign=false".to_owned(),
            "core.editor=false".to_owned(),
            "gc.auto=0".to_owned(),
            "maintenance.auto=false".to_owned(),
        ];
        identity.extend(overrides);
        self.bound_expect(
            worktree,
            &[
                "commit",
                "--quiet",
                "--no-verify",
                "--no-gpg-sign",
                "--message",
                message,
            ],
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
        // The raw object, so no pretty-format or signature-display setting runs.
        let object = self
            .bound_expect(worktree, &["cat-file", "commit", &after], &[])
            .await?;
        let headers: Vec<&str> = object.split("\n\n").next().unwrap_or("").lines().collect();
        let parents: Vec<&str> = headers
            .iter()
            .filter_map(|line| line.strip_prefix("parent "))
            .collect();
        let writer = format!("{WRITER_AUTHOR_NAME} <{WRITER_AUTHOR_EMAIL}> ");
        let by_writer = |role: &str| {
            let values: Vec<&str> = headers
                .iter()
                .filter_map(|line| line.strip_prefix(role))
                .collect();
            values.len() == 1 && values[0].starts_with(&writer)
        };
        if parents != [before.as_str()]
            || !by_writer("author ")
            || !by_writer("committer ")
            || headers.iter().any(|line| line.starts_with("gpgsig"))
        {
            return Err(GitError::Command {
                command: "commit".into(),
                detail: "the candidate commit does not have the previous HEAD as its only parent and the Luuna writer as author and committer".into(),
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

/// `git status --porcelain=v2 -z --no-renames --untracked-files=all
/// --ignored=matching` entries. An ignored directory is reported once with a
/// trailing `/`, which is dropped so the directory can be judged against scope.
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
            "!" => ("!".to_owned(), rest.strip_suffix('/').unwrap_or(rest)),
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
? untracked/dir/file.txt\0! ignored.log\0! build/\0";
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
                ("!", "ignored.log"),
                ("!", "build"),
            ]
        );
        assert!(parse_changed_paths(b"").is_empty());
    }
}
