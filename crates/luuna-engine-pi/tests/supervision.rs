//! Synthetic subprocess lifecycle tests, no provider requests.
use luuna_engine_pi::{
    install_scope_guard, EngineError, PiConfig, PiProcess, ReviewerProfile, SessionProfile,
};
use serde_json::json;
use std::{path::PathBuf, time::Duration};

fn config(stall: bool) -> PiConfig {
    let root = std::env::temp_dir().join(format!(
        "luuna-pi-supervision-{}-{}",
        std::process::id(),
        if stall { "stall" } else { "normal" }
    ));
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/pi-rpc/mock_pi.py")
        .canonicalize()
        .unwrap();
    let mut launcher_args = vec![script.to_string_lossy().into_owned()];
    if stall {
        launcher_args.push("--stall-stdin".into());
    }
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
    let mut process = PiProcess::spawn(&config(false)).await.unwrap();
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
    let mut process = PiProcess::spawn(&config(true)).await.unwrap();
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
    let mut config = config(false);
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
                assert_eq!(record.raw["tools"], "read,grep,find,ls");
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
