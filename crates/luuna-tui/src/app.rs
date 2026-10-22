use crate::protocol::{
    bounded_append, safe_text, BridgeEvent, ClientCommand, CommandDef, MAX_EVENTS,
};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, VecDeque};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Catalog,
    Form,
    Result,
}

#[derive(Clone, Debug)]
pub struct FormField {
    pub name: String,
    pub label: String,
    pub hint: String,
    pub value: String,
    pub argument: bool,
    pub boolean: bool,
    pub repeated: bool,
}

#[derive(Clone, Debug)]
pub struct ActionForm {
    pub command: CommandDef,
    pub fields: Vec<FormField>,
    pub cursor: usize,
}
impl ActionForm {
    pub fn new(command: CommandDef, context: &BTreeMap<String, String>) -> Self {
        let mut fields = command
            .args
            .iter()
            .map(|arg| FormField {
                name: arg.name.clone(),
                label: if arg.prompt.is_empty() {
                    arg.name.clone()
                } else {
                    arg.prompt.clone()
                },
                hint: arg.description.clone(),
                value: context.get(&arg.name).cloned().unwrap_or_default(),
                argument: true,
                boolean: false,
                repeated: false,
            })
            .collect::<Vec<_>>();
        fields.extend(
            command
                .flags
                .iter()
                .filter(|(name, _)| name.as_str() != "acknowledge-hash")
                .map(|(name, flag)| FormField {
                    name: name.clone(),
                    label: format!("--{name}"),
                    hint: if flag.prompt.is_empty() {
                        flag.description.clone()
                    } else {
                        flag.prompt.clone()
                    },
                    value: String::new(),
                    argument: false,
                    boolean: flag.boolean,
                    repeated: flag.repeat || flag.multiline,
                }),
        );
        Self {
            command,
            fields,
            cursor: 0,
        }
    }
    pub fn input(&self) -> Result<(Vec<String>, Map<String, Value>), String> {
        let mut args = Vec::new();
        let mut flags = Map::new();
        for field in &self.fields {
            if field.argument {
                if field.value.trim().is_empty() {
                    return Err(format!("{} is required.", field.label));
                }
                args.push(field.value.clone());
            } else if !field.value.is_empty() {
                let value = if field.boolean {
                    match field.value.to_lowercase().trim() {
                        "yes" | "true" | "1" | "y" => Value::Bool(true),
                        "no" | "false" | "0" | "n" => Value::Bool(false),
                        _ => return Err(format!("{} needs yes or no.", field.label)),
                    }
                } else if field.repeated {
                    json!(field
                        .value
                        .lines()
                        .filter(|line| !line.trim().is_empty())
                        .collect::<Vec<_>>())
                } else {
                    json!(field.value)
                };
                flags.insert(field.name.clone(), value);
            }
        }
        Ok((args, flags))
    }
}

#[derive(Clone, Debug)]
pub struct PendingPrompt {
    pub request_id: String,
    pub prompt_id: String,
    pub kind: String,
    pub question: String,
    pub value: String,
}

pub struct AppState {
    pub commands: Vec<CommandDef>,
    pub selected: usize,
    pub filter: String,
    pub mode: Mode,
    pub form: Option<ActionForm>,
    pub prompt: Option<PendingPrompt>,
    pub context: BTreeMap<String, String>,
    pub snapshots: BTreeMap<String, Value>,
    pub pending: BTreeMap<String, ClientCommand>,
    pub output: String,
    pub output_omitted: bool,
    pub events: VecDeque<Value>,
    pub scroll: u16,
    pub status: String,
    pub connection: String,
    pub active_request: Option<String>,
    pub queue: VecDeque<ClientCommand>,
    pub last_read: Option<ClientCommand>,
    pub quit: bool,
    pub bridge_failed: bool,
    pub approval_visible: bool,
    next_id: u64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            commands: Vec::new(),
            selected: 0,
            filter: String::new(),
            mode: Mode::Catalog,
            form: None,
            prompt: None,
            context: BTreeMap::new(),
            snapshots: BTreeMap::new(),
            pending: BTreeMap::new(),
            output: String::new(),
            output_omitted: false,
            events: VecDeque::new(),
            scroll: 0,
            status: "Connecting to the local runtime…".into(),
            connection: "connecting".into(),
            active_request: None,
            queue: VecDeque::new(),
            last_read: None,
            quit: false,
            bridge_failed: false,
            approval_visible: false,
            next_id: 0,
        }
    }
}

