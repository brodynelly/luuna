//! Genuine installed Pi handshake; deliberately makes no provider request.
use luuna_engine_pi::{session_tools, PiConfig, PiProcess, ReviewerProfile, SessionProfile};
use serde_json::json;
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::temp_dir().join(format!("luuna-real-pi-probe-{}", std::process::id()));
    let config = PiConfig {
        program: std::env::var("LUUNA_PI_COMMAND")
            .unwrap_or_else(|_| "pi".into())
            .into(),
        launcher_args: serde_json::from_str(
            &std::env::var("LUUNA_PI_ARGS_JSON").unwrap_or_else(|_| "[]".into()),
        )?,
        cwd: root.join("work"),
        config_dir: root.join("config"),
        provider: None,
        model: None,
        profile: Default::default(),
    };
    let mut process = PiProcess::spawn(&config).await?;
    for (id, command) in [
        ("probe-state", "get_state"),
        ("probe-models", "get_available_models"),
        ("probe-abort", "abort"),
    ] {
        process.command(id, command, json!({})).await?;
        let record =
            tokio::time::timeout(std::time::Duration::from_secs(15), process.next()).await??;
        if record.raw["id"] != id || record.raw["success"] != true {
            return Err(format!("{command} rejected").into());
        }
        println!("{command}: genuine Pi RPC acknowledged");
    }
    process.stop().await?;
    // Pi runs offline, so grep and find work only where their helper
    // programs (rg, fd) are already installed; sessions omit them otherwise.
    let reviewer = PiConfig {
        profile: SessionProfile::Reviewer(ReviewerProfile {
            system_prompt: String::new(),
            extensions: vec![],
            environment: vec![],
        }),
        ..config
    };
    let tools = session_tools(&reviewer);
    println!("file tools available: {}", tools.declared.join(", "));
    for (tool, reason) in &tools.omitted {
        println!("file tool omitted: {tool} ({reason})");
    }
    let _ = std::fs::remove_dir_all(root);
    println!("Pi 1.3.0 subprocess stopped and reaped; provider execution not tested");
    Ok(())
}
