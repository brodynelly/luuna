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

#[tokio::test]
async fn canonical_nested_worktree_runs_the_actual_test_module() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir
        .path()
        .join("representative-private-data-directory-for-workflows")
        .join("worktrees")
        .join("workflow-11111111-1111-1111-1111-111111111111")
        .join("attempt-22222222-2222-2222-2222-222222222222")
        .join("app");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("test_probe.py"), "import unittest\nclass Probe(unittest.TestCase):\n    def test_present(self):\n        self.assertTrue(True)\n").unwrap();
    let canonical = root.canonicalize().unwrap();
    let (_tx, cancel) = watch::channel(false);
    let result = Executor::default()
        .execute(
            &spec(&canonical, &["-m", "unittest", "-v", "test_probe"], 30),
            cancel,
            None,
        )
        .await
        .unwrap();
    assert_eq!(result.status, CheckStatus::Passed, "{result:?}");
    assert_eq!(result.tests_detected, Some(1), "{result:?}");
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
        ..Executor::default()
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

#[tokio::test]
async fn a_descendant_holding_the_pipes_cannot_keep_the_check_open() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("grandchild.pid");
    let (_tx, cancel) = watch::channel(false);
    let executor = Executor {
        drain_grace: Duration::from_secs(1),
        ..Executor::default()
    };
    let started = std::time::Instant::now();
    let execution = executor
        .execute(
            &spec(
                dir.path(),
                &[
                    "-c",
                    &format!(
                        "import subprocess, sys\np = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\nopen({marker:?}, 'w').write(str(p.pid))\nprint('leader done')",
                    ),
                ],
                60,
            ),
            cancel,
            None,
        )
        .await
        .unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(30),
        "drain must be bounded, took {:?}",
        started.elapsed()
    );
    assert_eq!(execution.status, CheckStatus::Failed, "{execution:?}");
    let reason = execution.reason.clone().unwrap_or_default();
    assert!(reason.contains("descendant"), "{reason}");
    if cfg!(unix) {
        let grandchild: u32 = std::fs::read_to_string(&marker)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(
            !alive(grandchild),
            "grandchild must be reaped with the group"
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn artifacts_are_private_even_under_a_permissive_directory_and_umask() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let artifact_dir = dir.path().join(".luuna-artifacts");
    std::fs::create_dir(&artifact_dir).unwrap();
    std::fs::set_permissions(&artifact_dir, std::fs::Permissions::from_mode(0o755)).unwrap();
    let (_tx, cancel) = watch::channel(false);
    let execution = Executor::default()
        .execute(
            &spec(dir.path(), &["-c", "print('private')"], 30),
            cancel,
            None,
        )
        .await
        .unwrap();
    assert_eq!(execution.status, CheckStatus::Passed);
    let mode =
        |path: &std::path::Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&artifact_dir), 0o700);
    for artifact in &execution.artifacts {
        assert_eq!(mode(&artifact.path), 0o600, "{}", artifact.path.display());
    }
}

#[cfg(unix)]
#[tokio::test]
async fn version_probes_never_see_secrets() {
    use std::os::unix::fs::PermissionsExt;
    std::env::set_var("FIXTURE_FAKE_API_KEY", "synthetic-secret-value");
    std::env::set_var("LUUNA_FIXTURE_PRIVATE", "synthetic-private-value");
    let dir = tempfile::tempdir().unwrap();
    let tools = dir.path().join("tools");
    std::fs::create_dir(&tools).unwrap();
    // A repository-relative executable named like a known tool is version-probed.
    let fake_cargo = tools.join("cargo");
    std::fs::write(
        &fake_cargo,
        "#!/bin/sh\necho \"cargo-fixture key=${FIXTURE_FAKE_API_KEY:-absent} private=${LUUNA_FIXTURE_PRIVATE:-absent}\"\n",
    )
    .unwrap();
    std::fs::set_permissions(&fake_cargo, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut probe_spec = spec(dir.path(), &[], 30);
    probe_spec.executable = "./tools/cargo".into();
    probe_spec.capabilities = vec![];
    match Executor::default().probe(&probe_spec).await {
        luuna_executor::Probe::Resolved { tool_version, .. } => {
            let version = tool_version.unwrap_or_default();
            assert!(version.contains("cargo-fixture"), "{version}");
            assert!(version.contains("key=absent"), "{version}");
            assert!(version.contains("private=absent"), "{version}");
            assert!(!version.contains("synthetic"), "{version}");
        }
        other => panic!("probe must resolve: {other:?}"),
    }
}