impl AppState {
    pub fn id(&mut self) -> String {
        self.next_id += 1;
        format!("ui-{}", self.next_id)
    }
    pub fn start(&mut self) {
        let id = self.id();
        self.queue
            .push_back(ClientCommand::new(id, "catalog", json!({})));
    }
    pub fn filtered(&self) -> Vec<&CommandDef> {
        self.commands
            .iter()
            .filter(|c| self.filter.is_empty() || c.context == self.filter)
            .collect()
    }
    pub fn append(&mut self, text: &str) {
        self.output_omitted |= bounded_append(&mut self.output, text);
    }
    pub fn begin(&mut self, name: &str) {
        if self.bridge_failed {
            self.status =
                "Transport stopped. Restart the terminal to reconnect; no action was sent.".into();
            return;
        }
        if self.active_request.is_some() {
            self.status = "Finish or Esc-abort the current local action first.".into();
            return;
        }
        if let Some(command) = self.commands.iter().find(|c| c.name == name).cloned() {
            self.form = Some(ActionForm::new(command, &self.context));
            self.mode = Mode::Form;
            self.status.clear();
            if self.form.as_ref().is_some_and(|f| f.fields.is_empty()) {
                self.submit();
            }
        }
    }
    pub fn invoke(
        &mut self,
        name: &str,
        args: Vec<String>,
        flags: Map<String, Value>,
        read_only: bool,
    ) {
        if self.bridge_failed {
            self.status =
                "Transport stopped. Restart the terminal to reconnect; no action was sent.".into();
            return;
        }
        if self.active_request.is_some() {
            self.status = "Another action is still active.".into();
            return;
        }
        let id = self.id();
        let request = ClientCommand::new(
            &id,
            if read_only { "read" } else { "invoke" },
            json!({"name":name,"args":args,"flags":flags}),
        );
        if let Err(error) = request.encode() {
            self.status = error;
            return;
        }
        self.active_request = Some(id.clone());
        self.pending.insert(id, request.clone());
        if read_only {
            self.last_read = Some(request.clone());
        }
        self.output.clear();
        self.output_omitted = false;
        self.scroll = 0;
        self.events.clear();
        self.mode = Mode::Result;
        self.status = format!("{name} · waiting for the runtime · Esc stops waiting");
        self.queue.push_back(request);
    }
    pub fn submit(&mut self) {
        let Some(form) = &self.form else {
            return;
        };
        match form.input() {
            Ok((args, flags)) => {
                let name = form.command.name.clone();
                let read = form.command.read_only && !flags.contains_key("output");
                for (arg, value) in form.command.args.iter().zip(&args) {
                    if arg.context {
                        self.context.insert(arg.name.clone(), value.clone());
                    }
                }
                self.invoke(&name, args, flags, read);
            }
            Err(error) => self.status = error,
        }
    }
    pub fn refresh(&mut self) {
        if self.active_request.is_some() {
            return;
        }
        if let Some(request) = self.last_read.clone() {
            let name = request
                .fields
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("");
            let args =
                serde_json::from_value(request.fields.get("args").cloned().unwrap_or(json!([])))
                    .unwrap_or_default();
            let flags = request
                .fields
                .get("flags")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            self.invoke(name, args, flags, true);
        }
    }
    pub fn abort(&mut self) {
        if let Some(request_id) = self.active_request.clone() {
            let id = self.id();
            self.queue.push_back(ClientCommand::new(
                id,
                "abort",
                json!({"request_id":request_id}),
            ));
            self.prompt = None;
            self.status = "Stopping local request; runtime work is not cancelled.".into();
        } else {
            self.mode = Mode::Catalog;
            self.form = None;
        }
    }
    pub fn transport_failed(&mut self, message: &str) {
        self.bridge_failed = true;
        self.connection = "offline".into();
        self.status = safe_text(message);
        self.prompt = None;
        self.active_request = None;
        self.pending.clear();
        self.queue.clear();
    }
    pub fn apply(&mut self, event: BridgeEvent) {
        match event.event.as_str() {
            "catalog" => {
                match serde_json::from_value::<Vec<CommandDef>>(
                    event.fields.get("commands").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(commands) => {
                        self.commands = commands;
                        self.status = "Choose an action · F1 help · F2 catalog".into();
                    }
                    Err(_) => self.transport_failed("Bridge catalog is invalid."),
                }
            }
            "connection" => {
                let previous = self.connection.clone();
                self.connection = event.text("state").to_string();
                self.status = safe_text(event.text("message"));
                if self.connection == "connected"
                    && ["offline", "reconnecting", "disconnected"].contains(&previous.as_str())
                {
                    self.refresh();
                }
            }
            "prompt" if self.pending.contains_key(&event.id) => {
                self.mode = Mode::Result;
                if self.output_omitted && event.text("kind") == "hash" {
                    self.abort();
                    self.status =
                        "Approval stopped: the complete plan exceeds the display limit.".into();
                    return;
                }
                self.prompt = Some(PendingPrompt {
                    request_id: event.id.clone(),
                    prompt_id: event.text("prompt_id").into(),
                    kind: event.text("kind").into(),
                    question: safe_text(event.text("question")),
                    value: String::new(),
                });
            }
            "output" if self.pending.contains_key(&event.id) => self.append(event.text("text")),
            "event" if self.pending.contains_key(&event.id) => {
                if let Some(record) = event.fields.get("record") {
                    self.events.push_back(record.clone());
                    if self.events.len() > MAX_EVENTS {
                        self.events.pop_front();
                        self.output_omitted = true;
                    }
                    self.append(&format!("{}\n", record));
                }
            }
            "result" | "error" => {
                let Some(request) = self.pending.remove(&event.id) else {
                    return;
                };
                if self.active_request.as_deref() == Some(&event.id) {
                    self.active_request = None;
                    self.prompt = None;
                }
                if event.event == "error" {
                    let message = format!("{}{}",safe_text(event.text("message")),match event.text("outcome") {
                        "unknown"=>" Outcome unknown: inspect authoritative state before retrying; the runtime may have completed this action.",
                        "completed"=>" Execution completed, but the response is unavailable. Inspect authoritative state; do not repeat the mutation.",
                        _=>"",
                    });
                    self.status = message.clone();
                    self.append(&format!("\n{message}\n"));
                } else {
                    let key = request
                        .fields
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("result")
                        .to_string();
                    if self.snapshots.len() >= 16 && !self.snapshots.contains_key(&key) {
                        self.snapshots.pop_first();
                    }
                    self.snapshots.insert(
                        key,
                        event.fields.get("value").cloned().unwrap_or(Value::Null),
                    );
                    self.append(event.text("formatted"));
                    self.status =
                        "Runtime response received · F5 refresh reads · Esc catalog".into();
                }
            }
            _ => {}
        }
    }
    pub fn key(&mut self, key: KeyEvent) {
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.quit = true;
            return;
        }
        if key.code == KeyCode::Esc {
            self.abort();
            return;
        }
        if matches!(key.code, KeyCode::PageUp | KeyCode::PageDown)
            && (self.mode == Mode::Result || self.prompt.is_some())
        {
            self.scroll = if key.code == KeyCode::PageUp {
                self.scroll.saturating_sub(8)
            } else {
                self.scroll.saturating_add(8)
            };
            return;
        }
        if let Some(prompt) = &mut self.prompt {
            if prompt.kind == "hash" {
                match key.code {
                    KeyCode::Up => {
                        self.scroll = self.scroll.saturating_sub(1);
                        return;
                    }
                    KeyCode::Down => {
                        self.scroll = self.scroll.saturating_add(1);
                        return;
                    }
                    KeyCode::Home => {
                        self.scroll = 0;
                        return;
                    }
                    KeyCode::End => {
                        self.scroll = u16::MAX;
                        return;
                    }
                    _ => {}
                }
            }
            let submit_document = prompt.kind == "document"
                && key.modifiers.contains(KeyModifiers::CONTROL)
                && matches!(key.code, KeyCode::Char('s') | KeyCode::Enter);
            if submit_document || key.code == KeyCode::Enter && prompt.kind != "document" {
                if prompt.kind == "hash" && !self.approval_visible {
                    self.status = "Enlarge the terminal to review the plan before approval.".into();
                    return;
                }
                let value = if prompt.kind == "confirm" {
                    match prompt.value.to_lowercase().trim() {
                        "yes" | "y" => Value::Bool(true),
                        "no" | "n" | "" => Value::Bool(false),
                        _ => {
                            self.status = "Type yes to confirm, or no to decline.".into();
                            return;
                        }
                    }
                } else {
                    Value::String(prompt.value.clone())
                };
                let prompt = self.prompt.take().expect("present");
                let id = self.id();
                self.queue.push_back(ClientCommand::new(id, "reply", json!({"request_id":prompt.request_id,"prompt_id":prompt.prompt_id,"value":value})));
            } else {
                edit(&mut prompt.value, key, prompt.kind == "document");
            }
            return;
        }
        if self.mode == Mode::Form {
            if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('s') {
                self.submit();
                return;
            }
            if let Some(form) = &mut self.form {
                let count = form.fields.len();
                if count == 0 {
                    return;
                }
                match key.code {
                    KeyCode::Tab | KeyCode::Down => form.cursor = (form.cursor + 1) % count,
                    KeyCode::BackTab | KeyCode::Up => {
                        form.cursor = (form.cursor + count - 1) % count
                    }
                    KeyCode::Enter if !key.modifiers.contains(KeyModifiers::ALT) => {
                        if form.cursor + 1 == count {
                            self.submit();
                        } else {
                            form.cursor += 1;
                        }
                    }
                    _ => {
                        if let Some(field) = form.fields.get_mut(form.cursor) {
                            edit(&mut field.value, key, true);
                        }
                    }
                }
            }
            return;
        }
        match key.code {
            KeyCode::Char('q') => self.quit = true,
            KeyCode::F(1) if self.active_request.is_none() => {
                self.mode = Mode::Result;
                self.output = HELP.into();
                self.scroll = 0;
            }
            KeyCode::F(2) if self.active_request.is_none() => {
                self.mode = Mode::Catalog;
                self.filter.clear();
            }
            KeyCode::F(5) | KeyCode::Char('r') => self.refresh(),
            KeyCode::Up | KeyCode::Char('k') => {
                if self.mode == Mode::Result {
                    self.scroll = self.scroll.saturating_sub(1);
                } else {
                    self.selected = self.selected.saturating_sub(1);
                }
            }
            KeyCode::Down | KeyCode::Char('j') => {
                if self.mode == Mode::Result {
                    self.scroll = self.scroll.saturating_add(1);
                } else {
                    self.selected =
                        (self.selected + 1).min(self.filtered().len().saturating_sub(1));
                }
            }
            KeyCode::Home => {
                self.scroll = 0;
                self.selected = 0;
            }
            KeyCode::End => {
                if self.mode == Mode::Catalog {
                    self.selected = self.filtered().len().saturating_sub(1);
                } else {
                    self.scroll = u16::MAX;
                }
            }
            KeyCode::PageDown => {
                self.selected = (self.selected + 8).min(self.filtered().len().saturating_sub(1))
            }
            KeyCode::PageUp => self.selected = self.selected.saturating_sub(8),
            KeyCode::Tab if self.mode == Mode::Catalog => {
                const CONTEXTS: [&str; 6] = ["", "runtime", "project", "ticket", "plan", "run"];
                let next = (CONTEXTS.iter().position(|v| *v == self.filter).unwrap_or(0) + 1)
                    % CONTEXTS.len();
                self.filter = CONTEXTS[next].into();
                self.selected = 0;
            }
            KeyCode::Enter if self.mode == Mode::Catalog => {
                if let Some(name) = self.filtered().get(self.selected).map(|c| c.name.clone()) {
                    self.begin(&name);
                }
            }
            _ => {}
        }
    }
    pub fn paste(&mut self, text: &str) {
        let clean = safe_text(text);
        let target = if let Some(prompt) = &mut self.prompt {
            Some(&mut prompt.value)
        } else if let Some(form) = &mut self.form {
            if self.mode == Mode::Form {
                form.fields.get_mut(form.cursor).map(|f| &mut f.value)
            } else {
                None
            }
        } else {
            None
        };
        if let Some(target) = target {
            if target.len() + clean.len() <= 256 * 1024 {
                target.push_str(&clean);
            } else {
                self.status = "Input exceeds the 256 KiB form limit.".into();
            }
        }
    }
}

