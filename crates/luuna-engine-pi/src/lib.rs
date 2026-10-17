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
    pub profile: SessionProfile,
}

/// What a session may do. Every profile disables discovered resources,
/// sessions, MCP, skills and context files; only the explicit items below load.
#[derive(Clone, Debug, Default)]
pub enum SessionProfile {
    /// The M1 connectivity demo: no tools at all.
    #[default]
    ToolFree,
    /// An approved writer (M2c): named built-in tools inside a leased worktree,
    /// the Luuna scope guard loaded explicitly, and a task-specific prompt.
    Writer(WriterProfile),
    /// A fresh independent reviewer (M3): file reads only, with no writer
    /// session or conversation restored. The runtime supplies candidate evidence.
    Reviewer(ReviewerProfile),
}

#[derive(Clone, Debug)]
pub struct WriterProfile {
    /// Built-in tool names declared to the model, e.g. `read`, `edit`, `write`.
    pub tools: Vec<String>,
    pub system_prompt: String,
    /// Extension files loaded with `-e`; the scope guard is always one of them.
    pub extensions: Vec<PathBuf>,
    /// Extra variables for the child, such as `LUUNA_SCOPE_JSON`.
    pub environment: Vec<(String, String)>,
}

#[derive(Clone, Debug)]
pub struct ReviewerProfile {
    pub system_prompt: String,
    pub extensions: Vec<PathBuf>,
    /// Normally LUUNA_SCOPE_JSON with only the `read` operation. The reviewer
    /// cannot widen its tool set: those tools are fixed below, not prompt input.
    pub environment: Vec<(String, String)>,
}

/// The Luuna scope guard extension, written into a private directory per attempt.
pub const SCOPE_GUARD_SOURCE: &str = include_str!("../assets/luuna-scope-guard.js");

/// Write the scope guard beside the attempt's Pi configuration and return its path.
pub fn install_scope_guard(dir: &std::path::Path) -> Result<PathBuf, std::io::Error> {
    private_directory(dir)?;
    let path = dir.join("luuna-scope-guard.js");
    std::fs::write(&path, SCOPE_GUARD_SOURCE)?;
    Ok(path)
}

/// Command-line arguments for a profile, after the launcher arguments.
pub fn session_arguments(config: &PiConfig) -> Vec<String> {
    let mut args: Vec<String> = [
        "--mode",
        "rpc",
        "--no-session",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-context-files",
        "--no-mcp",
        "--no-approve",
        "--offline",
    ]
    .into_iter()
    .map(ToOwned::to_owned)
    .collect();
    match &config.profile {
        SessionProfile::ToolFree => {
            args.push("--no-tools".into());
            args.push("--system-prompt".into());
            args.push("You are the Luuna read-only connectivity demo. You have no tools. Answer the user's request as plain text.".into());
        }
        SessionProfile::Writer(profile) => {
            args.push("--tools".into());
            args.push(profile.tools.join(","));
            for extension in &profile.extensions {
                args.push("--extension".into());
                args.push(extension.to_string_lossy().into_owned());
            }
            args.push("--system-prompt".into());
            args.push(profile.system_prompt.clone());
        }
        SessionProfile::Reviewer(profile) => {
            args.push("--tools".into());
            args.push("read,grep,find,ls".into());
            for extension in &profile.extensions {
                args.push("--extension".into());
                args.push(extension.to_string_lossy().into_owned());
            }
            args.push("--system-prompt".into());
            args.push(profile.system_prompt.clone());
        }
    }
    if let Some(provider) = &config.provider {
        args.push("--provider".into());
        args.push(provider.clone());
    }
    if let Some(model) = &config.model {
        args.push("--model".into());
        args.push(model.clone());
    }
    args
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

    /// Completed assistant text only. Partial deltas, user/tool messages and
    /// `agent_end` repeats are not a structured review result. Runtime code must
    /// still validate the JSON and bind its verdict to the exact candidate.
    pub fn assistant_text(&self) -> Option<String> {
        if self.kind != "message_end" {
            return None;
        }
        let message = self.raw.get("message")?;
        if message.get("role")?.as_str()? != "assistant"
            || message.get("stopReason").and_then(Value::as_str) != Some("stop")
        {
            return None;
        }
        let content = message.get("content")?.as_array()?;
        let text: Vec<&str> = content
            .iter()
            .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect();
        (!text.is_empty()).then(|| text.join("\n"))
    }
}

