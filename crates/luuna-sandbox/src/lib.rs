//! The project sandbox (ADR 0036): a plan the runtime computes from a project's
//! registered repositories, and the launcher that applies it with an actual
//! operating-system boundary.
//!
//! - Linux: `bwrap --unshare-all`, each repository bound read-write at its own
//!   host path, system and toolchain directories read-only, a private `$HOME`.
//! - macOS: `sandbox-exec` with a generated `(deny default)` Seatbelt profile.
//! - Windows: an AppContainer whose SID is granted only the repositories, the
//!   sandbox home, a synthetic root of junctions and toolchain directories.
//!
//! The runtime decides what a sandbox may reach ([`plan`]); the launcher
//! ([`launch`]) only applies a plan. Neither limits CPU, memory or the secrets
//! already present in the inherited environment.
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use thiserror::Error;

pub mod bwrap;
pub mod launch;
pub mod seatbelt;
#[cfg(windows)]
pub mod windows;

/// Version of the plan document the launcher accepts.
pub const PLAN_VERSION: u32 = 1;
/// Environment variable that carries a plan document to `luuna-sbx`.
pub const PLAN_VARIABLE: &str = "LUUNA_SBX_PLAN";
/// Variables a sandboxed process never inherits: the plan carrier and the
/// runtime's credentials, with which an agent could drive the runtime API.
pub const WITHHELD: &[&str] = &[PLAN_VARIABLE, "LUUNA_API_TOKEN", "LUUNA_URL"];
/// Longest AppContainer name Windows accepts.
const MAX_CONTAINER_NAME: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Backend {
    Bwrap,
    Seatbelt,
    AppContainer,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Network {
    #[default]
    Open,
    None,
}

impl Network {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "open" => Some(Self::Open),
            "none" => Some(Self::None),
            _ => None,
        }
    }
}

/// One repository the sandbox may read and write.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SandboxRepository {
    pub repository_id: String,
    /// Canonical checkout path on the host.
    pub host_path: String,
    /// Where the sandboxed process sees it: the host path itself on Linux and
    /// macOS, a junction under the synthetic root on Windows.
    pub sandbox_path: String,
}

/// What a sandbox for one project may reach, as the runtime decided it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SandboxPlan {
    pub version: u32,
    pub project_id: String,
    pub backend: Backend,
    pub available: bool,
    /// Why the backend cannot run on this host, when it cannot.
    pub reason: Option<String>,
    /// Directory the sandboxed process starts in.
    pub workdir: String,
    /// Windows only: the host directory holding one junction per repository.
    pub host_root: Option<String>,
    /// Host path of the private home directory (`$HOME` inside).
    pub home: String,
    pub repositories: Vec<SandboxRepository>,
    pub network: Network,
    /// Windows only: the AppContainer profile name.
    pub container_name: Option<String>,
    /// Limits stated with the plan, for every client to show.
    pub notes: Vec<String>,
}

#[derive(Debug, Error)]
pub enum SandboxError {
    #[error("sandbox plan is invalid: {0}")]
    InvalidPlan(String),
    #[error("{0}")]
    Unavailable(String),
    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Platform(String),
}

/// The host this launcher was built for.
pub fn host_backend() -> Backend {
    if cfg!(target_os = "linux") {
        Backend::Bwrap
    } else if cfg!(target_os = "macos") {
        Backend::Seatbelt
    } else if cfg!(windows) {
        Backend::AppContainer
    } else {
        Backend::Unavailable
    }
}

/// The AppContainer profile name for a project: `luuna.sbx.<project>`, at most
/// 64 characters.
pub fn container_name(project_id: &str) -> String {
    let mut name = format!("luuna.sbx.{project_id}");
    name.truncate(MAX_CONTAINER_NAME);
    name
}