fn edit(text: &mut String, key: KeyEvent, multiline: bool) {
    if text.len() >= 256 * 1024 && key.code != KeyCode::Backspace {
        return;
    }
    match key.code {
        KeyCode::Backspace => {
            text.pop();
        }
        KeyCode::Enter if multiline => text.push('\n'),
        KeyCode::Char(c) if !key.modifiers.contains(KeyModifiers::CONTROL) && !c.is_control() => {
            text.push(c)
        }
        KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => text.clear(),
        _ => {}
    }
}

pub const HELP: &str = "LUUNA / TERMINAL WORKBENCH\n\nThe runtime owns projects, tickets, plans, execution and evidence.\nUse F2 to browse every catalog action. Tab filters its context.\nForms expose every argument and option. Empty options are omitted.\nTab/Up/Down change fields; Alt+Enter adds a line. Repeated flags use one value per line.\nEnter advances; Ctrl+S submits. Boolean options take yes or no.\nDocument prompts: Enter adds a line, Ctrl+S submits.\n\nApproval displays the complete plan and requires its exact full hash.\nEsc stops a LOCAL request or follower. It does not cancel runtime work.\nChoose the cancel action to request runtime cancellation.\nF5 refreshes the latest read. Reconnect never retries a mutation.\n\nSTATES\npassed/accepted: verified success\nrunning/implementing/validating: active\nfailed/rejected: failure\nblocked/pending: attention\ninterrupted/reconnecting: interrupted\ncompleted/cancelled: neutral\n\nHome and Board are read-only projections. Catalog actions expose durable evidence, artifacts, memory and publication status. Merging stays the developer's decision.\n\nPgUp/PgDn scroll; q or Ctrl+C exits and leaves the runtime running.";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{ArgumentDef, FlagDef};
    #[test]
    fn forms_keep_required_context_repeats_false_and_exact_text() {
        let command = CommandDef {
            name: "plan".into(),
            args: vec![ArgumentDef {
                name: "ticket".into(),
                context: true,
                ..Default::default()
            }],
            flags: BTreeMap::from([
                (
                    "task".into(),
                    FlagDef {
                        repeat: true,
                        ..Default::default()
                    },
                ),
                (
                    "confirm".into(),
                    FlagDef {
                        boolean: true,
                        ..Default::default()
                    },
                ),
            ]),
            ..Default::default()
        };
        let mut form = ActionForm::new(
            command,
            &BTreeMap::from([("ticket".into(), "ticket-1".into())]),
        );
        for field in &mut form.fields {
            if field.name == "task" {
                field.value = "api=src\nweb=lib>api".into();
            }
            if field.name == "confirm" {
                field.value = "no".into();
            }
        }
        let (args, flags) = form.input().unwrap();
        assert_eq!(args, ["ticket-1"]);
        assert_eq!(flags["confirm"], false);
        assert_eq!(flags["task"], json!(["api=src", "web=lib>api"]));
    }
    #[test]
    fn prompt_answers_are_fresh_and_escape_never_cancels_runtime() {
        let mut app = AppState::default();
        app.invoke("approve", vec!["p".into()], Map::new(), false);
        let id = app.active_request.clone().unwrap();
        app.apply(serde_json::from_value(json!({"v":1,"id":id,"event":"prompt","prompt_id":"hash1","kind":"hash","question":"hash?"})).unwrap());
        assert_eq!(app.prompt.as_ref().unwrap().value, "");
        app.key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert_eq!(app.queue.back().unwrap().op, "abort");
        assert!(app
            .queue
            .iter()
            .all(|q| q.fields.get("name") != Some(&json!("cancel"))));
    }
    #[test]
    fn stale_prompt_cannot_replace_active_request() {
        let mut app = AppState::default();
        app.apply(serde_json::from_value(json!({"v":1,"id":"stale","event":"prompt","prompt_id":"p","kind":"hash","question":"hash?"})).unwrap());
        assert!(app.prompt.is_none());
    }
}
