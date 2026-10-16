//! Supervised JSONL transport for pinned Pi. A response acknowledges a command;
//! only `agent_settled` finishes all automatic work in Pi 1.3.0. No shell is used.
use serde_json::{json, Value};
use std::{collections::HashMap, path::PathBuf, process::Stdio, time::Duration};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    task::JoinHandle,
};

pub const PI_PACKAGE: &str = "@earendil-works/pi-coding-agent";
pub const PI_VERSION: &str = "1.3.0";
pub const MAX_RECORD_BYTES: usize = 1024 * 1024;

/// Direct provider API-key variables the isolated child may inherit. Each also
/// accepts a `LUUNA_PI_` prefixed alias for hosts that reserve the plain name;
/// the alias takes precedence and is never passed through under its own name.
pub const PROVIDER_KEY_VARIABLES: [&str; 8] = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "MISTRAL_API_KEY",
    "GROQ_API_KEY",
    "XAI_API_KEY",
    "OPENROUTER_API_KEY",
];

/// Names (never values) of provider credentials the child would receive from
/// the current process environment, after alias resolution.
pub fn configured_provider_keys() -> Vec<&'static str> {
    PROVIDER_KEY_VARIABLES
        .into_iter()
        .filter(|name| {
            std::env::var_os(format!("LUUNA_PI_{name}")).is_some()
                || std::env::var_os(name).is_some()
        })
        .collect()
}

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("Pi I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid Pi RPC record: {0}")]
    Protocol(String),
    #[error("Pi closed stdout before the operation completed")]
    Closed,
    #[error("Pi command {command} failed: {message}")]
    Rejected { command: String, message: String },
    #[error("Pi RPC timed out")]
    Timeout,
}

#[derive(Clone, Debug)]
pub struct PiConfig {
    pub program: PathBuf,
    /// Launcher arguments (e.g. Node's absolute path to Pi's cli.js). Never shell text.
    pub launcher_args: Vec<String>,
    pub cwd: PathBuf,
    pub config_dir: PathBuf,
    pub provider: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Record {
    pub kind: String,
    pub raw: Value,
}

impl Record {
    pub fn parse(line: &[u8]) -> Result<Self, EngineError> {
        if line.len() > MAX_RECORD_BYTES {
            return Err(EngineError::Protocol("record exceeds 1 MiB".into()));
        }
        let raw: Value =
            serde_json::from_slice(line).map_err(|e| EngineError::Protocol(e.to_string()))?;
        let kind = raw
            .get("type")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| EngineError::Protocol("record requires a nonempty type".into()))?
            .to_owned();
        if kind == "response"
            && (raw.get("id").and_then(Value::as_str).is_none()
                || raw.get("command").and_then(Value::as_str).is_none()
                || raw.get("success").and_then(Value::as_bool).is_none())
        {
            return Err(EngineError::Protocol(
                "response requires id, command and success".into(),
            ));
        }
        // Pi 1.3.0 session events carry mandatory completion fields. Missing
        // or mistyped fields cannot serve as evidence that a run succeeded.
        let invalid = match kind.as_str() {
            "agent_settled" if raw.get("aborted").and_then(Value::as_bool).is_none() => {
                Some("agent_settled requires aborted boolean")
            }
            "agent_end"
                if !raw
                    .get("messages")
                    .and_then(Value::as_array)
                    .is_some_and(|messages| messages.iter().all(Value::is_object))
                    || raw.get("willRetry").and_then(Value::as_bool).is_none() =>
            {
                Some("agent_end requires messages array of objects and willRetry boolean")
            }
            "message_end" if !raw.get("message").is_some_and(Value::is_object) => {
                Some("message_end requires message object")
            }
            _ => None,
        };
        if let Some(message) = invalid {
            return Err(EngineError::Protocol(message.into()));
        }
        Ok(Self { kind, raw })
    }

    pub fn model_error(&self) -> Option<String> {
        let messages: Vec<&Value> = if self.kind == "agent_end" {
            self.raw
                .get("messages")
                .and_then(Value::as_array)
                .map(|a| a.iter().collect())
                .unwrap_or_default()
        } else if self.kind == "message_end" {
            self.raw.get("message").into_iter().collect()
        } else {
            Vec::new()
        };
        messages.into_iter().find_map(|message| {
            let reason = message.get("stopReason").and_then(Value::as_str);
            if matches!(reason, Some("error" | "aborted")) {
                Some(
                    message
                        .get("errorMessage")
                        .and_then(Value::as_str)
                        .unwrap_or("model operation failed")
                        .to_owned(),
                )
            } else {
                None
            }
        })
    }
}

