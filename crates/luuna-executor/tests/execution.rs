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
        budget: None,
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
    #[cfg(windows)]
    {
        use windows_sys::Win32::{Foundation::CloseHandle, System::Threading::*};
        // SAFETY: query-only handle, closed before returning.
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return false;
            }
            let mut code = 0;
            let running = GetExitCodeProcess(handle, &mut code) != 0 && code == 259;
            CloseHandle(handle);
            running
        }
    }
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string(format!("/proc/{pid}/stat"))
            .ok()
            .and_then(|stat| {
                let after = stat.rsplit(')').next()?.trim_start();
                after.chars().next()
            })
            .is_some_and(|state| state != 'Z' && state != 'X')
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .map(|o| {
                let state = String::from_utf8_lossy(&o.stdout);
                !state.trim().is_empty() && !state.trim().starts_with('Z')
            })
            .unwrap_or(false)
    }
    #[cfg(not(any(windows, unix)))]
    false
}

#[tokio::test]
async fn passing_and_failing_commands_record_exit_codes_hashes_and_excerpts() {
    let dir = tempfile::tempdir().unwrap();
    let (_tx, cancel) = watch::channel(false);
    let (progress, mut events) = mpsc::channel(luuna_executor::PROGRESS_CAPACITY);
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
    assert!(!alive(timed_out.pid.unwrap()));

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
    assert!(!alive(cancelled.pid.unwrap()));
    {
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
    // Credential shapes beyond the generic markers: vault sessions, passwords,
    // personal access tokens, webhook URLs and connection strings.
    for name in [
        "FIXTURE_DB_PASS",
        "FIXTURE_MYSQL_PWD",
        "FIXTURE_GITHUB_PAT",
        "FIXTURE_SLACK_WEBHOOK_URL",
        "FIXTURE_STORAGE_CONNECTION_STRING",
        "FIXTURE_DATABASE_URL",
        "OP_SESSION_luunafixture",
    ] {
        std::env::set_var(name, "synthetic-secret-value");
    }
    let dir = tempfile::tempdir().unwrap();
    let (_tx, cancel) = watch::channel(false);
    let execution = Executor::default()
        .execute(
            &spec(dir.path(), &["-c", "import os; print(sorted(k for k in os.environ if k.startswith(('FIXTURE_', 'LUUNA_', 'OP_SESSION_')))); print(os.environ.get('CI'))"], 30),
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
    for withheld in [
        "PASS",
        "PWD",
        "PAT",
        "WEBHOOK",
        "CONNECTION",
        "DATABASE",
        "OP_SESSION",
    ] {
        assert!(
            !stdout.contains(withheld),
            "{withheld} reached the check: {stdout}"
        );
    }
    assert!(stdout.contains("LUUNA_CHECK_GROUP"), "{stdout}");
    assert!(!stdout.contains("secret-value"));
    assert!(stdout.contains("true"));
    let _ = PathBuf::new();
}

#[tokio::test]
async fn a_stalled_progress_consumer_cannot_block_or_grow_command_output() {
    let dir = tempfile::tempdir().unwrap();
    let (_tx, cancel) = watch::channel(false);
    let (progress, events) = mpsc::channel(luuna_executor::PROGRESS_CAPACITY);
    let result = Executor::default().execute(&spec(dir.path(), &["-c",
        "import sys; sys.stdout.write('x' * (20 * 1024 * 1024)); sys.stderr.write('y' * (20 * 1024 * 1024))"], 30), cancel, Some(progress)).await.unwrap();
    assert_eq!(result.status, CheckStatus::Passed, "{result:?}");
    assert!(events.len() <= luuna_executor::PROGRESS_CAPACITY);
    for artifact in result.artifacts {
        assert!(artifact.truncated);
        assert_eq!(
            std::fs::metadata(&artifact.path).unwrap().len(),
            16 * 1024 * 1024
        );
    }
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
    {
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

#[tokio::test]
async fn a_background_process_left_by_a_passing_check_is_reaped_and_named() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("server.pid");
    // A test that starts a server with redirected output and exits 0: the
    // server holds no pipe, so only the post-exit group reap can stop it.
    let script = format!(
        "import subprocess, sys\np = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\nopen({marker:?}, 'w').write(str(p.pid))\nprint('server started')",
        marker = marker.to_string_lossy()
    );
    let (_tx, cancel) = watch::channel(false);
    let (progress, mut events) = mpsc::channel(luuna_executor::PROGRESS_CAPACITY);
    let execution = Executor::default()
        .execute(
            &spec(dir.path(), &["-c", &script], 60),
            cancel,
            Some(progress),
        )
        .await
        .unwrap();
    assert_eq!(execution.status, CheckStatus::Passed, "{execution:?}");
    assert_eq!(execution.reason, None);
    if cfg!(unix) {
        let server: u32 = std::fs::read_to_string(&marker)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert!(
            !alive(server),
            "a process the check left running must not outlive its result"
        );
        assert!(
            !execution.reaped_descendants.is_empty(),
            "the reaped process is recorded: {execution:?}"
        );
        if cfg!(target_os = "linux") {
            assert!(
                execution.reaped_descendants[0].contains(&format!("pid {server}")),
                "{:?}",
                execution.reaped_descendants
            );
        }
        let mut reported = false;
        while let Ok(event) = events.try_recv() {
            reported |= matches!(event, Progress::Reaped { .. });
        }
        assert!(reported, "the reap is reported as progress");
    }
}

#[tokio::test]
async fn skip_only_suites_and_summaries_past_the_artifact_cap_are_judged_correctly() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("test_skipped.py"),
        "import unittest\nclass Skipped(unittest.TestCase):\n    @unittest.skip('environment-gated')\n    def test_a(self):\n        pass\n    @unittest.skip('environment-gated')\n    def test_b(self):\n        pass\n",
    )
    .unwrap();
    let (_tx, cancel) = watch::channel(false);
    let skipped = Executor::default()
        .execute(
            &spec(dir.path(), &["-m", "unittest", "-v", "test_skipped"], 30),
            cancel.clone(),
            None,
        )
        .await
        .unwrap();
    assert_eq!(skipped.status, CheckStatus::Blocked, "{skipped:?}");
    assert_eq!(skipped.exit_code, Some(0));
    assert_eq!(skipped.tests_detected, Some(0));
    assert!(skipped
        .reason
        .as_deref()
        .unwrap()
        .starts_with("empty suite"));

    // A custom success line is not a runner summary.
    let custom = Executor::default()
        .execute(
            &spec(
                dir.path(),
                &["-c", "print('checked 42 cases'); print('Tests passed!')"],
                30,
            ),
            cancel.clone(),
            None,
        )
        .await
        .unwrap();
    assert_eq!(custom.status, CheckStatus::Passed, "{custom:?}");
    assert_eq!(custom.tests_detected, None);

    // An empty first crate, then more output than an artifact keeps, then
    // the suite that ran: the whole stream decides, not the retained bytes.
    let large = Executor::default()
        .execute(
            &spec(
                dir.path(),
                &[
                    "-c",
                    "import sys\nprint('test result: ok. 0 passed; 0 failed; 0 ignored')\nline = 'x' * 1048575 + '\\n'\nfor _ in range(17):\n    sys.stdout.write(line)\nprint('test result: ok. 5 passed; 0 failed; 0 ignored')",
                ],
                60,
            ),
            cancel,
            None,
        )
        .await
        .unwrap();
    assert_eq!(large.status, CheckStatus::Passed, "{:?}", large.reason);
    assert_eq!(large.tests_detected, Some(5));
    let stdout = &large.artifacts[0];
    assert!(stdout.truncated);
    assert_eq!(stdout.retained_bytes, luuna_executor::MAX_ARTIFACT_BYTES);
    assert!(stdout.bytes > stdout.retained_bytes);
    assert_eq!(
        std::fs::metadata(&stdout.path).unwrap().len(),
        stdout.retained_bytes
    );
}

#[tokio::test]
async fn missing_tools_and_dependencies_are_blocked_infrastructure_not_failures() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("app")).unwrap();
    std::fs::write(dir.path().join("app").join("__init__.py"), "").unwrap();
    let (_tx, cancel) = watch::channel(false);
    let run = |args: Vec<String>| {
        let cancel = cancel.clone();
        let spec = spec(
            dir.path(),
            &args.iter().map(String::as_str).collect::<Vec<_>>(),
            30,
        );
        async move {
            Executor::default()
                .execute(&spec, cancel, None)
                .await
                .unwrap()
        }
    };
    // `npm test` whose script tool is absent exits 127 after the shell's report.
    let not_found = run(vec![
        "-c".into(),
        "import sys; print('sh: 1: vitest: not found', file=sys.stderr); sys.exit(127)".into(),
    ])
    .await;
    assert_eq!(not_found.status, CheckStatus::Blocked, "{not_found:?}");
    assert_eq!(not_found.exit_code, Some(127));
    let reason = not_found.reason.unwrap();
    assert!(
        reason.contains("`vitest`") && reason.contains("dependency-preparation recipe"),
        "{reason}"
    );
    let module = run(vec![
        "-c".into(),
        "import luuna_fixture_dependency_that_is_not_installed".into(),
    ])
    .await;
    assert_eq!(module.status, CheckStatus::Blocked, "{module:?}");
    assert_eq!(module.exit_code, Some(1));
    assert!(module
        .reason
        .unwrap()
        .contains("Python module `luuna_fixture_dependency_that_is_not_installed`"));
    // A broken import of the repository's own package is the code's failure.
    let local = run(vec!["-c".into(), "import app.missing_module".into()]).await;
    assert_eq!(local.status, CheckStatus::Failed, "{local:?}");
    assert_eq!(local.reason.as_deref(), Some("exit code 1"));
    // A repository-relative tool that an ignored dependency directory provides
    // in the developer checkout only.
    let mut relative = spec(dir.path(), &["run"], 30);
    relative.executable = "node_modules/.bin/vitest".into();
    relative.capabilities = vec![];
    let missing = Executor::default()
        .execute(&relative, cancel.clone(), None)
        .await
        .unwrap();
    assert_eq!(missing.status, CheckStatus::Blocked, "{missing:?}");
    let reason = missing.reason.unwrap();
    assert!(
        reason.contains("node_modules/.bin/vitest")
            && reason.contains("dependency-preparation recipe"),
        "{reason}"
    );
}

