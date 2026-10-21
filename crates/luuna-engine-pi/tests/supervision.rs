//! Synthetic subprocess lifecycle tests, no provider requests.
use luuna_engine_pi::{
    install_scope_guard, EngineError, PiConfig, PiProcess, Record, ReviewerProfile, SessionProfile,
    WriterProfile, MAX_RECORD_BYTES,
};
use serde_json::json;
use std::{path::PathBuf, time::Duration};

/// A fixture session in its own directories; `flags` are fixture markers.
fn config(name: &str, flags: &[&str]) -> PiConfig {
    let root = std::env::temp_dir().join(format!(
        "luuna-pi-supervision-{}-{name}",
        std::process::id(),
    ));
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/pi-rpc/mock_pi.py")
        .canonicalize()
        .unwrap();
    let mut launcher_args = vec![script.to_string_lossy().into_owned()];
    launcher_args.extend(flags.iter().map(|flag| flag.to_string()));
    PiConfig {
        program: if cfg!(windows) { "python" } else { "python3" }.into(),
        launcher_args,
        cwd: root.join("work"),
        config_dir: root.join("config"),
        provider: None,
        model: None,
        profile: Default::default(),
    }
}

#[tokio::test]
async fn correlation_rejects_unknown_response_ids() {
    let mut process = PiProcess::spawn(&config("correlation", &[])).await.unwrap();
    process
        .command("prompt-1", "prompt", json!({"message":"wrong_id"}))
        .await
        .unwrap();
    assert!(matches!(
        process.next().await,
        Err(EngineError::Protocol(_))
    ));
    process.stop().await.unwrap();
}

#[tokio::test]
async fn stop_deadline_survives_a_stalled_stdin_pipe() {
    let mut process = PiProcess::spawn(&config("stall", &["--stall-stdin"]))
        .await
        .unwrap();
    let large = "x".repeat(4 * 1024 * 1024);
    let writing = tokio::time::timeout(
        Duration::from_millis(100),
        process.command("prompt-1", "prompt", json!({"message":large})),
    )
    .await;
    assert!(
        writing.is_err(),
        "fixture must stop reading the full stdin pipe"
    );
    tokio::time::timeout(Duration::from_secs(4), process.stop())
        .await
        .expect("cleanup must have a fixed deadline")
        .unwrap();
}

#[tokio::test]
async fn reviewer_session_emits_structured_result_with_only_read_tools() {
    let mut config = config("reviewer", &[]);
    config.cwd = config.cwd.join("reviewer-candidate");
    config.config_dir = config.config_dir.join("independent-reviewer");
    let extension = install_scope_guard(&config.config_dir).unwrap();
    let scope = json!({"root":config.cwd,"paths":["src"],"operations":["read"]});
    config.profile = SessionProfile::Reviewer(ReviewerProfile {
        // The original writer marker must not route the reviewer into a writer.
        system_prompt: "Luuna independent reviewer; fixture:write_in_scope".into(),
        extensions: vec![extension],
        environment: vec![("LUUNA_SCOPE_JSON".into(), scope.to_string())],
    });
    let mut process = PiProcess::spawn(&config).await.unwrap();
    let assignment = json!({"assignment":"Luuna independent reviewer",
        "candidate_hash":"sha256:exact-candidate", "reviewer_session":"independent-session",
        "requirements":{"intent":"fixture:review_blocking"},
        "checks":[{"status":"passed"}], "diff":"+seeded regression"});
    process
        .command(
            "review",
            "prompt",
            json!({"message":assignment.to_string()}),
        )
        .await
        .unwrap();
    let result = tokio::time::timeout(Duration::from_secs(5), async {
        let mut result = None;
        let mut saw_profile = false;
        loop {
            let record = process.next().await.unwrap();
            if record.kind == "fixture_args" {
                // Only tools whose helper programs exist here are declared.
                assert_eq!(record.raw["tools"], process.tools().declared.join(","));
                assert!(process.tools().declared.len() + process.tools().omitted.len() == 4);
                assert_eq!(record.raw["scope"], scope);
                assert_eq!(record.raw["reviewer"], true);
                saw_profile = true;
            }
            if let Some(text) = record.assistant_text() {
                result = Some(serde_json::from_str::<serde_json::Value>(&text).unwrap());
            }
            if record.kind == "agent_settled" {
                assert!(saw_profile);
                return result.unwrap();
            }
        }
    })
    .await
    .unwrap();
    process.stop().await.unwrap();
    assert_eq!(result["candidate_hash"], "sha256:exact-candidate");
    assert_eq!(result["reviewer_session"], "independent-session");
    assert_eq!(result["verdict"], "changes_required");
    assert_eq!(result["findings"][0]["severity"], "blocking");
    assert!(
        !config.cwd.join("src/main.py").exists(),
        "reviewer invoked writer behavior"
    );
}

/// Prompts a fresh fixture session and returns its records through
/// `agent_settled`, or the first error.
async fn session(name: &str, scenario: &str) -> Result<Vec<Record>, EngineError> {
    let mut process = PiProcess::spawn(&config(name, &[])).await.unwrap();
    process
        .command("prompt-1", "prompt", json!({"message": scenario}))
        .await
        .unwrap();
    let mut records = Vec::new();
    let result = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let record = process.next().await?;
            let settled = record.kind == "agent_settled";
            records.push(record);
            if settled {
                return Ok(());
            }
        }
    })
    .await
    .expect("fixture session must settle or fail");
    process.stop().await.unwrap();
    result.map(|()| records)
}

