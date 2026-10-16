//! Genuine installed Pi handshake; deliberately makes no provider request.
use luuna_engine_pi::{PiConfig, PiProcess};
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
    let _ = std::fs::remove_dir_all(root);
    println!("Pi 1.3.0 subprocess stopped and reaped; provider execution not tested");
    Ok(())
}
