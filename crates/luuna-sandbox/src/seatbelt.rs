//! macOS: the Seatbelt (SBPL) profile for a plan, run with `sandbox-exec -f`.
//! It starts from `(deny default)` and grants system reads, toolchain reads,
//! the repositories and the sandbox home. Seatbelt matches canonical paths
//! (`/var` is `/private/var`), so the launcher canonicalizes before rendering.
use crate::{Network, SandboxPlan};
use std::path::PathBuf;

pub const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

pub const SYSTEM_READ_SUBPATHS: &[&str] = &[
    "/usr",
    "/System",
    "/Library",
    "/bin",
    "/sbin",
    "/opt",
    "/private/etc",
    "/private/var/db",
    "/private/var/select",
    "/dev",
];

pub fn profile(plan: &SandboxPlan, toolchains: &[PathBuf]) -> String {
    let mut lines = vec![
        ";; Luuna project sandbox (ADR 0036)".to_owned(),
        "(version 1)".into(),
        "(deny default)".into(),
        "(allow process-fork)".into(),
        "(allow process-exec)".into(),
        "(allow signal (target same-sandbox))".into(),
        "(allow sysctl-read)".into(),
        "(allow mach-lookup)".into(),
        "(allow ipc-posix-shm)".into(),
        "(allow iokit-open)".into(),
        // Path resolution (stat, getcwd) must work across the filesystem even
        // where reading contents is denied, or shells cannot resolve their cwd.
        "(allow file-read-metadata)".into(),
        "(allow file-read* (literal \"/\"))".into(),
    ];
    for path in SYSTEM_READ_SUBPATHS {
        lines.push(format!("(allow file-read* (subpath {}))", quoted(path)));
    }
    for path in toolchains {
        lines.push(format!(
            "(allow file-read* (subpath {}))",
            quoted(&path.to_string_lossy())
        ));
    }
    let writable = "(allow file-read* file-write* (subpath {}))";
    for path in plan
        .repositories
        .iter()
        .map(|r| r.host_path.as_str())
        .chain([plan.home.as_str(), "/private/tmp", "/private/var/folders"])
    {
        lines.push(writable.replace("{}", &quoted(path)));
    }
    lines.push("(allow file-write* (literal \"/dev/null\") (literal \"/dev/tty\") (literal \"/dev/dtracehelper\"))".into());
    lines.push("(allow file-ioctl (literal \"/dev/tty\"))".into());
    if plan.network == Network::Open {
        lines.push("(allow network*)".into());
    }
    format!("{}\n", lines.join("\n"))
}

/// An SBPL string literal.
fn quoted(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Backend, SandboxRepository, PLAN_VERSION};

    #[test]
    fn denies_by_default_and_grants_only_the_plan() {
        let plan = SandboxPlan {
            version: PLAN_VERSION,
            project_id: "p".into(),
            backend: Backend::Seatbelt,
            available: true,
            reason: None,
            workdir: "/Users/dev/github".into(),
            host_root: None,
            home: "/Users/dev/Library/Luuna/sandboxes/p/home".into(),
            repositories: vec![SandboxRepository {
                repository_id: "app".into(),
                host_path: "/Users/dev/github/app \"x\"".into(),
                sandbox_path: "/Users/dev/github/app \"x\"".into(),
            }],
            network: Network::None,
            container_name: None,
            notes: vec![],
        };
        let text = profile(&plan, &[PathBuf::from("/Users/dev/.cargo/bin")]);
        assert!(text.contains("(deny default)"));
        assert!(text
            .contains(r#"(allow file-read* file-write* (subpath "/Users/dev/github/app \"x\""))"#));
        assert!(text.contains(r#"(allow file-read* (subpath "/Users/dev/.cargo/bin"))"#));
        assert!(!text.contains("(allow network*)"));
        assert!(!text.contains(r#"(subpath "/Users/dev")"#));
    }
}