#[tokio::test]
async fn a_check_cut_short_by_the_workflow_budget_is_blocked_by_the_budget() {
    let dir = tempfile::tempdir().unwrap();
    let (_tx, cancel) = watch::channel(false);
    let mut limited = spec(dir.path(), &["-c", "import time; time.sleep(30)"], 30);
    limited.budget = Some(Duration::from_secs(1));
    let execution = Executor::default()
        .execute(&limited, cancel.clone(), None)
        .await
        .unwrap();
    assert_eq!(execution.status, CheckStatus::Blocked, "{execution:?}");
    assert!(execution.budget_exhausted);
    let reason = execution.reason.unwrap();
    assert!(
        reason.starts_with("workflow time budget exhausted after 1s")
            && reason.contains("re-plan required"),
        "{reason}"
    );
    // A budget that outlasts the recipe leaves the recipe's own deadline in charge.
    let mut own = spec(dir.path(), &["-c", "import time; time.sleep(30)"], 1);
    own.budget = Some(Duration::from_secs(30));
    let execution = Executor::default()
        .execute(&own, cancel, None)
        .await
        .unwrap();
    assert_eq!(execution.status, CheckStatus::Failed);
    assert!(!execution.budget_exhausted);
    assert!(execution
        .reason
        .unwrap()
        .starts_with("deadline of 1s exceeded"));
}

