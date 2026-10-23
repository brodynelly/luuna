//! Linux: the `bwrap` argument vector for a plan. The host filesystem is
//! invisible (`--unshare-all`, no root bind); only the system directories,
//! toolchain directories, the repositories and the sandbox home are mounted.
//! Environment variables never go on the argument vector, where
//! `/proc/<pid>/cmdline` would show them to every local process: bwrap
//! inherits them from the launcher and `execve`s the child with them.
use crate::{Network, SandboxPlan};
use std::path::PathBuf;

/// Read-only system directories; a missing one is skipped (`--ro-bind-try`).
pub const SYSTEM_RO_MOUNTS: &[&str] = &[
    "/usr", "/etc", "/lib", "/lib64", "/lib32", "/bin", "/sbin", "/opt",
];
/// `$HOME` inside the sandbox; the plan's home is bound here.
pub const SANDBOX_HOME: &str = "/home/sandbox";
/// Non-root identity inside the user namespace.
pub const SANDBOX_UID: u32 = 1000;
pub const SANDBOX_GID: u32 = 1000;
/// `PATH` entries never mounted as toolchains: other filesystems (WSL's Windows
/// drives under /mnt) and kernel or volatile trees.
pub const SKIPPED_PREFIXES: &[&str] = &[
    "/mnt", "/media", "/run", "/proc", "/sys", "/dev", "/tmp", "/var/tmp",
];

pub fn argv(
    plan: &SandboxPlan,
    bwrap: &str,
    toolchains: &[PathBuf],
    command: &[String],
) -> Vec<String> {
    let mut argv: Vec<String> = vec![bwrap.to_owned(), "--unshare-all".into()];
    if plan.network == Network::Open {
        argv.push("--share-net".into());
    }
    argv.extend(
        [
            "--die-with-parent",
            "--new-session",
            "--uid",
            &SANDBOX_UID.to_string(),
            "--gid",
            &SANDBOX_GID.to_string(),
            "--proc",
            "/proc",
            "--dev",
            "/dev",
            "--tmpfs",
            "/tmp",
        ]
        .map(str::to_owned),
    );
    for path in SYSTEM_RO_MOUNTS {
        argv.extend(["--ro-bind-try".into(), (*path).into(), (*path).into()]);
    }
    for path in toolchains {
        let path = path.to_string_lossy().into_owned();
        argv.extend(["--ro-bind".into(), path.clone(), path]);
    }
    // The home first, then the repositories: a repository can never be
    // shadowed by the home, and binds of nested paths follow their parents.
    argv.extend(["--bind".into(), plan.home.clone(), SANDBOX_HOME.into()]);
    let mut repositories: Vec<_> = plan.repositories.iter().collect();
    repositories.sort_by_key(|r| r.host_path.len());
    for repository in repositories {
        argv.extend([
            "--bind".into(),
            repository.host_path.clone(),
            repository.sandbox_path.clone(),
        ]);
    }
    argv.extend(["--chdir".into(), plan.workdir.clone(), "--".into()]);
    argv.extend(command.iter().cloned());
    argv
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Backend, SandboxRepository, PLAN_VERSION};

    fn plan(network: Network) -> SandboxPlan {
        SandboxPlan {
            version: PLAN_VERSION,
            project_id: "luuna".into(),
            backend: Backend::Bwrap,
            available: true,
            reason: None,
            workdir: "/home/dev/github".into(),
            host_root: None,
            home: "/data/sandboxes/luuna/home".into(),
            repositories: vec![
                SandboxRepository {
                    repository_id: "atlas".into(),
                    host_path: "/home/dev/github/luuna-atlas".into(),
                    sandbox_path: "/home/dev/github/luuna-atlas".into(),
                },
                SandboxRepository {
                    repository_id: "luuna".into(),
                    host_path: "/home/dev/github/luuna".into(),
                    sandbox_path: "/home/dev/github/luuna".into(),
                },
            ],
            network,
            container_name: None,
            notes: vec![],
        }
    }

    #[test]
    fn binds_only_the_plan_and_starts_in_the_common_parent() {
        let argv = argv(
            &plan(Network::Open),
            "bwrap",
            &[PathBuf::from("/home/dev/.cargo/bin")],
            &["bash".into()],
        );
        let text = argv.join(" ");
        assert!(text.starts_with("bwrap --unshare-all --share-net --die-with-parent"));
        assert!(text.contains("--uid 1000 --gid 1000"));
        assert!(text.contains("--ro-bind /home/dev/.cargo/bin /home/dev/.cargo/bin"));
        assert!(text.contains("--bind /data/sandboxes/luuna/home /home/sandbox"));
        assert!(text.contains("--bind /home/dev/github/luuna /home/dev/github/luuna"));
        assert!(text.ends_with("--chdir /home/dev/github -- bash"));
        // Never the whole host or the real home.
        assert!(!text.contains("--bind / ") && !text.contains("--ro-bind / "));
        assert!(!text.contains("--setenv"));
    }

    #[test]
    fn no_network_keeps_the_empty_network_namespace() {
        let argv = argv(&plan(Network::None), "bwrap", &[], &["sh".into()]);
        assert!(!argv.iter().any(|a| a == "--share-net"));
    }
}
