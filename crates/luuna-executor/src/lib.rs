//! Supervised execution of confirmed check recipes (M2b).
//!
//! A recipe is an executable plus an argument array, never shell text. The
//! executor resolves the executable, verifies declared host capabilities,
//! runs the command in an explicit directory under the repository root with
//! a secret-stripped environment and a deadline, owns the whole process
//! group, streams bounded output into private artifacts, hashes them, and
//! maps the outcome to a `CheckStatus`. Native execution has host
//! permissions; nothing here is an operating-system sandbox.
use chrono::{SecondsFormat, Utc};
use luuna_domain::CheckStatus;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use thiserror::Error;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::{Child, Command},
    sync::{mpsc, watch},
};

/// Bytes kept per output stream in the private artifact; the rest is drained and counted.
pub const MAX_ARTIFACT_BYTES: u64 = 16 * 1024 * 1024;
/// Bytes of trailing output retained for display.
pub const EXCERPT_BYTES: usize = 4096;
const VERSION_PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const REAP_TIMEOUT: Duration = Duration::from_secs(10);
/// Default grace for descendants that keep a pipe open after the child exits.
pub const DRAIN_GRACE: Duration = Duration::from_secs(5);

#[derive(Debug, Error)]
pub enum ExecutorError {
    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("artifact directory is invalid: {0}")]
    Artifacts(String),
}

