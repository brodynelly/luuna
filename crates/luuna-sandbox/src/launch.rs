//! Apply a validated plan on this host and run one command with the terminal
//! attached. The plan decides what is reachable; nothing here widens it.
use crate::{bwrap, seatbelt, toolchain_dirs, Backend, SandboxError, SandboxPlan};
use std::path::{Path, PathBuf};

/// The command to run when none is given: the user's shell.
pub fn default_command() -> Vec<String> {
    if cfg!(windows) {
        return Vec::new(); // windows::command_line opens PowerShell.
    }
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| Path::new(s).is_file());
    vec![shell.unwrap_or_else(|| {
        if Path::new("/bin/bash").is_file() {
            "/bin/bash".into()
        } else {
            "/bin/sh".into()
        }
    })]
}

fn command_or_default(command: &[String]) -> Vec<String> {
    if command.is_empty() {
        default_command()
    } else {
        command.to_vec()
    }
}

/// Read-only toolchain directories for the Unix backends.
fn unix_toolchains(plan: &SandboxPlan, extra: &[PathBuf]) -> Vec<PathBuf> {
    let (covered, skipped): (&[&str], &[&str]) = match plan.backend {
        Backend::Bwrap => (bwrap::SYSTEM_RO_MOUNTS, bwrap::SKIPPED_PREFIXES),
        _ => (seatbelt::SYSTEM_READ_SUBPATHS, &[]),
    };
    let mut dirs = toolchain_dirs(plan, covered, skipped);
    dirs.extend(
        extra
            .iter()
            .filter(|d| d.is_absolute() && d.is_dir())
            .cloned(),
    );
    dirs
}

/// What the launcher would do, without doing it: the bwrap argument vector, the
/// Seatbelt profile, or the AppContainer command line and grants.
pub fn describe(plan: &SandboxPlan, command: &[String], extra: &[PathBuf]) -> String {
    let command = command_or_default(command);
    match plan.backend {
        Backend::Bwrap => {
            bwrap::argv(plan, "bwrap", &unix_toolchains(plan, extra), &command).join(" ")
        }
        Backend::Seatbelt => format!(
            "{} -f <profile> {}\n\n{}",
            seatbelt::SANDBOX_EXEC,
            command.join(" "),
            seatbelt::profile(plan, &unix_toolchains(plan, extra))
        ),
        Backend::AppContainer => {
            #[cfg(windows)]
            let line = crate::windows::command_line(&command, &plan.workdir);
            #[cfg(not(windows))]
            let line = command.join(" ");
            let mut text = format!(
                "AppContainer {} running {line}\nstarting in {}\nread-write: {}\nhome: {}\nnetwork: {:?}",
                plan.container_name.as_deref().unwrap_or("?"),
                plan.workdir,
                plan.repositories.iter().map(|r| r.host_path.as_str()).collect::<Vec<_>>().join(", "),
                plan.home,
                plan.network,
            );
            for dir in extra {
                text.push_str(&format!("\nread-execute: {}", dir.display()));
            }
            text
        }
        Backend::Unavailable => "no sandbox backend on this host".into(),
    }
}

/// Run `command` (or the user's shell) inside the plan's sandbox; returns the
/// exit code to propagate.
pub fn run(plan: &SandboxPlan, command: &[String], extra: &[PathBuf]) -> Result<i32, SandboxError> {
    plan.validate()?;
    std::fs::create_dir_all(&plan.home)?;
    let command = command_or_default(command);
    match plan.backend {
        Backend::Bwrap => {
            let program = crate::find_on_path("bwrap").ok_or_else(|| {
                SandboxError::Unavailable("bubblewrap (bwrap) is not installed".into())
            })?;
            let argv = bwrap::argv(
                plan,
                &program.to_string_lossy(),
                &unix_toolchains(plan, extra),
                &command,
            );
            let status = std::process::Command::new(&argv[0])
                .args(&argv[1..])
                .env_clear()
                .envs(crate::sandbox_environment(plan, bwrap::SANDBOX_HOME))
                .status()?;
            Ok(exit_code(status))
        }
        Backend::Seatbelt => run_seatbelt(plan, &command, extra),
        #[cfg(windows)]
        Backend::AppContainer => crate::windows::run(plan, &command, extra),
        _ => Err(SandboxError::Unavailable(
            "no sandbox backend on this host".into(),
        )),
    }
}

fn run_seatbelt(
    plan: &SandboxPlan,
    command: &[String],
    extra: &[PathBuf],
) -> Result<i32, SandboxError> {
    // Seatbelt matches canonical paths: /var/folders is /private/var/folders.
    let mut canonical = plan.clone();
    let real = |p: &str| {
        std::fs::canonicalize(p)
            .map(|c| c.to_string_lossy().into_owned())
            .unwrap_or_else(|_| p.to_owned())
    };
    canonical.home = real(&plan.home);
    for repository in &mut canonical.repositories {
        repository.host_path = real(&repository.host_path);
    }
    let dir = std::env::temp_dir().join(format!("luuna-sbx-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let profile = dir.join("profile.sb");
    write_private(
        &profile,
        &seatbelt::profile(&canonical, &unix_toolchains(&canonical, extra)),
    )?;
    let status = std::process::Command::new(seatbelt::SANDBOX_EXEC)
        .arg("-f")
        .arg(&profile)
        .args(command)
        .current_dir(&canonical.workdir)
        .env_clear()
        .envs(crate::sandbox_environment(plan, &canonical.home))
        .status();
    let _ = std::fs::remove_dir_all(&dir);
    Ok(exit_code(status?))
}

fn write_private(path: &Path, text: &str) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    options.open(path)?.write_all(text.as_bytes())
}

fn exit_code(status: std::process::ExitStatus) -> i32 {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return 128 + signal;
        }
    }
    status.code().unwrap_or(1)
}

/// Remove the grants a Windows sandbox left; other backends keep none.
pub fn revoke(plan: &SandboxPlan, extra: &[PathBuf]) -> Result<(), SandboxError> {
    match plan.backend {
        #[cfg(windows)]
        Backend::AppContainer => crate::windows::revoke(plan, extra),
        _ => {
            let _ = extra;
            Ok(())
        }
    }
}