/// Monotonic session cost in micros across assistant/tool turns. Pi's message
/// updates repeat the current message's cumulative usage, while each completed
/// assistant message adds a new cost. `agent_end` repeats those same messages
/// and must never charge them again. This counter is local measurement; the
/// runtime persists its deltas so interruptions cannot reset consumed budgets.
#[derive(Debug, Default)]
pub struct SessionUsage {
    completed_cost: u64,
    current_cost: u64,
    total_cost: u64,
}

impl SessionUsage {
    pub fn observe(&mut self, record: &Record) -> u64 {
        let message = &record.raw["message"];
        let assistant = message["role"] == "assistant";
        let cost = message["usage"]["cost"]["total"]
            .as_f64()
            .or_else(|| record.raw["usage"]["cost"]["total"].as_f64())
            .filter(|cost| cost.is_finite() && *cost >= 0.0)
            .map(|cost| (cost * 1_000_000.0).ceil() as u64);
        match record.kind.as_str() {
            "message_start" if assistant => {
                // Retain provisional spend if a provider retry starts another
                // message without a terminal event for the previous request.
                self.completed_cost = self.completed_cost.saturating_add(self.current_cost);
                self.current_cost = cost.unwrap_or(0);
            }
            "message_update" if assistant || message.is_null() => {
                self.current_cost = self.current_cost.max(cost.unwrap_or(0));
            }
            "message_end" if assistant => {
                self.completed_cost = self
                    .completed_cost
                    .saturating_add(self.current_cost.max(cost.unwrap_or(0)));
                self.current_cost = 0;
            }
            _ => {}
        }
        self.total_cost = self
            .total_cost
            .max(self.completed_cost.saturating_add(self.current_cost));
        self.total_cost
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
    /// Launch a fresh session with its explicit profile. Only named provider
    /// credentials are inherited; Git/publication auth is excluded. The runtime
    /// gives every assignment a separate private configuration directory.
    pub async fn spawn(config: &PiConfig) -> Result<Self, EngineError> {
        verify_version(config).await?;
        private_directory(&config.cwd)?;
        private_directory(&config.config_dir)?;
        let mut command = Command::new(&config.program);
        command
            .args(&config.launcher_args)
            .args(session_arguments(config));
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
        let environment = match &config.profile {
            SessionProfile::Writer(profile) => &profile.environment[..],
            SessionProfile::Reviewer(profile) => &profile.environment[..],
            SessionProfile::ToolFree => &[],
        };
        for (name, value) in environment {
            command.env(name, value);
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
    fn writer_profile_declares_tools_guard_and_prompt_while_demo_stays_tool_free() {
        let base = PiConfig {
            program: "pi".into(),
            launcher_args: vec![],
            cwd: "/tmp/work".into(),
            config_dir: "/tmp/config".into(),
            provider: Some("openrouter".into()),
            model: Some("m".into()),
            profile: SessionProfile::ToolFree,
        };
        let demo = session_arguments(&base);
        assert!(demo.contains(&"--no-tools".to_owned()));
        assert!(demo.contains(&"--no-extensions".to_owned()));
        assert!(!demo.contains(&"--tools".to_owned()));
        let writer = PiConfig {
            profile: SessionProfile::Writer(WriterProfile {
                tools: vec!["read".into(), "edit".into(), "write".into()],
                system_prompt: "task".into(),
                extensions: vec!["/tmp/config/luuna-scope-guard.js".into()],
                environment: vec![("LUUNA_SCOPE_JSON".into(), "{}".into())],
            }),
            ..base
        };
        let args = session_arguments(&writer);
        let position = |flag: &str| args.iter().position(|a| a == flag).unwrap();
        assert_eq!(args[position("--tools") + 1], "read,edit,write");
        assert_eq!(
            args[position("--extension") + 1],
            "/tmp/config/luuna-scope-guard.js"
        );
        assert_eq!(args[position("--system-prompt") + 1], "task");
        assert!(!args.contains(&"--no-tools".to_owned()));
        // Discovery stays off even for writers; only the explicit extension loads.
        assert!(args.contains(&"--no-extensions".to_owned()));
        assert!(args.contains(&"--no-mcp".to_owned()));
        assert!(SCOPE_GUARD_SOURCE.contains("tool_call"));
    }

    #[test]
    fn prompt_acceptance_is_not_completion() {
        let ack =
            Record::parse(br#"{"type":"response","id":"p1","command":"prompt","success":true}"#)
                .unwrap();
        assert_ne!(ack.kind, "agent_end");
    }

    #[test]
    fn reviewer_profile_has_only_read_tools_and_no_restored_resources() {
        let config = PiConfig {
            program: "pi".into(),
            launcher_args: vec![],
            cwd: "/tmp/candidate".into(),
            config_dir: "/tmp/independent-reviewer".into(),
            provider: None,
            model: None,
            profile: SessionProfile::Reviewer(ReviewerProfile {
                system_prompt: "Luuna independent reviewer; exact candidate evidence".into(),
                extensions: vec!["/tmp/independent-reviewer/luuna-scope-guard.js".into()],
                environment: vec![("LUUNA_SCOPE_JSON".into(), "{}".into())],
            }),
        };
        let args = session_arguments(&config);
        assert_eq!(
            args[args.iter().position(|arg| arg == "--tools").unwrap() + 1],
            "read,grep,find,ls"
        );
        for flag in [
            "--no-session",
            "--no-context-files",
            "--no-mcp",
            "--no-skills",
            "--no-extensions",
        ] {
            assert!(args.iter().any(|arg| arg == flag));
        }
        assert!(args.iter().any(|arg| arg == "--extension"));
    }

    #[test]
    fn review_text_comes_only_from_successful_completed_assistant_messages() {
        let text = r#"{"passed":true,"findings":[]}"#;
        let record = Record::parse(
            json!({"type":"message_end","message":{
                "role":"assistant","stopReason":"stop","content":[{"type":"text","text":text}]
            }})
            .to_string()
            .as_bytes(),
        )
        .unwrap();
        assert_eq!(record.assistant_text().as_deref(), Some(text));
        for raw in [
            json!({"type":"message_end","message":{"role":"toolResult","stopReason":"stop","content":[{"type":"text","text":text}]}}),
            json!({"type":"message_end","message":{"role":"assistant","stopReason":"error","content":[{"type":"text","text":text}]}}),
            json!({"type":"message_end","message":{"role":"assistant","stopReason":"length","content":[{"type":"text","text":text}]}}),
            json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":text}}),
            json!({"type":"agent_end","messages":[{"role":"assistant","stopReason":"stop","content":[{"type":"text","text":text}]}],"willRetry":false}),
        ] {
            assert_eq!(
                Record::parse(raw.to_string().as_bytes())
                    .unwrap()
                    .assistant_text(),
                None
            );
        }
    }

    #[test]
    fn session_cost_sums_messages_without_counting_stream_updates_or_agent_end_twice() {
        let mut usage = SessionUsage::default();
        let mut observe =
            |raw: Value| usage.observe(&Record::parse(raw.to_string().as_bytes()).unwrap());
        let message = |cost, text| json!({"role":"assistant","usage":{"cost":{"total":cost}},"content":[{"type":"text","text":text}]});
        assert_eq!(
            observe(json!({"type":"message_start","message":message(0.0,"first")})),
            0
        );
        assert_eq!(
            observe(json!({"type":"message_update","message":message(0.002,"first")})),
            2000
        );
        assert_eq!(
            observe(json!({"type":"message_update","message":message(0.003,"first")})),
            3000
        );
        assert_eq!(
            observe(json!({"type":"message_update","message":message(0.003,"first")})),
            3000
        );
        assert_eq!(
            observe(json!({"type":"message_end","message":message(0.003,"first")})),
            3000
        );
        assert_eq!(
            observe(
                json!({"type":"message_end","message":{"role":"toolResult","usage":{"cost":{"total":9}}}})
            ),
            3000
        );
        assert_eq!(
            observe(json!({"type":"message_start","message":message(0.0,"second")})),
            3000
        );
        assert_eq!(
            observe(json!({"type":"message_update","usage":{"cost":{"total":0.001}}})),
            4000
        );
        assert_eq!(
            observe(json!({"type":"message_end","message":message(0.002,"second")})),
            5000
        );
        assert_eq!(
            observe(
                json!({"type":"agent_end","messages":[message(0.003,"first"),message(0.002,"second")],"willRetry":false})
            ),
            5000
        );
    }

    #[test]
    fn session_cost_retains_partial_spend_across_provider_retry_and_ignores_invalid_usage() {
        let mut usage = SessionUsage::default();
        let mut observe =
            |raw: Value| usage.observe(&Record::parse(raw.to_string().as_bytes()).unwrap());
        assert_eq!(
            observe(json!({"type":"message_update","usage":{"cost":{"total":0.003}}})),
            3000
        );
        assert_eq!(
            observe(json!({"type":"message_start","message":{"role":"assistant"}})),
            3000
        );
        assert_eq!(
            observe(
                json!({"type":"message_end","message":{"role":"assistant","usage":{"cost":{"total":0.002}}}})
            ),
            5000
        );
        assert_eq!(
            observe(json!({"type":"message_update","usage":{"cost":{"total":-1}}})),
            5000
        );
        assert_eq!(
            observe(json!({"type":"message_update","usage":{"cost":{"total":null}}})),
            5000
        );
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