#[derive(Debug, Clone)]
pub struct CommandSpec {
    pub recipe_id: String,
    /// Command name resolved on `PATH`, or a repository-relative path such as `./gradlew`.
    pub executable: String,
    pub args: Vec<String>,
    /// Canonical registered repository root.
    pub repository_root: PathBuf,
    /// Working directory relative to the root; `.` is the root itself.
    pub cwd: String,
    pub timeout: Duration,
    pub capabilities: Vec<String>,
    /// Private directory that receives `<recipe>.stdout.log` and `<recipe>.stderr.log`.
    pub artifact_dir: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Artifact {
    pub name: String,
    pub path: PathBuf,
    pub sha256: String,
    pub bytes: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Execution {
    pub status: CheckStatus,
    pub exit_code: Option<i32>,
    pub reason: Option<String>,
    pub command: Vec<String>,
    pub resolved_executable: Option<PathBuf>,
    pub tool_version: Option<String>,
    pub cwd: PathBuf,
    pub pid: Option<u32>,
    pub started_at: String,
    pub finished_at: String,
    pub artifacts: Vec<Artifact>,
    pub stdout_excerpt: String,
    pub stderr_excerpt: String,
    pub tests_detected: Option<u64>,
    pub environment_fingerprint: String,
}

/// Live notifications for event streams; never authoritative state.
#[derive(Debug, Clone)]
pub enum Progress {
    Started { pid: u32, command: Vec<String> },
    Output { stream: &'static str, chunk: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Probe {
    Resolved {
        resolved: PathBuf,
        tool_version: Option<String>,
        fingerprint: String,
    },
    Unavailable(String),
}

#[derive(Debug, Clone)]
pub struct Executor {
    /// Overrides `PATH` for executable and capability resolution (tests, profiles).
    pub search_path: Option<OsString>,
    /// How long output pipes may stay open after the direct child has exited
    /// before the remaining process group is terminated and capture stops.
    pub drain_grace: Duration,
}

impl Default for Executor {
    fn default() -> Self {
        Self {
            search_path: None,
            drain_grace: DRAIN_GRACE,
        }
    }
}

/// Host capabilities a recipe may declare. Unknown names are descriptive tags.
const CAPABILITY_TOOLS: [(&str, &[&str]); 16] = [
    ("cargo", &["cargo"]),
    ("rust", &["rustc"]),
    ("clippy", &["cargo-clippy"]),
    ("node", &["node"]),
    ("npm", &["npm"]),
    ("pnpm", &["pnpm"]),
    ("yarn", &["yarn"]),
    ("bun", &["bun"]),
    ("go", &["go"]),
    ("python", &["python3", "python"]),
    ("pytest", &["pytest"]),
    ("flutter", &["flutter"]),
    ("dart", &["dart"]),
    ("jdk", &["java"]),
    ("xcode", &["xcodebuild"]),
    ("git", &["git"]),
];

const VERSION_PROBE_TOOLS: [&str; 14] = [
    "cargo", "rustc", "node", "npm", "pnpm", "yarn", "bun", "go", "python3", "python", "pytest",
    "flutter", "dart", "git",
];

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// `sha256:` plus the lower-case hex SHA-256 of `bytes`, the digest form
/// artifact identities and check results record.
pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

/// Variables that must never reach a check: Luuna's own configuration,
/// repository-redirecting Git variables and anything that looks like a credential.
pub fn is_secret_or_reserved(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    upper.starts_with("LUUNA_")
        || upper.starts_with("GIT_")
        || [
            "API_KEY",
            "APIKEY",
            "TOKEN",
            "SECRET",
            "PASSWORD",
            "PASSWD",
            "CREDENTIAL",
            "PRIVATE_KEY",
            "AUTH",
            "JWT",
            "PASSPHRASE",
            "BEARER",
            "COOKIE",
            "SESSION_KEY",
            "ACCESS_KEY",
        ]
        .iter()
        .any(|marker| upper.contains(marker))
        // A `_KEY` name (`STRIPE_KEY`, `SSH_KEY`, `AWS_ACCESS_KEY_ID`) is
        // treated as a key whatever it is for; such names are rarely anything
        // a check needs.
        || upper.ends_with("_KEY")
        || upper.contains("_KEY_")
        || upper.ends_with("_KEYS")
}

/// Every process the executor starts, probes included, sees a cleared
/// environment with Luuna configuration, `GIT_*` and credential-shaped
/// variables removed; nothing repository-controlled runs with inherited secrets.
fn sanitized_environment(command: &mut Command) -> &mut Command {
    command.env_clear().envs(
        std::env::vars_os().filter(|(name, _)| !is_secret_or_reserved(&name.to_string_lossy())),
    )
}

/// Private artifact storage: directories 0700 and files 0600 on Unix even when
/// the parent directory or umask is permissive.
fn create_private_dir(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(path)?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
    }
    #[cfg(not(unix))]
    {
        std::fs::create_dir_all(path)
    }
}

async fn create_private_file(path: &Path) -> std::io::Result<tokio::fs::File> {
    let mut options = tokio::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    options.mode(0o600);
    let file = options.open(path).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .await?;
    }
    Ok(file)
}

impl Executor {
    fn search_dirs(&self) -> Vec<PathBuf> {
        let path = self
            .search_path
            .clone()
            .or_else(|| std::env::var_os("PATH"))
            .unwrap_or_default();
        std::env::split_paths(&path).collect()
    }

    fn find_on_path(&self, name: &str) -> Option<PathBuf> {
        let candidates: Vec<String> = if cfg!(windows) {
            let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".into());
            let mut names = vec![name.to_owned()];
            names.extend(
                exts.split(';')
                    .filter(|e| !e.is_empty())
                    .map(|e| format!("{name}{}", e.to_ascii_lowercase())),
            );
            names
        } else {
            vec![name.to_owned()]
        };
        for dir in self.search_dirs() {
            for candidate in &candidates {
                let path = dir.join(candidate);
                if path.is_file() {
                    return Some(path);
                }
            }
        }
        None
    }

    /// Names of declared capabilities this host cannot satisfy.
    pub fn missing_capabilities(&self, capabilities: &[String]) -> Vec<String> {
        capabilities
            .iter()
            .filter(|capability| {
                let name = capability.as_str();
                if name == "android-sdk" {
                    return std::env::var_os("ANDROID_HOME").is_none()
                        && std::env::var_os("ANDROID_SDK_ROOT").is_none();
                }
                match CAPABILITY_TOOLS.iter().find(|(known, _)| *known == name) {
                    Some((_, tools)) => !tools.iter().any(|tool| self.find_on_path(tool).is_some()),
                    None => false,
                }
            })
            .cloned()
            .collect()
    }

