//! Synthetic subprocess lifecycle tests, no provider requests.
use luuna_engine_pi::{EngineError, PiConfig, PiProcess};
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