pub struct PiProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    stderr_drain: JoinHandle<()>,
    pending: HashMap<String, String>,
}

impl PiProcess {
    /// Launch a fresh, tool-free session in an empty cwd/config directory. Only
    /// named provider credentials are inherited; Git/publication auth is excluded.
    pub async fn spawn(config: &PiConfig) -> Result<Self, EngineError> {
        verify_version(config).await?;
        private_directory(&config.cwd)?;
        private_directory(&config.config_dir)?;
        let mut command = Command::new(&config.program);
        command.args(&config.launcher_args).args([
            "--mode", "rpc", "--no-session", "--no-tools", "--no-extensions",
            "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
            "--no-mcp", "--no-approve", "--offline",
            "--system-prompt", "You are the Luuna read-only connectivity demo. You have no tools. Answer the user's request as plain text.",
        ]);
        if let Some(provider) = &config.provider {
            command.arg("--provider").arg(provider);
        }
        if let Some(model) = &config.model {
            command.arg("--model").arg(model);
        }
        command.env_clear();
        for name in [
            "PATH",
            "SystemRoot",
            "WINDIR",
            "TEMP",
            "TMP",
            "TMPDIR",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "no_proxy",
            "NODE_USE_ENV_PROXY",
        ] {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }
        // Cloud secret bindings can use the non-reserved `LUUNA_PI_` alias when
        // the platform reserves the provider's own name. Pi only reads the
        // standard name, so the alias is mapped and never passed through itself.
        for name in PROVIDER_KEY_VARIABLES {
            if let Some(value) =
                std::env::var_os(format!("LUUNA_PI_{name}")).or_else(|| std::env::var_os(name))
            {
                command.env(name, value);
            }
        }
        command
            .env("HOME", &config.config_dir)
            .env("USERPROFILE", &config.config_dir)
            .env("PI_CODING_AGENT_DIR", &config.config_dir)
            .current_dir(&config.cwd)
            .kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command.spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| EngineError::Protocol("stdin unavailable".into()))?;
        let stdout = BufReader::new(
            child
                .stdout
                .take()
                .ok_or_else(|| EngineError::Protocol("stdout unavailable".into()))?,
        );
        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| EngineError::Protocol("stderr unavailable".into()))?;
        // Drain rather than expose diagnostics that may contain upstream paths or credentials.
        let stderr_drain = tokio::spawn(async move {
            let _ = tokio::io::copy(&mut stderr, &mut tokio::io::sink()).await;
        });
        Ok(Self {
            child,
            stdin,
            stdout,
            stderr_drain,
            pending: HashMap::new(),
        })
    }

    /// Operating-system process ID of the owned child while it has not been reaped.
    pub fn pid(&self) -> Option<u32> {
        self.child.id()
    }

    pub async fn command(
        &mut self,
        id: &str,
        command_type: &str,
        mut data: Value,
    ) -> Result<(), EngineError> {
        if self.pending.contains_key(id) {
            return Err(EngineError::Protocol("duplicate command ID".into()));
        }
        self.pending.insert(id.to_owned(), command_type.to_owned());
        data["id"] = json!(id);
        data["type"] = json!(command_type);
        let mut bytes =
            serde_json::to_vec(&data).map_err(|e| EngineError::Protocol(e.to_string()))?;
        bytes.push(b'\n');
        self.stdin.write_all(&bytes).await?;
        self.stdin.flush().await?;
        Ok(())
    }

    /// Bounded LF framing, including Unicode separators inside JSON strings.
    pub async fn next(&mut self) -> Result<Record, EngineError> {
        let mut line = Vec::new();
        loop {
            let available = self.stdout.fill_buf().await?;
            if available.is_empty() {
                return Err(EngineError::Closed);
            }
            let count = available
                .iter()
                .position(|b| *b == b'\n')
                .map(|p| p + 1)
                .unwrap_or(available.len());
            if line.len() + count > MAX_RECORD_BYTES {
                return Err(EngineError::Protocol("record exceeds 1 MiB".into()));
            }
            let complete = available[count - 1] == b'\n';
            line.extend_from_slice(&available[..count]);
            self.stdout.consume(count);
            if complete {
                break;
            }
        }
        let record = Record::parse(&line)?;
        if record.kind == "response" {
            let id = record.raw["id"].as_str().unwrap_or_default();
            let expected = self
                .pending
                .remove(id)
                .ok_or_else(|| EngineError::Protocol(format!("unknown response ID {id}")))?;
            if record.raw["command"].as_str() != Some(&expected) {
                return Err(EngineError::Protocol(
                    "response command does not match request".into(),
                ));
            }
        }
        Ok(record)
    }

    /// Abort is a request, not proof the process has stopped. Always reap it.
    pub async fn stop(&mut self) -> Result<(), EngineError> {
        let _ = tokio::time::timeout(
            Duration::from_secs(1),
            self.command("shutdown-abort", "abort", json!({})),
        )
        .await;
        let _ = tokio::time::timeout(Duration::from_secs(1), self.stdin.shutdown()).await;
        let _ = tokio::time::timeout(Duration::from_millis(150), self.child.wait()).await;
        if self.child.try_wait()?.is_none() {
            self.child.kill().await?;
        }
        self.child.wait().await?;
        self.stderr_drain.abort();
        Ok(())
    }
}