    fn resolve_executable(&self, spec: &CommandSpec, cwd: &Path) -> Result<PathBuf, String> {
        let executable = &spec.executable;
        if executable.is_empty() {
            return Err("recipe has no executable".into());
        }
        let path = Path::new(executable);
        if path.is_absolute() {
            return if path.is_file() {
                Ok(path.to_path_buf())
            } else {
                Err(format!("executable {executable} does not exist"))
            };
        }
        if executable.contains('/') || executable.contains('\\') {
            let candidate = cwd.join(path);
            let canonical = std::fs::canonicalize(&candidate)
                .map_err(|_| format!("repository executable {executable} does not exist"))?;
            // Compare canonical forms: on Windows canonicalize yields a verbatim
            // `\\?\` path that would never start with the plain repository root.
            let root = std::fs::canonicalize(&spec.repository_root)
                .unwrap_or_else(|_| spec.repository_root.clone());
            if !canonical.starts_with(&root) || !canonical.is_file() {
                return Err(format!(
                    "repository executable {executable} resolves outside the repository"
                ));
            }
            return Ok(canonical);
        }
        self.find_on_path(executable)
            .ok_or_else(|| format!("executable {executable} was not found on PATH"))
    }

    async fn tool_version(&self, resolved: &Path, name: &str) -> Option<String> {
        if !VERSION_PROBE_TOOLS.contains(&name) {
            return None;
        }
        let mut command = Command::new(resolved);
        sanitized_environment(&mut command)
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let output = tokio::time::timeout(VERSION_PROBE_TIMEOUT, command.output())
            .await
            .ok()?
            .ok()?;
        let text = if output.stdout.is_empty() {
            output.stderr
        } else {
            output.stdout
        };
        String::from_utf8_lossy(&text)
            .lines()
            .next()
            .map(|line| line.trim().chars().take(200).collect())
    }

    /// Resolve a recipe's executable and tool version without running the recipe.
    /// Used to fingerprint the environment before a baseline starts.
    pub async fn probe(&self, spec: &CommandSpec) -> Probe {
        let missing = self.missing_capabilities(&spec.capabilities);
        if !missing.is_empty() {
            return Probe::Unavailable(format!("incapable host: missing {}", missing.join(", ")));
        }
        let cwd = match resolve_cwd(&spec.repository_root, &spec.cwd) {
            Ok(cwd) => cwd,
            Err(reason) => return Probe::Unavailable(reason),
        };
        let resolved = match self.resolve_executable(spec, &cwd) {
            Ok(resolved) => resolved,
            Err(reason) => return Probe::Unavailable(reason),
        };
        let tool_name = Path::new(&spec.executable)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let tool_version = self.tool_version(&resolved, &tool_name).await;
        Probe::Resolved {
            fingerprint: Self::fingerprint(&resolved, tool_version.as_deref()),
            resolved,
            tool_version,
        }
    }

    /// One fingerprint for a set of recipes: order-independent over their parts.
    pub fn combine_fingerprints(parts: &[String]) -> String {
        let mut sorted = parts.to_vec();
        sorted.sort();
        sorted.dedup();
        let identity = serde_json::json!({
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "parts": sorted,
        });
        sha256_hex(identity.to_string().as_bytes())
    }

    /// Deterministic identity of the execution environment that produced evidence.
    pub fn fingerprint(resolved: &Path, tool_version: Option<&str>) -> String {
        let identity = serde_json::json!({
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "executable": resolved.to_string_lossy(),
            "tool_version": tool_version,
        });
        sha256_hex(identity.to_string().as_bytes())
    }

