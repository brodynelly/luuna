use luuna_runtime::{router, AppState, RuntimeConfig};
use std::{
    net::{Ipv4Addr, SocketAddrV4},
    path::PathBuf,
};

mod admin;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // `backup`, `restore` and `check` maintain the data directory and exit.
    if let Some(outcome) = admin::dispatch(std::env::args_os().skip(1)) {
        return outcome;
    }
    let data_dir =
        PathBuf::from(std::env::var("LUUNA_DATA_DIR").unwrap_or_else(|_| ".luuna".into()));
    let data_dir = if data_dir.is_absolute() {
        data_dir
    } else {
        std::env::current_dir()?.join(data_dir)
    };
    let token = std::env::var("LUUNA_API_TOKEN")
        .map_err(|_| "set LUUNA_API_TOKEN to a random token of at least 32 bytes")?;
    let launcher_args = match std::env::var("LUUNA_PI_ARGS_JSON") {
        Ok(raw) => serde_json::from_str::<Vec<String>>(&raw)?,
        Err(_) => Vec::new(),
    };
    let port: u16 = std::env::var("LUUNA_PORT")
        .unwrap_or_else(|_| "4242".into())
        .parse()?;
    let config = RuntimeConfig {
        data_dir,
        pi_program: PathBuf::from(
            std::env::var("LUUNA_PI_COMMAND").unwrap_or_else(|_| "pi".into()),
        ),
        pi_launcher_args: launcher_args,
        git_program: PathBuf::from(
            std::env::var("LUUNA_GIT_COMMAND").unwrap_or_else(|_| "git".into()),
        ),
        provider: std::env::var("LUUNA_PI_PROVIDER").ok(),
        model: std::env::var("LUUNA_PI_MODEL").ok(),
        token,
        max_run_seconds: std::env::var("LUUNA_RUN_TIMEOUT_SECONDS")
            .unwrap_or_else(|_| "600".into())
            .parse()?,
    };
    let state = AppState::open(config)?;
    let listener =
        tokio::net::TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).await?;
    eprintln!(
        "Luuna tool-free Pi demo listening on http://{}",
        listener.local_addr()?
    );
    let shutdown_state = state.clone();
    axum::serve(listener, router(state))
        .with_graceful_shutdown(async move {
            tokio::select! {
                _ = termination_requested() => {},
                _ = shutdown_state.wait_for_shutdown_request() => {},
            }
            shutdown_state.shutdown().await;
        })
        .await?;
    Ok(())
}

/// Ctrl+C and, on Unix, SIGTERM from a supervisor both request the explicit
/// shutdown path: owned workers are stopped and interruption is persisted.
async fn termination_requested() {
    #[cfg(unix)]
    {
        let mut terminate =
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(signal) => signal,
                Err(_) => {
                    let _ = tokio::signal::ctrl_c().await;
                    return;
                }
            };
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = terminate.recv() => {},
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
