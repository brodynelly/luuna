//! `luuna-sbx`: apply a project sandbox plan (ADR 0036).
//!
//! ```text
//! luuna-sbx run    [--plan <file>] [--grant-read <dir>]… [-- command …]
//! luuna-sbx print  [--plan <file>] [--grant-read <dir>]… [-- command …]
//! luuna-sbx revoke [--plan <file>] [--grant-read <dir>]…
//! ```
//!
//! The plan comes from `GET /api/v1/projects/{id}/orbit/sandbox`, through
//! `--plan` or the `LUUNA_SBX_PLAN` variable; `lu sbx` passes it the second way.
use luuna_sandbox::{launch, SandboxPlan, PLAN_VARIABLE};
use std::path::PathBuf;

const USAGE: &str =
    "usage: luuna-sbx <run|print|revoke> [--plan <file>] [--grant-read <dir>]... [-- command ...]";

fn main() {
    std::process::exit(match real_main() {
        Ok(code) => code,
        Err(message) => {
            eprintln!("luuna-sbx: {message}");
            2
        }
    });
}

fn real_main() -> Result<i32, String> {
    let mut args = std::env::args().skip(1);
    let action = args.next().ok_or(USAGE)?;
    let mut plan_file: Option<PathBuf> = None;
    let mut extra: Vec<PathBuf> = Vec::new();
    let mut command: Vec<String> = Vec::new();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--plan" => plan_file = Some(args.next().ok_or("--plan needs a file")?.into()),
            "--grant-read" => {
                let dir = PathBuf::from(args.next().ok_or("--grant-read needs a directory")?);
                if !dir.is_absolute() {
                    return Err("--grant-read takes an absolute directory".into());
                }
                extra.push(dir);
            }
            "--" => {
                command.extend(args.by_ref());
                break;
            }
            other => return Err(format!("unknown argument {other}\n{USAGE}")),
        }
    }
    let text = match plan_file {
        Some(path) => std::fs::read_to_string(&path)
            .map_err(|e| format!("cannot read {}: {e}", path.display()))?,
        None => std::env::var(PLAN_VARIABLE)
            .map_err(|_| format!("no plan: pass --plan <file> or set {PLAN_VARIABLE}"))?,
    };
    let plan: SandboxPlan =
        serde_json::from_str(&text).map_err(|e| format!("the plan is not a sandbox plan: {e}"))?;
    match action.as_str() {
        "run" => launch::run(&plan, &command, &extra).map_err(|e| e.to_string()),
        "print" => {
            println!("{}", launch::describe(&plan, &command, &extra));
            Ok(0)
        }
        "revoke" => launch::revoke(&plan, &extra)
            .map(|()| 0)
            .map_err(|e| e.to_string()),
        _ => Err(USAGE.into()),
    }
}