#[cfg(unix)]
fn shim(dir: &std::path::Path, name: &str, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join(name);
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

#[cfg(unix)]
#[tokio::test]
async fn version_probes_run_in_the_recipe_cwd_with_tool_specific_arguments() {
    let tools = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    std::fs::create_dir(repo.path().join("pinned")).unwrap();
    // A version-manager shim reports the toolchain its working directory selects.
    shim(tools.path(), "cargo", "echo \"cargo-shim $(pwd)\"");
    shim(
        tools.path(),
        "go",
        "if [ \"$1\" = version ]; then echo 'go version go1.99.0 shim'; exit 0; fi\necho 'flag provided but not defined: -version' >&2\nexit 2",
    );
    let executor = Executor {
        search_path: Some(tools.path().as_os_str().to_owned()),
        ..Executor::default()
    };
    let probe = |executable: &str, cwd: &str| {
        let mut recipe = spec(repo.path(), &[], 30);
        recipe.executable = executable.into();
        recipe.cwd = cwd.into();
        recipe.capabilities = vec![];
        recipe
    };
    let resolved = |probe: luuna_executor::Probe| match probe {
        luuna_executor::Probe::Resolved {
            tool_version,
            fingerprint,
            ..
        } => (tool_version.unwrap_or_default(), fingerprint),
        other => panic!("probe must resolve: {other:?}"),
    };
    let (pinned, pinned_fingerprint) = resolved(executor.probe(&probe("cargo", "pinned")).await);
    let canonical = repo.path().join("pinned").canonicalize().unwrap();
    assert!(
        pinned.ends_with(&*canonical.to_string_lossy()),
        "the probe runs where the recipe runs: {pinned}"
    );
    let (root, root_fingerprint) = resolved(executor.probe(&probe("cargo", ".")).await);
    assert_ne!(pinned, root);
    assert_ne!(pinned_fingerprint, root_fingerprint);
    let (go, _) = resolved(executor.probe(&probe("go", ".")).await);
    assert_eq!(go, "go version go1.99.0 shim");

    // A failing probe records no version, and its failure changes the fingerprint.
    let node = shim(tools.path(), "node", "exit 0");
    let (silent, silent_fingerprint) = resolved(executor.probe(&probe("node", ".")).await);
    assert_eq!(silent, "");
    shim(
        tools.path(),
        "node",
        "echo 'node: bad option: --version' >&2\nexit 9",
    );
    let (failing, failing_fingerprint) = resolved(executor.probe(&probe("node", ".")).await);
    assert_eq!(failing, "", "error text is never a version");
    assert_ne!(silent_fingerprint, failing_fingerprint);
    assert_eq!(
        silent_fingerprint,
        Executor::fingerprint(&node, None),
        "a successful probe keeps the established fingerprint form"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn path_lookup_skips_files_without_an_execute_bit_and_relative_entries() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    std::fs::write(first.path().join("luuna-fixture-tool"), "not a program").unwrap();
    let real = shim(second.path(), "luuna-fixture-tool", "echo real-tool");
    let search = std::env::join_paths([
        PathBuf::from("relative-entry"),
        first.path().to_path_buf(),
        second.path().to_path_buf(),
    ])
    .unwrap();
    let executor = Executor {
        search_path: Some(search),
        ..Executor::default()
    };
    let dir = tempfile::tempdir().unwrap();
    let mut recipe = spec(dir.path(), &[], 30);
    recipe.executable = "luuna-fixture-tool".into();
    recipe.capabilities = vec![];
    let (_tx, cancel) = watch::channel(false);
    let execution = executor.execute(&recipe, cancel, None).await.unwrap();
    assert_eq!(execution.status, CheckStatus::Passed, "{execution:?}");
    assert_eq!(execution.resolved_executable, Some(real));
    assert!(execution.stdout_excerpt.contains("real-tool"));
}

#[cfg(windows)]
#[tokio::test]
async fn windows_lookup_prefers_the_cmd_shim_over_an_extensionless_script() {
    let tools = tempfile::tempdir().unwrap();
    // Node's Windows install ships an extensionless sh script beside npm.cmd.
    std::fs::write(
        tools.path().join("luuna-fixture-npm"),
        "#!/bin/sh\necho posix\n",
    )
    .unwrap();
    std::fs::write(
        tools.path().join("luuna-fixture-npm.cmd"),
        "@echo windows\r\n",
    )
    .unwrap();
    let executor = Executor {
        search_path: Some(tools.path().as_os_str().to_owned()),
        ..Executor::default()
    };
    let dir = tempfile::tempdir().unwrap();
    let mut recipe = spec(dir.path(), &[], 30);
    recipe.executable = "luuna-fixture-npm".into();
    recipe.capabilities = vec![];
    match executor.probe(&recipe).await {
        luuna_executor::Probe::Resolved { resolved, .. } => assert_eq!(
            resolved
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_ascii_lowercase(),
            "luuna-fixture-npm.cmd"
        ),
        other => panic!("probe must resolve: {other:?}"),
    }
}

#[cfg(target_os = "linux")]
#[test]
fn restart_recovery_reaps_only_verified_survivors_of_a_recorded_group() {
    use luuna_executor::GroupReconciliation;
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("orphan.pid");
    let script = format!(
        "import subprocess, sys, time\np = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\nopen({marker:?}, 'w').write(str(p.pid))\ntime.sleep(60)",
        marker = marker.to_string_lossy()
    );
    // A dying supervisor runs no destructors, so the execution is frozen
    // rather than dropped: dropping it would stop the group through its owner.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let (_tx, cancel) = watch::channel(false);
    let (progress, mut events) = mpsc::channel(luuna_executor::PROGRESS_CAPACITY);
    let recipe = spec(dir.path(), &["-c", &script], 120);
    let mut running = Box::pin(async move {
        Executor::default()
            .execute(&recipe, cancel, Some(progress))
            .await
    });
    let group = runtime.block_on(async {
        tokio::select! {
            biased;
            group = async {
                loop {
                    match events.recv().await {
                        Some(Progress::Started { group, .. }) => break group,
                        Some(_) => continue,
                        None => panic!("the check never started"),
                    }
                }
            } => group,
            finished = &mut running => panic!("the check finished early: {finished:?}"),
        }
    });
    assert!(group.leader_start.is_some() && group.boot_id.is_some());
    for _ in 0..200 {
        if !std::fs::read_to_string(&marker)
            .unwrap_or_default()
            .is_empty()
        {
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let orphan: u32 = std::fs::read_to_string(&marker)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    // The supervisor dies without settling the check: the direct child goes
    // with it (as the parent-death signal does) and the grandchild survives.
    std::mem::forget(running);
    std::mem::forget(runtime);
    // SAFETY: signal and reap the direct child this test process started.
    unsafe {
        libc::kill(group.pgid as libc::pid_t, libc::SIGKILL);
        libc::waitpid(group.pgid as libc::pid_t, std::ptr::null_mut(), 0);
    }
    std::thread::sleep(Duration::from_millis(200));
    assert!(alive(orphan), "the grandchild outlives its supervisor");

    // A record whose marker and start time do not match is never acted on,
    // even though its process-group ID names live processes.
    let mut forged = group.clone();
    forged.marker = "0".repeat(32);
    forged.leader_start = Some("1".into());
    match luuna_executor::reconcile_process_group(&forged) {
        GroupReconciliation::Unverified { processes, .. } => {
            assert!(processes
                .iter()
                .any(|p| p.contains(&format!("pid {orphan}"))))
        }
        other => panic!("an unverifiable group must not be signalled: {other:?}"),
    }
    assert!(alive(orphan));

    match luuna_executor::reconcile_process_group(&group) {
        GroupReconciliation::Reaped(processes) => {
            assert!(
                processes
                    .iter()
                    .any(|p| p.contains(&format!("pid {orphan}"))),
                "{processes:?}"
            )
        }
        other => panic!("the recorded survivor must be reaped: {other:?}"),
    }
    assert!(!alive(orphan));
    assert_eq!(
        luuna_executor::reconcile_process_group(&group),
        GroupReconciliation::Gone
    );
}