    /// Run one recipe. Never returns a process failure as success; every
    /// non-zero exit, deadline, cancellation or missing prerequisite maps to a
    /// non-passing status with a recorded reason.
    pub async fn execute(
        &self,
        spec: &CommandSpec,
        mut cancel: watch::Receiver<bool>,
        progress: Option<mpsc::UnboundedSender<Progress>>,
    ) -> Result<Execution, ExecutorError> {
        let started_at = now();
        let mut command_line = vec![spec.executable.clone()];
        command_line.extend(spec.args.iter().cloned());
        let blocked = |reason: String, cwd: PathBuf, fingerprint: String| Execution {
            status: CheckStatus::Blocked,
            exit_code: None,
            reason: Some(reason),
            command: command_line.clone(),
            resolved_executable: None,
            tool_version: None,
            cwd,
            pid: None,
            started_at: started_at.clone(),
            finished_at: now(),
            artifacts: Vec::new(),
            stdout_excerpt: String::new(),
            stderr_excerpt: String::new(),
            tests_detected: None,
            environment_fingerprint: fingerprint,
        };
        let host_fingerprint = Self::fingerprint(Path::new("<unresolved>"), None);
        // Working directory must stay inside the registered root.
        let cwd = match resolve_cwd(&spec.repository_root, &spec.cwd) {
            Ok(cwd) => cwd,
            Err(reason) => {
                return Ok(blocked(
                    reason,
                    spec.repository_root.clone(),
                    host_fingerprint,
                ))
            }
        };
        let missing = self.missing_capabilities(&spec.capabilities);
        if !missing.is_empty() {
            return Ok(blocked(
                format!("incapable host: missing {}", missing.join(", ")),
                cwd,
                host_fingerprint,
            ));
        }
        let resolved = match self.resolve_executable(spec, &cwd) {
            Ok(resolved) => resolved,
            Err(reason) => return Ok(blocked(reason, cwd, host_fingerprint)),
        };
        let tool_name = Path::new(&spec.executable)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let tool_version = self.tool_version(&resolved, &tool_name).await;
        let fingerprint = Self::fingerprint(&resolved, tool_version.as_deref());

        create_private_dir(&spec.artifact_dir)?;
        let stdout_path = spec
            .artifact_dir
            .join(format!("{}.stdout.log", spec.recipe_id));
        let stderr_path = spec
            .artifact_dir
            .join(format!("{}.stderr.log", spec.recipe_id));

        let mut command = Command::new(&resolved);
        sanitized_environment(&mut command)
            .args(&spec.args)
            .current_dir(&cwd)
            .env("CI", "true")
            .env("LUUNA_CHECK", &spec.recipe_id)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);
        // If the runtime itself dies, Linux delivers SIGKILL to the direct child so
        // a check cannot outlive its supervisor; grandchildren rely on the group kill.
        #[cfg(target_os = "linux")]
        // SAFETY: prctl only changes this child's parent-death signal before exec.
        unsafe {
            command.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
                Ok(())
            });
        }
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                return Ok(blocked(
                    format!("cannot start {}: {error}", resolved.display()),
                    cwd,
                    fingerprint,
                ))
            }
        };
        let pid = child.id();
        if let (Some(sender), Some(pid)) = (&progress, pid) {
            let _ = sender.send(Progress::Started {
                pid,
                command: command_line.clone(),
            });
        }
        let stdout_pipe = child.stdout.take().expect("stdout piped");
        let stderr_pipe = child.stderr.take().expect("stderr piped");
        let stdout_task = tokio::spawn(capture(
            stdout_pipe,
            stdout_path.clone(),
            "stdout",
            progress.clone(),
        ));
        let stderr_task = tokio::spawn(capture(
            stderr_pipe,
            stderr_path.clone(),
            "stderr",
            progress.clone(),
        ));

        enum Outcome {
            Exited(std::process::ExitStatus),
            Cancelled,
            Timeout,
            WaitFailed(String),
        }
        let outcome = tokio::select! {
            biased;
            _ = cancel.changed() => Outcome::Cancelled,
            waited = tokio::time::timeout(spec.timeout, child.wait()) => match waited {
                Ok(Ok(status)) => Outcome::Exited(status),
                Ok(Err(error)) => Outcome::WaitFailed(error.to_string()),
                Err(_) => Outcome::Timeout,
            },
        };
        if !matches!(outcome, Outcome::Exited(_)) {
            terminate(&mut child, pid).await;
        }
        // The pipes close only when every holder exits. A descendant that
        // inherited them must not keep the baseline open: after the grace the
        // whole group is terminated, and capture is abandoned if it still hangs.
        let mut stdout_task = stdout_task;
        let mut stderr_task = stderr_task;
        let mut stdout_slot = None;
        let mut stderr_slot = None;
        let drained = tokio::select! {
            biased;
            _ = cancel.changed(), if !matches!(outcome, Outcome::Cancelled) => false,
            joined = tokio::time::timeout(self.drain_grace, async {
                settle(&mut stdout_task, &mut stdout_slot).await;
                settle(&mut stderr_task, &mut stderr_slot).await;
            }) => joined.is_ok(),
        };
        let held_open = !drained;
        if held_open {
            terminate(&mut child, pid).await;
            let _ = tokio::time::timeout(REAP_TIMEOUT, async {
                settle(&mut stdout_task, &mut stdout_slot).await;
                settle(&mut stderr_task, &mut stderr_slot).await;
            })
            .await;
            for (task, slot, name) in [
                (&stdout_task, &mut stdout_slot, "stdout"),
                (&stderr_task, &mut stderr_slot, "stderr"),
            ] {
                if slot.is_none() {
                    task.abort();
                    *slot = Some(Err(format!(
                        "{name} pipe was held open by a surviving descendant"
                    )));
                }
            }
        }
        let stdout_capture = stdout_slot.unwrap_or_else(|| Err("stdout capture lost".into()));
        let stderr_capture = stderr_slot.unwrap_or_else(|| Err("stderr capture lost".into()));
        let finished_at = now();
        let mut artifacts = Vec::new();
        let mut excerpts = [String::new(), String::new()];
        let mut capture_error = None;
        for (index, (capture, path, name)) in [
            (stdout_capture, &stdout_path, "stdout"),
            (stderr_capture, &stderr_path, "stderr"),
        ]
        .into_iter()
        .enumerate()
        {
            match capture {
                Ok(captured) => {
                    excerpts[index] = captured.excerpt;
                    artifacts.push(Artifact {
                        name: name.into(),
                        path: path.clone(),
                        sha256: captured.sha256,
                        bytes: captured.bytes,
                        truncated: captured.truncated,
                    });
                }
                Err(error) => capture_error = Some(error),
            }
        }
        let tests_detected = detect_tests(&stdout_path, &stderr_path);
        // Cancellation and the deadline are authoritative outcomes; a capture
        // problem (for example a descendant still holding a pipe on a host without
        // process groups) is recorded in the reason, never as a different status.
        let capture_note = capture_error
            .as_deref()
            .map(|error| format!("; output capture incomplete: {error}"))
            .unwrap_or_default();
        let (status, exit_code, reason) = match outcome {
            Outcome::Cancelled => (
                CheckStatus::Cancelled,
                None,
                Some(format!(
                    "cancelled; process group terminated and reaped{capture_note}"
                )),
            ),
            Outcome::Timeout => (
                CheckStatus::Failed,
                None,
                Some(format!(
                    "deadline of {}s exceeded; process group terminated{capture_note}",
                    spec.timeout.as_secs()
                )),
            ),
            _ if capture_error.is_some() => (
                CheckStatus::Failed,
                None,
                Some(format!(
                    "output capture failed: {}",
                    capture_error.unwrap_or_default()
                )),
            ),
            Outcome::Exited(status) if held_open => (
                CheckStatus::Failed,
                status.code(),
                Some(format!(
                    "a descendant process kept the output open for {}s after the command exited; process group terminated",
                    self.drain_grace.as_secs()
                )),
            ),
            Outcome::WaitFailed(error) => (CheckStatus::Failed, None, Some(error)),
            Outcome::Exited(status) => match status.code() {
                Some(0) if tests_detected == Some(0) => (
                    CheckStatus::Blocked,
                    Some(0),
                    Some("empty suite: the command succeeded but ran no tests".into()),
                ),
                Some(0) => (CheckStatus::Passed, Some(0), None),
                Some(code) => (
                    CheckStatus::Failed,
                    Some(code),
                    Some(format!("exit code {code}")),
                ),
                None => (
                    CheckStatus::Failed,
                    None,
                    Some("terminated by signal".into()),
                ),
            },
        };
        let [stdout_excerpt, stderr_excerpt] = excerpts;
        Ok(Execution {
            status,
            exit_code,
            reason,
            command: command_line,
            resolved_executable: Some(resolved),
            tool_version,
            cwd,
            pid,
            started_at,
            finished_at,
            artifacts,
            stdout_excerpt,
            stderr_excerpt,
            tests_detected,
            environment_fingerprint: fingerprint,
        })
    }
}

