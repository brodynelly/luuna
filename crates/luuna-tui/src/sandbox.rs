//! `lu sbx` (ADR 0036): hands the runtime's sandbox plan to the native `luuna-sbx` launcher with
//! the terminal attached. The plan travels in the launcher's environment, never on its command
//! line; the runtime token and URL never reach the sandboxed process.
use crate::failures::Failure;
use crate::js::J;
use std::path::{Path, PathBuf};

/// Variables a sandboxed process must never inherit: the runtime's credentials.
pub const WITHHELD: [&str; 2] = ["LUUNA_API_TOKEN", "LUUNA_URL"];

/// Where `luuna-sbx` lives: `target/debug` (honoring CARGO_TARGET_DIR) in a source checkout, beside
/// the terminal client in an installed layout; there is no PATH search. Returns the path and
/// whether the root is a source checkout.
pub fn sandbox_binary(root: &Path, env: &[(String, String)], windows: bool) -> (PathBuf, bool) {
    let development = root.join("Cargo.toml").exists();
    let target = env
        .iter()
        .find(|(name, value)| name == "CARGO_TARGET_DIR" && !value.is_empty())
        .map(|(_, value)| root.join(value))
        .unwrap_or_else(|| root.join("target"));
    let directory = if development {
        target.join("debug")
    } else {
        root.to_path_buf()
    };
    let name = if windows {
        "luuna-sbx.exe"
    } else {
        "luuna-sbx"
    };
    (directory.join(name), development)
}

/// The launcher's environment: the caller's minus the runtime credentials, plus the plan.
pub fn sandbox_environment(env: &[(String, String)], plan: &J) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = env
        .iter()
        .filter(|(name, _)| !WITHHELD.contains(&name.to_uppercase().as_str()))
        .cloned()
        .collect();
    out.push((
        "LUUNA_SBX_PLAN".into(),
        plan.stringify().unwrap_or_else(|| "null".into()),
    ));
    out
}

/// The launcher's arguments: `run`, the extra read grants, then the sandboxed command after `--`.
pub fn sandbox_arguments(command: &[String], grants: &[String]) -> Vec<String> {
    let mut args = vec!["run".to_string()];
    for directory in grants {
        args.push("--grant-read".into());
        args.push(directory.clone());
    }
    if !command.is_empty() {
        args.push("--".into());
        args.extend(command.iter().cloned());
    }
    args
}

/// Starts `luuna-sbx run` with the terminal attached; resolves with the sandboxed command's exit
/// code. The sandboxed command owns Ctrl+C while it runs; the client only waits for it.
pub async fn launch(
    plan: &J,
    command: &[String],
    grants: &[String],
    env: &[(String, String)],
) -> Result<i32, Failure> {
    let (binary, development) =
        sandbox_binary(&crate::components::install_root(), env, cfg!(windows));
    if !binary.exists() {
        return Err(Failure::error(if development {
            "The sandbox launcher is not built. Run `cargo build --locked -p luuna-sandbox` at the Luuna checkout root, then run `lu sbx` again."
        } else {
            "The installed sandbox launcher (luuna-sbx) is missing. Reinstall the complete Luuna distribution."
        }));
    }
    let mut process = std::process::Command::new(&binary);
    process
        .args(sandbox_arguments(command, grants))
        .env_clear()
        .envs(sandbox_environment(env, plan));
    let status = tokio::task::spawn_blocking(move || process.status())
        .await
        .map_err(|error| Failure::error(error.to_string()))?
        .map_err(|error| Failure::error(format!("spawn {} {error}", binary.display())))?;
    Ok(exit_code(&status))
}

#[cfg(unix)]
fn exit_code(status: &std::process::ExitStatus) -> i32 {
    use std::os::unix::process::ExitStatusExt;
    match (status.code(), status.signal()) {
        (Some(code), _) => code,
        (None, Some(2)) => 130,
        (None, Some(_)) => 143,
        (None, None) => 1,
    }
}

#[cfg(not(unix))]
fn exit_code(status: &std::process::ExitStatus) -> i32 {
    status.code().unwrap_or(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_launcher_never_receives_the_runtime_token_or_url_and_gets_the_plan_in_its_environment() {
        let env = vec![
            ("PATH".to_string(), "/usr/bin".to_string()),
            ("LUUNA_API_TOKEN".to_string(), "secret".to_string()),
            ("luuna_url".to_string(), "http://127.0.0.1:4242".to_string()),
        ];
        let plan = crate::obj![("project_id", "p")];
        let out = sandbox_environment(&env, &plan);
        assert!(out
            .iter()
            .all(|(name, _)| name != "LUUNA_API_TOKEN" && name != "luuna_url"));
        assert!(out.contains(&("PATH".into(), "/usr/bin".into())));
        assert!(out.contains(&("LUUNA_SBX_PLAN".into(), r#"{"project_id":"p"}"#.into())));
    }

    #[test]
    fn the_launcher_is_found_in_the_build_tree_or_beside_the_client() {
        let missing = Path::new("/nonexistent-luuna-root");
        let (binary, development) = sandbox_binary(missing, &[], false);
        assert!(!development);
        assert_eq!(binary, missing.join("luuna-sbx"));
        let checkout = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let (binary, development) = sandbox_binary(&checkout, &[], true);
        assert!(development);
        assert_eq!(
            binary,
            checkout.join("target").join("debug").join("luuna-sbx.exe")
        );
    }

    #[test]
    fn the_trailing_command_follows_the_read_grants() {
        assert_eq!(
            sandbox_arguments(
                &["pi".into(), "--model".into(), "x".into()],
                &["/opt/tools".into()]
            ),
            [
                "run",
                "--grant-read",
                "/opt/tools",
                "--",
                "pi",
                "--model",
                "x"
            ]
        );
        assert_eq!(sandbox_arguments(&[], &[]), ["run"]);
    }
}