/// Compute the plan for `repositories` (`(id, canonical host path)`, present
/// checkouts only). `sandbox_dir` is the runtime-owned
/// `<data>/sandboxes/<project>` directory; the home and, on Windows, the
/// synthetic root live under it.
pub fn plan(
    project_id: &str,
    repositories: &[(String, PathBuf)],
    sandbox_dir: &Path,
    network: Network,
    backend: Backend,
) -> SandboxPlan {
    let home = sandbox_dir.join("home");
    let mut notes = vec![
        "The sandbox limits files, not the secrets already in your environment.".to_owned(),
        "No CPU or memory limit is applied.".to_owned(),
    ];
    let (workdir, host_root, mapped) = match backend {
        Backend::AppContainer => {
            let root = sandbox_dir.join("root");
            let mapped = repositories
                .iter()
                .map(|(id, path)| SandboxRepository {
                    repository_id: id.clone(),
                    host_path: display(path),
                    sandbox_path: display(&root.join(id)),
                })
                .collect();
            notes.push("The first launch grants this sandbox access to each repository; on a large checkout that can take minutes. `luuna-sbx revoke` removes the grants.".to_owned());
            (display(&root), Some(display(&root)), mapped)
        }
        _ => {
            let mapped = repositories
                .iter()
                .map(|(id, path)| SandboxRepository {
                    repository_id: id.clone(),
                    host_path: display(path),
                    sandbox_path: display(path),
                })
                .collect();
            let parents: Vec<PathBuf> = repositories
                .iter()
                .map(|(_, path)| path.parent().unwrap_or(path).to_path_buf())
                .collect();
            let workdir = common_ancestor(&parents)
                .map(|p| display(&p))
                .unwrap_or_else(|| display(&home));
            (workdir, None, mapped)
        }
    };
    if backend == Backend::Seatbelt {
        notes.push(
            "macOS has no network namespace; the profile allows or denies all network access."
                .to_owned(),
        );
    }
    let (available, reason) = match backend {
        Backend::Unavailable => (
            false,
            Some("this host has no supported sandbox backend".to_owned()),
        ),
        _ if repositories.is_empty() => (
            false,
            Some("the project has no present checkout to sandbox; run orbit sync first".to_owned()),
        ),
        Backend::Bwrap if find_on_path("bwrap").is_none() => (
            false,
            Some("bubblewrap (bwrap) is not installed; install it with your package manager (for example `sudo apt install bubblewrap`)".to_owned()),
        ),
        Backend::Seatbelt if !Path::new(seatbelt::SANDBOX_EXEC).is_file() => (
            false,
            Some(format!("{} is not present", seatbelt::SANDBOX_EXEC)),
        ),
        _ => (true, None),
    };
    SandboxPlan {
        version: PLAN_VERSION,
        project_id: project_id.to_owned(),
        backend,
        available,
        reason,
        workdir,
        host_root,
        home: display(&home),
        repositories: mapped,
        network,
        container_name: (backend == Backend::AppContainer).then(|| container_name(project_id)),
        notes,
    }
}