fn resolve_cwd(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty()
        || relative.starts_with('/')
        || relative.contains('\\')
        || relative
            .split('/')
            .any(|part| part.is_empty() || part == "..")
    {
        return Err(format!(
            "recipe cwd {relative:?} must be `.` or a relative path"
        ));
    }
    let joined = if relative == "." {
        root.to_path_buf()
    } else {
        root.join(relative)
    };
    let canonical = std::fs::canonicalize(&joined)
        .map_err(|_| format!("recipe cwd {relative} does not exist in the repository"))?;
    let canonical_root =
        std::fs::canonicalize(root).map_err(|_| "repository root does not exist".to_owned())?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_dir() {
        return Err(format!("recipe cwd {relative} escapes the repository"));
    }
    Ok(canonical)
}

/// Stop the owned process group (Unix) or the child (elsewhere) and reap it.
async fn terminate(child: &mut Child, pid: Option<u32>) {
    #[cfg(unix)]
    if let Some(pid) = pid {
        // SAFETY: killpg on a process-group ID we created with process_group(0).
        unsafe {
            libc::killpg(pid as libc::pid_t, libc::SIGKILL);
        }
    }
    // Windows has no process groups here; the direct child is killed below.
    #[cfg(not(unix))]
    let _ = pid;
    let _ = child.start_kill();
    let _ = tokio::time::timeout(REAP_TIMEOUT, child.wait()).await;
}