#[tokio::test]
async fn aggregate_events_beyond_the_record_cap_are_summarized_not_fatal() {
    // Pi's turn_end and agent_end repeat every tool result of the run, so a
    // normal session that reads many files emits them above 1 MiB.
    let records = session("large-agent-end", "large_agent_end").await.unwrap();
    for kind in ["turn_end", "agent_end"] {
        let record = records.iter().find(|record| record.kind == kind).unwrap();
        let bytes = record.raw["luuna_summary"]["record_bytes"]
            .as_u64()
            .unwrap();
        assert!(bytes > MAX_RECORD_BYTES as u64, "{kind}: {bytes}");
        assert!(
            record.raw.to_string().len() < 64 * 1024,
            "{kind} summary is bounded"
        );
        assert_eq!(record.model_error(), None);
    }
    let end = records
        .iter()
        .find(|record| record.kind == "agent_end")
        .unwrap();
    assert_eq!(end.raw["willRetry"], false);
    assert_eq!(end.raw["luuna_summary"]["messages"], 44);
    assert_eq!(records.last().unwrap().raw["aborted"], false);

    // The failure the runtime reads from agent_end survives the summary.
    let records = session("large-agent-end-error", "large_agent_end_error")
        .await
        .unwrap();
    let end = records
        .iter()
        .find(|record| record.kind == "agent_end")
        .unwrap();
    assert_eq!(
        end.model_error().as_deref(),
        Some("synthetic provider failure after large reads")
    );

    // Oversized records are still validated, and unknown kinds stay fatal.
    for (name, scenario, expected) in [
        ("large-malformed", "malformed_large_agent_end", "willRetry"),
        ("large-unknown", "oversized_unknown", "record exceeds 1 MiB"),
    ] {
        match session(name, scenario).await {
            Err(EngineError::Protocol(reason)) => assert!(reason.contains(expected), "{reason}"),
            other => panic!("{scenario}: {other:?}"),
        }
    }
}

#[tokio::test]
async fn startup_failures_report_exit_status_and_a_redacted_stderr_tail() {
    // Pi prints why it cannot start (an unknown provider, a broken extension)
    // only on stderr; without it every run failed with a bare transport error.
    let mut process = PiProcess::spawn(&config("fail-startup", &["--fail-startup"]))
        .await
        .unwrap();
    let reason = match process.command("state-1", "get_state", json!({})).await {
        Err(error) => error.to_string(),
        Ok(()) => process.next().await.unwrap_err().to_string(),
    };
    process.stop().await.unwrap();
    assert!(
        reason.contains("Error: Unknown provider \"nosuchprovider\""),
        "{reason}"
    );
    assert!(reason.contains("Pi exited with"), "{reason}");
    assert!(reason.contains("proxy.invalid:8080"), "{reason}");
    for secret in ["proxy-password", "sk-synthetic0123456789"] {
        assert!(!reason.contains(secret), "{secret} leaked: {reason}");
    }
}

#[tokio::test]
async fn version_probe_uses_the_private_agent_directory() {
    // Pi 1.3.0 reads its global settings before answering --version; the
    // probe must not reach the user's own Pi configuration.
    let mut process =
        PiProcess::spawn(&config("isolated-version", &["--require-isolated-version"]))
            .await
            .unwrap();
    process.stop().await.unwrap();
}

#[tokio::test]
async fn writer_instructions_beyond_argument_limits_reach_pi_through_a_private_file() {
    // The largest ticket the domain accepts: 32 criteria of 16,000 bytes,
    // far above Linux's 128 KiB per-argument limit.
    let mut config = config("large-writer", &[]);
    let criteria: Vec<String> = (0..32)
        .map(|i| format!("criterion {i}: {}", "c".repeat(15_980)))
        .collect();
    let prompt = format!(
        "You are the Luuna writer.\nAcceptance criteria: fixture:no_change | {}",
        criteria.join(" | ")
    );
    assert!(prompt.len() > 500_000);
    config.profile = SessionProfile::Writer(WriterProfile {
        tools: vec!["read".into(), "write".into()],
        system_prompt: prompt.clone(),
        extensions: vec![],
        environment: vec![],
    });
    let mut process = PiProcess::spawn(&config).await.unwrap();
    let file = config.config_dir.join(luuna_engine_pi::SYSTEM_PROMPT_FILE);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), prompt);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    process
        .command("prompt-1", "prompt", json!({"message": "go"}))
        .await
        .unwrap();
    let mut seen = None;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let record = process.next().await.unwrap();
            if record.kind == "fixture_args" {
                seen = Some(record.raw.clone());
            }
            if record.kind == "agent_settled" {
                return;
            }
        }
    })
    .await
    .unwrap();
    process.stop().await.unwrap();
    let seen = seen.unwrap();
    assert_eq!(seen["system_prompt_from_file"], true);
    assert_eq!(seen["system_prompt_bytes"], prompt.len());
}