impl SandboxPlan {
    /// Structural checks a launcher applies before acting on a plan it read.
    pub fn validate(&self) -> Result<(), SandboxError> {
        let invalid = |m: &str| Err(SandboxError::InvalidPlan(m.to_owned()));
        if self.version != PLAN_VERSION {
            return invalid("unsupported plan version");
        }
        if !self.available {
            return Err(SandboxError::Unavailable(
                self.reason
                    .clone()
                    .unwrap_or_else(|| "the sandbox is not available on this host".to_owned()),
            ));
        }
        if self.backend != host_backend() {
            return invalid("the plan was made for another kind of host");
        }
        if self.repositories.is_empty() {
            return invalid("a plan needs at least one repository");
        }
        for path in std::iter::once(&self.home)
            .chain(std::iter::once(&self.workdir))
            .chain(self.repositories.iter().map(|r| &r.host_path))
            .chain(self.repositories.iter().map(|r| &r.sandbox_path))
        {
            if !absolute_clean(Path::new(path)) {
                return invalid("every plan path must be absolute and free of `..`");
            }
        }
        for repository in &self.repositories {
            if !valid_id(&repository.repository_id) {
                return invalid("repository ids must be lowercase letters, digits and dashes");
            }
            let host = Path::new(&repository.host_path);
            if host == Path::new("/") || host.parent().is_none() {
                return invalid("a filesystem root cannot be sandboxed as a repository");
            }
        }
        Ok(())
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

fn absolute_clean(path: &Path) -> bool {
    path.is_absolute()
        && !path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
}

/// The deepest directory containing every path; `None` when they share only a
/// filesystem root (or there are none).
pub fn common_ancestor(paths: &[PathBuf]) -> Option<PathBuf> {
    let first = paths.first()?;
    let mut common: Vec<Component> = first.components().collect();
    for path in &paths[1..] {
        let parts: Vec<Component> = path.components().collect();
        let shared = common
            .iter()
            .zip(&parts)
            .take_while(|(a, b)| a == b)
            .count();
        common.truncate(shared);
    }
    let ancestor: PathBuf = common.iter().collect();
    // A bare root (`/`, `C:\`) would expose the whole filesystem's listing.
    (ancestor.parent().is_some()).then_some(ancestor)
}

/// The path as text, without Windows' `\\?\` verbatim prefix.
pub fn display(path: &Path) -> String {
    let text = path.to_string_lossy();
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned()
}

/// The first `name` on `PATH` that is a file.
pub fn find_on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let extensions: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".into())
            .split(';')
            .map(|e| e.to_ascii_lowercase())
            .chain(std::iter::once(String::new()))
            .collect()
    } else {
        vec![String::new()]
    };
    for dir in std::env::split_paths(&path) {
        if !dir.is_absolute() {
            continue;
        }
        for extension in &extensions {
            let candidate = dir.join(format!("{name}{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Directories on `PATH` the sandboxed process should still be able to run
/// tools from (read-only), excluding those a backend already covers, those
/// inside a repository and the sandbox's own directories.
pub fn toolchain_dirs(
    plan: &SandboxPlan,
    covered: &[&str],
    skipped_prefixes: &[&str],
) -> Vec<PathBuf> {
    let Some(path) = std::env::var_os("PATH") else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = Vec::new();
    for dir in std::env::split_paths(&path) {
        if !dir.is_absolute() || !dir.is_dir() {
            continue;
        }
        let dir = std::fs::canonicalize(&dir)
            .map(|d| PathBuf::from(display(&d)))
            .unwrap_or(dir);
        let inside = |root: &str| dir.starts_with(root);
        if covered.iter().any(|root| inside(root))
            || skipped_prefixes.iter().any(|root| inside(root))
            || plan.repositories.iter().any(|r| inside(&r.host_path))
            || inside(&plan.home)
            || out.iter().any(|seen| dir.starts_with(seen))
        {
            continue;
        }
        out.retain(|seen| !seen.starts_with(&dir));
        out.push(dir);
    }
    out
}

/// The environment the sandboxed process receives: the launcher's own minus
/// the plan carrier, with the home variables pointed into the sandbox home.
pub fn sandbox_environment(plan: &SandboxPlan, home_inside: &str) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = std::env::vars()
        .filter(|(name, _)| {
            let upper = name.to_ascii_uppercase();
            !matches!(
                upper.as_str(),
                "HOME"
                    | "USERPROFILE"
                    | "APPDATA"
                    | "LOCALAPPDATA"
                    | "TEMP"
                    | "TMP"
                    | "TMPDIR"
                    | "XDG_CONFIG_HOME"
                    | "XDG_DATA_HOME"
                    | "XDG_CACHE_HOME"
                    | "XDG_STATE_HOME"
            ) && !WITHHELD.contains(&upper.as_str())
        })
        .collect();
    let join = |leaf: &str| {
        if cfg!(windows) {
            format!(r"{home_inside}\{leaf}")
        } else {
            format!("{home_inside}/{leaf}")
        }
    };
    env.push(("HOME".into(), home_inside.into()));
    if cfg!(windows) {
        env.push(("USERPROFILE".into(), home_inside.into()));
        env.push(("APPDATA".into(), join(r"AppData\Roaming")));
        env.push(("LOCALAPPDATA".into(), join(r"AppData\Local")));
        env.push(("TEMP".into(), join("Temp")));
        env.push(("TMP".into(), join("Temp")));
    } else {
        env.push(("TMPDIR".into(), "/tmp".into()));
    }
    env.push(("LUUNA_SANDBOX".into(), "1".into()));
    env.push(("LUUNA_SANDBOX_PROJECT".into(), plan.project_id.clone()));
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn repos(paths: &[&str]) -> Vec<(String, PathBuf)> {
        paths
            .iter()
            .enumerate()
            .map(|(i, p)| (format!("r{i}"), PathBuf::from(p)))
            .collect()
    }

    #[test]
    #[cfg(unix)]
    fn workdir_is_the_common_parent_of_the_repositories() {
        let plan = plan(
            "luuna",
            &repos(&["/home/dev/github/luuna", "/home/dev/github/luuna-atlas"]),
            Path::new("/data/sandboxes/luuna"),
            Network::Open,
            Backend::Bwrap,
        );
        assert_eq!(plan.workdir, "/home/dev/github");
        assert_eq!(plan.home, "/data/sandboxes/luuna/home");
        assert_eq!(
            plan.repositories[1].sandbox_path,
            "/home/dev/github/luuna-atlas"
        );
        let single = super::plan(
            "solo",
            &repos(&["/home/dev/github/luuna"]),
            Path::new("/data/sandboxes/solo"),
            Network::None,
            Backend::Bwrap,
        );
        assert_eq!(single.workdir, "/home/dev/github");
        // Repositories that share only `/` start in the home, never at the root.
        let apart = super::plan(
            "apart",
            &repos(&["/srv/a", "/opt/b"]),
            Path::new("/data/sandboxes/apart"),
            Network::Open,
            Backend::Bwrap,
        );
        assert_eq!(apart.workdir, "/data/sandboxes/apart/home");
    }

    #[test]
    fn appcontainer_plans_map_repositories_under_a_synthetic_root() {
        let dir = PathBuf::from(if cfg!(windows) {
            r"C:\data\sandboxes\luuna"
        } else {
            "/data/sandboxes/luuna"
        });
        let repo = PathBuf::from(if cfg!(windows) {
            r"C:\Users\dev\github\luuna"
        } else {
            "/home/dev/github/luuna"
        });
        let plan = plan(
            "luuna",
            &[("luuna".into(), repo)],
            &dir,
            Network::Open,
            Backend::AppContainer,
        );
        assert_eq!(
            plan.host_root.as_deref(),
            Some(display(&dir.join("root")).as_str())
        );
        assert_eq!(
            plan.repositories[0].sandbox_path,
            display(&dir.join("root").join("luuna"))
        );
        assert_eq!(plan.container_name.as_deref(), Some("luuna.sbx.luuna"));
        assert!(plan.available);
    }

    #[test]
    fn plans_without_a_checkout_are_unavailable_and_say_why() {
        let plan = plan(
            "empty",
            &[],
            Path::new("/data/x"),
            Network::Open,
            Backend::AppContainer,
        );
        assert!(!plan.available);
        assert!(plan.reason.unwrap().contains("orbit sync"));
    }

    #[test]
    fn container_names_are_bounded() {
        assert_eq!(container_name(&"a".repeat(80)).len(), 64);
    }

    #[test]
    fn validation_refuses_relative_parent_and_foreign_plans() {
        let dir = std::env::temp_dir();
        let repo = dir.join("repo");
        let mut plan = plan(
            "p",
            &[("app".into(), repo)],
            &dir,
            Network::Open,
            host_backend(),
        );
        plan.available = true;
        plan.reason = None;
        assert!(plan.validate().is_ok(), "{:?}", plan.validate());
        let mut relative = plan.clone();
        relative.repositories[0].host_path = "relative/path".into();
        assert!(relative.validate().is_err());
        let mut parent = plan.clone();
        parent.repositories[0].host_path = display(&dir.join("..").join("x"));
        assert!(parent.validate().is_err());
        let mut bad_id = plan.clone();
        bad_id.repositories[0].repository_id = "../x".into();
        assert!(bad_id.validate().is_err());
        let mut unavailable = plan.clone();
        unavailable.available = false;
        unavailable.reason = Some("no bwrap".into());
        assert!(
            matches!(unavailable.validate(), Err(SandboxError::Unavailable(r)) if r == "no bwrap")
        );
    }

    #[test]
    fn environment_points_home_into_the_sandbox_and_drops_the_plan() {
        std::env::set_var(PLAN_VARIABLE, "{}");
        std::env::set_var("LUUNA_API_TOKEN", "secret");
        let plan = plan("p", &[], Path::new("/x"), Network::Open, Backend::Bwrap);
        let env = sandbox_environment(&plan, "/home/sandbox");
        assert!(env.iter().any(|(k, v)| k == "HOME" && v == "/home/sandbox"));
        assert!(env
            .iter()
            .all(|(k, _)| k != PLAN_VARIABLE && k != "LUUNA_API_TOKEN"));
        std::env::remove_var("LUUNA_API_TOKEN");
        assert!(env
            .iter()
            .any(|(k, v)| k == "LUUNA_SANDBOX_PROJECT" && v == "p"));
        std::env::remove_var(PLAN_VARIABLE);
    }
}