fn private_directory(path: &std::path::Path) -> Result<(), std::io::Error> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)
}

/// Reject unsupported launchers before any provider request. The configured
/// launcher is trusted local configuration, never an API request parameter.
pub async fn verify_version(config: &PiConfig) -> Result<(), EngineError> {
    let mut command = Command::new(&config.program);
    command
        .args(&config.launcher_args)
        .arg("--version")
        .env_clear()
        .kill_on_drop(true);
    for name in ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    let output = tokio::time::timeout(Duration::from_secs(15), command.output())
        .await
        .map_err(|_| EngineError::Timeout)??;
    if !output.status.success() || String::from_utf8_lossy(&output.stdout).trim() != PI_VERSION {
        return Err(EngineError::Protocol(format!(
            "unsupported Pi version; expected {PI_VERSION}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prompt_acceptance_is_not_completion() {
        let ack =
            Record::parse(br#"{"type":"response","id":"p1","command":"prompt","success":true}"#)
                .unwrap();
        assert_ne!(ack.kind, "agent_end");
    }
    #[test]
    fn rejects_malformed_records() {
        for value in ["not json", "{}", r#"{"type":"response","success":true}"#] {
            assert!(Record::parse(value.as_bytes()).is_err());
        }
    }
    #[test]
    fn preserves_unknown_events_and_unicode() {
        let record =
            Record::parse("{\"type\":\"future_event\",\"text\":\"a\u{2028}b\"}".as_bytes())
                .unwrap();
        assert_eq!(record.kind, "future_event");
        assert_eq!(record.raw["text"], "a\u{2028}b");
    }
    #[test]
    fn agent_end_can_contain_provider_failure() {
        let record = Record::parse(br#"{"type":"agent_end","messages":[{"role":"assistant","stopReason":"error","errorMessage":"missing credentials"}],"willRetry":false}"#).unwrap();
        assert_eq!(record.model_error().as_deref(), Some("missing credentials"));
    }

    #[test]
    fn rejects_malformed_known_completion_shapes() {
        for raw in [
            json!({"type":"agent_settled"}),
            json!({"type":"agent_settled","aborted":"false"}),
            json!({"type":"agent_settled","aborted":null}),
            json!({"type":"agent_end","messages":[]}),
            json!({"type":"agent_end","messages":{},"willRetry":false}),
            json!({"type":"agent_end","messages":[null],"willRetry":false}),
            json!({"type":"agent_end","messages":[],"willRetry":"false"}),
            json!({"type":"message_end"}),
            json!({"type":"message_end","message":null}),
            json!({"type":"message_end","message":[]}),
        ] {
            assert!(
                matches!(
                    Record::parse(raw.to_string().as_bytes()),
                    Err(EngineError::Protocol(_))
                ),
                "{raw}"
            );
        }
        assert!(Record::parse(br#"{"type":"agent_settled","aborted":false}"#).is_ok());
        assert!(Record::parse(br#"{"type":"agent_end","messages":[],"willRetry":false}"#).is_ok());
    }
}
