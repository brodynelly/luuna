//! Real subprocesses through the executor; Python 3 stands in for every tool.
use luuna_domain::CheckStatus;
use luuna_executor::{CommandSpec, Executor, Progress};
use std::{path::PathBuf, time::Duration};
use tokio::sync::{mpsc, watch};

fn python() -> String {
    if cfg!(windows) { "python" } else { "python3" }.into()
}

fn spec(root: &std::path::Path, args: &[&str], timeout_seconds: u64) -> CommandSpec {
    CommandSpec {
        recipe_id: "fixture".into(),
        executable: python(),
        args: args.iter().map(|a| (*a).to_owned()).collect(),
        repository_root: root.to_path_buf(),
        cwd: ".".into(),
        timeout: Duration::from_secs(timeout_seconds),
        capabilities: vec!["python".into()],
        artifact_dir: root.join(".luuna-artifacts"),
    }
}

/// A process counts as alive only when it still runs; a killed child whose
/// parent died is a zombie until the init process reaps it.
fn alive(pid: u32) -> bool {
    if cfg!(target_os = "linux") {
        return std::fs::read_to_string(format!("/proc/{pid}/stat"))
            .ok()
            .and_then(|stat| {
                let after = stat.rsplit(')').next()?.trim_start();
                after.chars().next()
            })
            .is_some_and(|state| state != 'Z' && state != 'X');
    }
    if cfg!(unix) {
        return std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .map(|o| {
                let state = String::from_utf8_lossy(&o.stdout);
                !state.trim().is_empty() && !state.trim().starts_with('Z')
            })
            .unwrap_or(false);
    }
    false
}

#[tokio::test]
async fn passing_and_failing_commands_record_exit_codes_hashes_and_excerpts() {
    let dir = tempfile::tempdir().unwrap();
    let (_tx, cancel) = watch::channel(false);
    let (progress, mut events) = mpsc::unbounded_channel();
    let passed = Executor::default()
        .execute(
            &spec(
                dir.path(),
                &[
                    "-c",
                    "import sys; print('fixture stdout'); print('warn', file=sys.stderr)",
                ],
                30,
            ),
            cancel.clone(),
            Some(progress),
        )
        .await
        .unwrap();
    assert_eq!(passed.status, CheckStatus::Passed, "{passed:?}");
    assert_eq!(passed.exit_code, Some(0));
    assert!(passed.pid.is_some());
    assert!(passed.stdout_excerpt.contains("fixture stdout"));
    assert!(passed.stderr_excerpt.contains("warn"));
    assert_eq!(passed.artifacts.len(), 2);
    let stdout = &passed.artifacts[0];
    assert_eq!(
        std::fs::read_to_string(&stdout.path)
            .unwrap()
            .replace("\r\n", "\n"),
        "fixture stdout\n"
    );
    assert!(stdout.sha256.starts_with("sha256:") && !stdout.truncated);
    assert!(passed.environment_fingerprint.starts_with("sha256:"));
    assert!(passed
        .tool_version
        .as_deref()
        .unwrap_or("")
        .starts_with("Python"));
    assert!(matches!(
        events.recv().await,
        Some(Progress::Started { .. })
    ));
    let failed = Executor::default()
        .execute(
            &spec(dir.path(), &["-c", "import sys; sys.exit(3)"], 30),
            cancel,
            None,
        )
        .await
        .unwrap();
    assert_eq!(failed.status, CheckStatus::Failed);
    assert_eq!(failed.exit_code, Some(3));
    assert_eq!(failed.reason.as_deref(), Some("exit code 3"));
}

#[tokio::test]
async fn missing_executable_capability_cwd_and_empty_suite_are_blocked() {
    let dir = tempfile::tempdir().unwrap();
    let (_tx, cancel) = watch::channel(false);
    let mut missing = spec(dir.path(), &[], 30);
    missing.executable = "luuna-no-such-tool".into();
    missing.capabilities.clear();
    let blocked = Executor::default()
        .execute(&missing, cancel.clone(), None)
        .await
        .unwrap();
    assert_eq!(blocked.status, CheckStatus::Blocked);
    assert!(blocked
        .reason
        .as_deref()
        .unwrap()
        .contains("not found on PATH"));
    assert!(blocked.pid.is_none());

    let empty_path = tempfile::tempdir().unwrap();
    let incapable = Executor {
        search_path: Some(empty_path.path().as_os_str().to_owned()),
    };
    let mut needs_cargo = spec(dir.path(), &[], 30);
    needs_cargo.capabilities = vec!["cargo".into(), "test".into()];
    let blocked = incapable
        .execute(&needs_cargo, cancel.clone(), None)
        .await
        .unwrap();
    assert_eq!(blocked.status, CheckStatus::Blocked);
    assert_eq!(
        blocked.reason.as_deref(),
        Some("incapable host: missing cargo")
    );

    let mut escape = spec(dir.path(), &[], 30);
    escape.cwd = "../outside".into();
    let blocked = Executor::default()
        .execute(&escape, cancel.clone(), None)
        .await
        .unwrap();
    assert_eq!(blocked.status, CheckStatus::Blocked);

    let empty = Executor::default()
        .execute(
            &spec(dir.path(), &["-c", "print('running 0 tests'); print('test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured')"], 30),
            cancel,
            None,
        )
        .await
        .unwrap();
    assert_eq!(empty.status, CheckStatus::Blocked, "{empty:?}");
    assert_eq!(empty.exit_code, Some(0));
    assert_eq!(empty.tests_detected, Some(0));
}