/// Await a capture task once, keeping its result; a settled slot is never re-polled.
async fn settle(
    task: &mut tokio::task::JoinHandle<Result<Captured, String>>,
    slot: &mut Option<Result<Captured, String>>,
) {
    if slot.is_none() {
        *slot = Some(task.await.unwrap_or_else(|e| Err(e.to_string())));
    }
}

struct Captured {
    sha256: String,
    bytes: u64,
    truncated: bool,
    excerpt: String,
}

/// Stream one pipe into a bounded artifact file, keeping a trailing excerpt and
/// forwarding display chunks. Draining continues past the limit so the child
/// never blocks on a full pipe.
async fn capture(
    mut pipe: impl tokio::io::AsyncRead + Unpin,
    path: PathBuf,
    stream: &'static str,
    progress: Option<mpsc::UnboundedSender<Progress>>,
) -> Result<Captured, String> {
    let mut file = create_private_file(&path)
        .await
        .map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut total: u64 = 0;
    let mut written: u64 = 0;
    let mut truncated = false;
    let mut tail: Vec<u8> = Vec::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = pipe.read(&mut buffer).await.map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        let chunk = &buffer[..read];
        total += read as u64;
        if written < MAX_ARTIFACT_BYTES {
            let allowed = ((MAX_ARTIFACT_BYTES - written) as usize).min(read);
            file.write_all(&chunk[..allowed])
                .await
                .map_err(|e| e.to_string())?;
            hasher.update(&chunk[..allowed]);
            written += allowed as u64;
            if allowed < read {
                truncated = true;
            }
        } else {
            truncated = true;
        }
        tail.extend_from_slice(chunk);
        if tail.len() > EXCERPT_BYTES {
            let drop = tail.len() - EXCERPT_BYTES;
            tail.drain(..drop);
        }
        if let Some(sender) = &progress {
            let text = String::from_utf8_lossy(chunk)
                .chars()
                .take(EXCERPT_BYTES)
                .collect();
            let _ = sender.send(Progress::Output {
                stream,
                chunk: text,
            });
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(Captured {
        sha256: format!("sha256:{:x}", hasher.finalize()),
        bytes: total,
        truncated,
        excerpt: String::from_utf8_lossy(&tail).into_owned(),
    })
}

/// Count tests from well-known runner summaries. `Some(0)` means a recognised
/// runner reported that nothing ran; `None` means no runner summary was seen.
pub fn detect_tests_in(text: &str) -> Option<u64> {
    let mut found = false;
    let mut total: u64 = 0;
    for line in text.lines() {
        let line = line.trim();
        // cargo: "test result: ok. 12 passed; 0 failed; 1 ignored; ..."
        if let Some(rest) = line.strip_prefix("test result:") {
            found = true;
            for field in rest.split(';') {
                let mut words = field.split_whitespace();
                let first = words.next().and_then(|w| w.parse::<u64>().ok());
                let first = first.or_else(|| {
                    field
                        .split_whitespace()
                        .nth(1)
                        .and_then(|w| w.parse::<u64>().ok())
                });
                if let (Some(n), true) =
                    (first, field.contains("passed") || field.contains("failed"))
                {
                    total += n;
                }
            }
            continue;
        }
        // go: "ok  \tpkg\t0.1s" counts; "?   \tpkg\t[no test files]" does not.
        if (line.starts_with("ok") || line.starts_with("FAIL") || line.starts_with("---"))
            && line.contains('\t')
        {
            found = true;
            if !line.contains("[no test files]")
                && (line.starts_with("ok") || line.starts_with("FAIL"))
            {
                total += 1;
            }
            continue;
        }
        if line.starts_with('?') && line.contains("[no test files]") {
            found = true;
            continue;
        }
        // pytest: "=== 3 passed in 0.1s ===" / "no tests ran"
        if line.contains("no tests ran") {
            found = true;
            continue;
        }
        // unittest: "Ran 3 tests in 0.002s" / "Ran 1 test in 0.000s" / "NO TESTS RAN"
        // (Python 3.12+ prints the latter for an empty suite and exits 5).
        if let Some(rest) = line.strip_prefix("Ran ") {
            let mut words = rest.split_whitespace();
            if let (Some(Ok(n)), Some("test" | "tests")) =
                (words.next().map(str::parse::<u64>), words.next())
            {
                found = true;
                total += n;
                continue;
            }
        }
        if line == "NO TESTS RAN" {
            found = true;
            continue;
        }
        // vitest/jest: "Tests  13 passed (13)" / "No test files found"
        if line.contains("No test files found") || line.contains("No tests found") {
            found = true;
            continue;
        }
        if let Some(rest) = line.strip_prefix("Tests") {
            let numbers: Vec<u64> = rest
                .split(|c: char| !c.is_ascii_digit())
                .filter_map(|n| n.parse().ok())
                .collect();
            if rest.contains("passed") || rest.contains("failed") {
                found = true;
                total += numbers.last().copied().unwrap_or(0);
                continue;
            }
        }
        if line.starts_with("===") && (line.contains(" passed") || line.contains(" failed")) {
            found = true;
            for word in line.split_whitespace() {
                if let Ok(n) = word.parse::<u64>() {
                    total += n;
                }
            }
        }
    }
    found.then_some(total)
}

fn detect_tests(stdout: &Path, stderr: &Path) -> Option<u64> {
    let read = |path: &Path| std::fs::read(path).unwrap_or_default();
    let mut text = String::from_utf8_lossy(&read(stdout)).into_owned();
    text.push('\n');
    text.push_str(&String::from_utf8_lossy(&read(stderr)));
    detect_tests_in(&text)
}

/// Artifact reference the API exposes; it names records, never filesystem paths.
pub fn artifact_ref(run_id: &str, recipe_id: &str, stream: &str) -> String {
    format!("artifact:{run_id}:{recipe_id}:{stream}")
}

pub fn artifact_hashes(execution: &Execution) -> BTreeMap<String, String> {
    execution
        .artifacts
        .iter()
        .map(|a| (a.name.clone(), a.sha256.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_runner_summaries_and_empty_suites() {
        assert_eq!(
            detect_tests_in(
                "running 3 tests\ntest result: ok. 3 passed; 0 failed; 0 ignored; 0 measured\n"
            ),
            Some(3)
        );
        assert_eq!(
            detect_tests_in("test result: ok. 0 passed; 0 failed; 0 ignored\ntest result: ok. 0 passed; 0 failed; 0 ignored\n"),
            Some(0)
        );
        assert_eq!(
            detect_tests_in("ok  \texample.invalid/x\t0.012s\n"),
            Some(1)
        );
        assert_eq!(
            detect_tests_in("?   \texample.invalid/x\t[no test files]\n"),
            Some(0)
        );
        assert_eq!(
            detect_tests_in("============ no tests ran in 0.01s ============\n"),
            Some(0)
        );
        assert_eq!(
            detect_tests_in("=========== 4 passed, 1 failed in 0.3s ===========\n"),
            Some(5)
        );
        assert_eq!(detect_tests_in("      Tests  13 passed (13)\n"), Some(13));
        assert_eq!(
            detect_tests_in(
                "test_greeting (test_messages.MessagesTest.test_greeting) ... ok\n\n----------------------------------------------------------------------\nRan 2 tests in 0.001s\n\nOK\n"
            ),
            Some(2)
        );
        assert_eq!(
            detect_tests_in("Ran 1 test in 0.000s\n\nFAILED (failures=1)\n"),
            Some(1)
        );
        assert_eq!(
            detect_tests_in("Ran 0 tests in 0.000s\n\nNO TESTS RAN\n"),
            Some(0)
        );
        assert_eq!(detect_tests_in("Ran out of disk space\n"), None);
        assert_eq!(detect_tests_in("Ran 3 testers in the room\n"), None);
        assert_eq!(
            detect_tests_in("No test files found, exiting with code 1\n"),
            Some(0)
        );
        assert_eq!(detect_tests_in("hello world\n"), None);
    }

    #[test]
    fn secrets_and_reserved_variables_are_stripped() {
        for name in [
            "OPENROUTER_API_KEY",
            "GITHUB_TOKEN",
            "LUUNA_API_TOKEN",
            "GIT_DIR",
            "AWS_SECRET_ACCESS_KEY",
            "DB_PASSWORD",
            "LUUNA_PI_COMMAND",
            "CI_JOB_JWT",
            "AWS_ACCESS_KEY_ID",
            "STRIPE_KEY",
            "SIGNING_KEYS",
            "GPG_PASSPHRASE",
            "SESSION_COOKIE",
        ] {
            assert!(is_secret_or_reserved(name), "{name}");
        }
        for name in [
            "PATH",
            "HOME",
            "CARGO_HOME",
            "RUSTUP_HOME",
            "NODE_ENV",
            "TMPDIR",
            "KEYBOARD_LAYOUT",
            "MONKEY_COUNT",
        ] {
            assert!(!is_secret_or_reserved(name), "{name}");
        }
    }
}