#[tokio::test]
async fn deadline_and_cancellation_terminate_the_whole_process_group() {
    let dir = tempfile::tempdir().unwrap();
    let (_tx, cancel) = watch::channel(false);
    let timed_out = Executor::default()
        .execute(
            &spec(dir.path(), &["-c", "import time; time.sleep(30)"], 1),
            cancel,
            None,
        )
        .await
        .unwrap();
    assert_eq!(timed_out.status, CheckStatus::Failed);
    assert!(timed_out.reason.as_deref().unwrap().contains("deadline"));
    assert!(!alive(timed_out.pid.unwrap()) || cfg!(not(unix)));

    // The child spawns a grandchild; cancelling must reap both.
    let marker = dir.path().join("grandchild.pid");
    let script = format!(
        "import subprocess, time, sys\np = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\nopen({marker:?}, 'w').write(str(p.pid))\ntime.sleep(60)",
        marker = marker.to_string_lossy()
    );
    let (tx, cancel) = watch::channel(false);
    let executor = Executor::default();
    let spec = spec(dir.path(), &["-c", &script], 60);
    let run = tokio::spawn(async move { executor.execute(&spec, cancel, None).await.unwrap() });
    for _ in 0..200 {
        if marker.exists()
            && !std::fs::read_to_string(&marker)
                .unwrap_or_default()
                .is_empty()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let grandchild: u32 = std::fs::read_to_string(&marker)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    tx.send(true).unwrap();
    let cancelled = run.await.unwrap();
    assert_eq!(cancelled.status, CheckStatus::Cancelled);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!alive(cancelled.pid.unwrap()) || cfg!(not(unix)));
    if cfg!(unix) {
        assert!(
            !alive(grandchild),
            "grandchild must be terminated with the process group"
        );
    }
}

#[tokio::test]
async fn secrets_and_luuna_variables_never_reach_the_command() {
    std::env::set_var("FIXTURE_FAKE_API_KEY", "synthetic-secret-value");
    std::env::set_var("LUUNA_FIXTURE_PRIVATE", "synthetic-private-value");
    std::env::set_var("FIXTURE_PLAIN_SETTING", "visible");
    let dir = tempfile::tempdir().unwrap();
    let (_tx, cancel) = watch::channel(false);
    let execution = Executor::default()
        .execute(
            &spec(dir.path(), &["-c", "import os; print(sorted(k for k in os.environ if k.startswith(('FIXTURE_', 'LUUNA_')))); print(os.environ.get('CI'))"], 30),
            cancel,
            None,
        )
        .await
        .unwrap();
    assert_eq!(execution.status, CheckStatus::Passed);
    let stdout = std::fs::read_to_string(&execution.artifacts[0].path).unwrap();
    assert!(stdout.contains("FIXTURE_PLAIN_SETTING"), "{stdout}");
    assert!(stdout.contains("LUUNA_CHECK"), "{stdout}");
    assert!(!stdout.contains("FIXTURE_FAKE_API_KEY"), "{stdout}");
    assert!(!stdout.contains("LUUNA_FIXTURE_PRIVATE"), "{stdout}");
    assert!(!stdout.contains("secret-value"));
    assert!(stdout.contains("true"));
    let _ = PathBuf::new();
}

#[cfg(unix)]
#[tokio::test]
async fn repository_relative_executables_resolve_inside_the_checkout_only() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let tools = dir.path().join("tools");
    std::fs::create_dir(&tools).unwrap();
    let script = tools.join("check.sh");
    std::fs::write(&script, "#!/bin/sh\necho repo-local\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::os::unix::fs::symlink("/bin/sh", tools.join("escape")).unwrap();
    let (_tx, cancel) = watch::channel(false);
    let mut inside = spec(dir.path(), &[], 30);
    inside.executable = "./tools/check.sh".into();
    inside.capabilities = vec![];
    let execution = Executor::default()
        .execute(&inside, cancel.clone(), None)
        .await
        .unwrap();
    assert_eq!(execution.status, CheckStatus::Passed, "{execution:?}");
    assert!(execution.stdout_excerpt.contains("repo-local"));
    let mut outside = inside.clone();
    outside.executable = "tools/escape".into();
    let execution = Executor::default()
        .execute(&outside, cancel, None)
        .await
        .unwrap();
    assert_eq!(execution.status, CheckStatus::Blocked);
    assert!(execution
        .reason
        .as_deref()
        .unwrap_or("")
        .contains("outside the repository"));
}
