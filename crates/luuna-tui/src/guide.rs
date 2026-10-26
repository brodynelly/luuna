//! Guide mode: the full-screen face of `lu init` (crate::prime). The in-process service runs the
//! guide and streams `guide` frames (steps, styled lines, previews, spinners and questions); this
//! module keeps the presentation state and turns keys into `reply` frames. It decides nothing: every
//! runtime action and refusal stays in the bridge and the runtime.
use crate::protocol::{safe_text, ClientCommand};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use serde_json::{json, Map, Value};
use std::time::Instant;

/// Most log rows kept; older rows scroll away first.
pub const MAX_LOG: usize = 4000;
/// Longest typed answer.
pub const MAX_ANSWER: usize = 16 * 1024;

/// Inline style of a run of text (the bridge's markers: U+E000 style U+E001 text U+E002).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ink {
    Plain,
    Bold,
    Dim,
    Cyan,
    Green,
    Red,
    Yellow,
    Magenta,
}

impl Ink {
    fn named(name: &str) -> Self {
        match name {
            "bold" => Self::Bold,
            "dim" => Self::Dim,
            "cyan" => Self::Cyan,
            "green" => Self::Green,
            "red" => Self::Red,
            "yellow" => Self::Yellow,
            "magenta" => Self::Magenta,
            _ => Self::Plain,
        }
    }
}

pub type Segment = (String, Ink);

/// Splits marked text into styled segments; stray or unbalanced markers are dropped.
pub fn parse(text: &str) -> Vec<Segment> {
    let mut out: Vec<Segment> = Vec::new();
    let mut plain = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{E000}' {
            let mut name = String::new();
            let mut body = String::new();
            let mut stage = 0;
            for next in chars.by_ref() {
                match (stage, next) {
                    (0, '\u{E001}') => stage = 1,
                    (0, ch) if name.len() < 16 => name.push(ch),
                    (1, '\u{E002}') => {
                        stage = 2;
                        break;
                    }
                    (1, ch) if ch != '\u{E000}' && ch != '\u{E001}' => body.push(ch),
                    _ => {}
                }
            }
            if !plain.is_empty() {
                out.push((std::mem::take(&mut plain), Ink::Plain));
            }
            if !body.is_empty() {
                out.push((safe_text(&body), Ink::named(&name)));
            }
            let _ = stage;
        } else if c == '\u{E001}' || c == '\u{E002}' {
            continue;
        } else {
            plain.push(c);
        }
    }
    if !plain.is_empty() {
        out.push((safe_text(&plain), Ink::Plain));
    }
    out
}

/// One log row: a styled line, or a row of a boxed preview.
#[derive(Clone, Debug, PartialEq)]
pub enum Row {
    Line(Vec<Segment>),
    PanelTop(String),
    PanelBody(String),
    PanelBottom,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Choice {
    pub label: String,
    pub hint: String,
}

/// What the guide is waiting for.
#[derive(Clone, Debug, PartialEq)]
pub enum Question {
    Ask {
        prompt_id: String,
        label: String,
        initial: String,
        optional: bool,
        value: String,
    },
    Choose {
        prompt_id: String,
        label: String,
        options: Vec<Choice>,
        cursor: usize,
    },
    Checklist {
        prompt_id: String,
        label: String,
        options: Vec<Choice>,
        checked: Vec<bool>,
        cursor: usize,
    },
    Edit {
        prompt_id: String,
        path: String,
    },
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Finish {
    pub title: Vec<Segment>,
    pub summary: String,
    pub next: Vec<(String, String)>,
    pub project: String,
}

/// The end of a guide run as the bridge reported it.
#[derive(Clone, Debug, PartialEq)]
pub enum Ending {
    Finished,
    Left,
    Unavailable,
    Failed(String),
}

pub struct GuideState {
    pub name: String,
    pub request_id: String,
    pub steps: Vec<String>,
    pub states: Vec<String>,
    pub index: usize,
    pub blurb: String,
    pub log: Vec<Row>,
    pub question: Option<Question>,
    pub spinner: Option<(String, Instant)>,
    pub finish: Option<Finish>,
    pub ending: Option<Ending>,
    /// Rows scrolled up from the newest row; 0 follows the log.
    pub scroll: usize,
    pub leaving: bool,
    pub started: Instant,
    /// The project the guide set up, from the bridge's result (empty when none was chosen).
    pub project: String,
    /// An editor the main loop must run with the terminal suspended: (prompt id, path).
    pub editor: Option<(String, String)>,
}

impl GuideState {
    pub fn new(name: &str, request_id: &str) -> Self {
        Self {
            name: name.into(),
            request_id: request_id.into(),
            steps: Vec::new(),
            states: Vec::new(),
            index: 0,
            blurb: String::new(),
            log: Vec::new(),
            question: None,
            spinner: None,
            finish: None,
            ending: None,
            scroll: 0,
            leaving: false,
            started: Instant::now(),
            editor: None,
            project: String::new(),
        }
    }

    /// True while something moves on screen (the spinner and the moon).
    pub fn animating(&self) -> bool {
        self.spinner.is_some() && self.ending.is_none()
    }

    /// Steps settled so far, for the progress gauge.
    pub fn progress(&self) -> (usize, usize) {
        let settled = self
            .states
            .iter()
            .filter(|state| matches!(state.as_str(), "done" | "skipped"))
            .count();
        (settled, self.steps.len().max(1))
    }

    fn push(&mut self, row: Row) {
        self.log.push(row);
        if self.log.len() > MAX_LOG {
            let excess = self.log.len() - MAX_LOG;
            self.log.drain(..excess);
        }
    }

    /// Applies one `guide` frame (a `batch` applies each of its frames in order).
    pub fn apply(&mut self, frame: &Map<String, Value>) {
        let text = |key: &str| {
            frame
                .get(key)
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string()
        };
        let strings = |key: &str| {
            frame
                .get(key)
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .map(|item| safe_text(item.as_str().unwrap_or("")))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        };
        let choices = || {
            frame
                .get("options")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .map(|item| Choice {
                            label: safe_text(
                                item.get("label").and_then(Value::as_str).unwrap_or(""),
                            ),
                            hint: safe_text(item.get("hint").and_then(Value::as_str).unwrap_or("")),
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        };
        match text("ui").as_str() {
            "batch" => {
                for item in frame
                    .get("frames")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
                {
                    if let Some(inner) = item.as_object() {
                        if inner.get("ui").and_then(Value::as_str) != Some("batch") {
                            self.apply(inner);
                        }
                    }
                }
            }
            "banner" => {}
            "step" => {
                self.steps = strings("steps");
                self.states = strings("states");
                self.index = frame.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                self.blurb = safe_text(&text("blurb"));
                if !self.log.is_empty() {
                    self.push(Row::Line(Vec::new()));
                }
                let title = self.steps.get(self.index).cloned().unwrap_or_default();
                self.push(Row::Line(vec![
                    (" ── ".into(), Ink::Magenta),
                    (
                        format!("{} of {} · ", self.index + 1, self.steps.len()),
                        Ink::Dim,
                    ),
                    (title, Ink::Bold),
                    (" ──".into(), Ink::Magenta),
                ]));
                self.scroll = 0;
            }
            "line" => self.push(Row::Line(parse(&text("text")))),
            "panel" => {
                self.push(Row::PanelTop(safe_text(&text("title"))));
                for line in text("text").lines() {
                    self.push(Row::PanelBody(safe_text(line)));
                }
                self.push(Row::PanelBottom);
            }
            "spin" => {
                let started = self
                    .spinner
                    .as_ref()
                    .map(|(_, at)| *at)
                    .unwrap_or_else(Instant::now);
                self.spinner = Some((safe_text(&text("text")), started));
            }
            "spin_stop" => self.spinner = None,
            "ask" => {
                self.question = Some(Question::Ask {
                    prompt_id: text("prompt_id"),
                    label: safe_text(&text("label")),
                    initial: safe_text(&text("initial")),
                    optional: frame
                        .get("optional")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    value: String::new(),
                });
                self.scroll = 0;
            }
            "choose" => {
                let options = choices();
                let initial = frame.get("initial").and_then(Value::as_u64).unwrap_or(0) as usize;
                self.question = Some(Question::Choose {
                    prompt_id: text("prompt_id"),
                    label: safe_text(&text("label")),
                    cursor: initial.min(options.len().saturating_sub(1)),
                    options,
                });
                self.scroll = 0;
            }
            "checklist" => {
                let options = choices();
                let checked = frame
                    .get("options")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .map(|item| {
                                item.get("checked")
                                    .and_then(Value::as_bool)
                                    .unwrap_or(false)
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                self.question = Some(Question::Checklist {
                    prompt_id: text("prompt_id"),
                    label: safe_text(&text("label")),
                    options,
                    checked,
                    cursor: 0,
                });
                self.scroll = 0;
            }
            "edit" => {
                let prompt_id = text("prompt_id");
                let path = text("path");
                self.question = Some(Question::Edit {
                    prompt_id: prompt_id.clone(),
                    path: path.clone(),
                });
                self.editor = Some((prompt_id, path));
            }
            "finish" => {
                self.steps = strings("steps");
                self.states = strings("states");
                self.finish = Some(Finish {
                    title: parse(&text("title")),
                    summary: safe_text(&text("summary")),
                    next: frame
                        .get("next")
                        .and_then(Value::as_array)
                        .map(|rows| {
                            rows.iter()
                                .filter_map(|row| {
                                    let pair = row.as_array()?;
                                    Some((
                                        safe_text(pair.first()?.as_str()?),
                                        safe_text(
                                            pair.get(1).and_then(Value::as_str).unwrap_or(""),
                                        ),
                                    ))
                                })
                                .collect()
                        })
                        .unwrap_or_default(),
                    project: safe_text(&text("project")),
                });
            }
            _ => {}
        }
    }

    /// The bridge's `result` for the guide request: its exit code says how it ended.
    pub fn ended(&mut self, value: &Value) {
        self.spinner = None;
        self.question = None;
        self.leaving = false;
        self.project = safe_text(value.get("project").and_then(Value::as_str).unwrap_or(""));
        self.ending = Some(match value.get("code").and_then(Value::as_i64) {
            Some(0) => Ending::Finished,
            Some(130) => Ending::Left,
            _ => Ending::Unavailable,
        });
    }

    pub fn failed(&mut self, message: &str) {
        self.spinner = None;
        self.question = None;
        self.leaving = false;
        self.ending = Some(Ending::Failed(safe_text(message)));
    }

    fn reply(&mut self, id: String, prompt_id: String, value: Value) -> ClientCommand {
        self.question = None;
        self.scroll = 0;
        ClientCommand::new(
            id,
            "reply",
            json!({"request_id": self.request_id, "prompt_id": prompt_id, "value": value}),
        )
    }

    /// Handles a key while a question is open. Returns a reply to send, if the key answered it.
    pub fn key(&mut self, key: KeyEvent, id: impl FnOnce() -> String) -> Option<ClientCommand> {
        match key.code {
            KeyCode::PageUp => {
                self.scroll = self.scroll.saturating_add(8);
                return None;
            }
            KeyCode::PageDown => {
                self.scroll = self.scroll.saturating_sub(8);
                return None;
            }
            _ => {}
        }
        let question = self.question.as_mut()?;
        match question {
            Question::Ask {
                prompt_id,
                initial,
                value,
                ..
            } => match key.code {
                KeyCode::Enter => {
                    let answer = if value.trim().is_empty() {
                        String::new()
                    } else {
                        value.clone()
                    };
                    let _ = initial;
                    let prompt_id = prompt_id.clone();
                    Some(self.reply(id(), prompt_id, json!(answer)))
                }
                KeyCode::Backspace => {
                    value.pop();
                    None
                }
                KeyCode::Tab if value.is_empty() => {
                    value.push_str(initial);
                    None
                }
                KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    value.clear();
                    None
                }
                KeyCode::Char(c) if crate::keys::is_text(&key) => {
                    if value.len() < MAX_ANSWER {
                        value.push(c);
                    }
                    None
                }
                _ => None,
            },
            Question::Choose {
                prompt_id,
                options,
                cursor,
                ..
            } => {
                let count = options.len().max(1);
                match key.code {
                    KeyCode::Up | KeyCode::Char('k') => *cursor = (*cursor + count - 1) % count,
                    KeyCode::Down | KeyCode::Char('j') | KeyCode::Tab => {
                        *cursor = (*cursor + 1) % count
                    }
                    KeyCode::Char(c @ '1'..='9') => {
                        let at = c as usize - '1' as usize;
                        if at < options.len() {
                            let prompt_id = prompt_id.clone();
                            return Some(self.reply(id(), prompt_id, json!(at)));
                        }
                    }
                    KeyCode::Enter => {
                        let (prompt_id, at) = (prompt_id.clone(), *cursor);
                        return Some(self.reply(id(), prompt_id, json!(at)));
                    }
                    _ => {}
                }
                None
            }
            Question::Checklist {
                prompt_id,
                options,
                checked,
                cursor,
                ..
            } => {
                let count = options.len().max(1);
                match key.code {
                    KeyCode::Up | KeyCode::Char('k') => *cursor = (*cursor + count - 1) % count,
                    KeyCode::Down | KeyCode::Char('j') | KeyCode::Tab => {
                        *cursor = (*cursor + 1) % count
                    }
                    KeyCode::Char(' ') | KeyCode::Char('x') => {
                        if let Some(mark) = checked.get_mut(*cursor) {
                            *mark = !*mark;
                        }
                    }
                    KeyCode::Char(c @ '1'..='9') => {
                        if let Some(mark) = checked.get_mut(c as usize - '1' as usize) {
                            *mark = !*mark;
                        }
                    }
                    KeyCode::Char('a') => {
                        let all = checked.iter().all(|mark| *mark);
                        checked.iter_mut().for_each(|mark| *mark = !all);
                    }
                    KeyCode::Enter => {
                        let (prompt_id, marks) = (prompt_id.clone(), checked.clone());
                        return Some(self.reply(id(), prompt_id, json!(marks)));
                    }
                    _ => {}
                }
                None
            }
            Question::Edit { .. } => None,
        }
    }

    /// The reply after the main loop ran the editor (`saved` when it exited successfully).
    pub fn edited(&mut self, id: String, prompt_id: String, saved: bool) -> ClientCommand {
        self.editor = None;
        self.reply(id, prompt_id, json!(if saved { "saved" } else { "failed" }))
    }

    pub fn paste(&mut self, text: &str) {
        if let Some(Question::Ask { value, .. }) = &mut self.question {
            let clean: String = safe_text(text)
                .chars()
                .filter(|c| *c != '\n' && *c != '\r')
                .collect();
            if value.len() + clean.len() <= MAX_ANSWER {
                value.push_str(&clean);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap()
    }

    #[test]
    fn markers_become_segments_and_stray_markers_vanish() {
        let text =
            "  \u{E000}green\u{E001}✔\u{E002} Registered \u{E000}bold\u{E001}demo\u{E002}\u{E002}!";
        assert_eq!(
            parse(text),
            vec![
                ("  ".into(), Ink::Plain),
                ("✔".into(), Ink::Green),
                (" Registered ".into(), Ink::Plain),
                ("demo".into(), Ink::Bold),
                ("!".into(), Ink::Plain),
            ]
        );
        assert_eq!(
            parse("\u{E000}red\u{E001}open"),
            vec![("open".into(), Ink::Red)]
        );
    }

    #[test]
    fn frames_build_steps_lines_panels_and_questions() {
        let mut guide = GuideState::new("prime", "ui-2");
        guide.apply(&frame(json!({"ui":"batch","frames":[
            {"ui":"step","index":1,"steps":["Runtime","Project"],"states":["done","current"],"blurb":"Register it."},
            {"ui":"line","text":"hello"},
            {"ui":"panel","title":"Preview","text":"a\nb"},
            {"ui":"spin","text":"Working"}
        ]})));
        assert_eq!(guide.index, 1);
        assert_eq!(guide.progress(), (1, 2));
        assert!(guide.log.contains(&Row::PanelTop("Preview".into())));
        assert!(guide.log.contains(&Row::PanelBody("b".into())));
        assert!(guide.animating());
        guide.apply(&frame(json!({"ui":"spin_stop"})));
        assert!(!guide.animating());
        guide.apply(&frame(json!({"ui":"choose","prompt_id":"p1","label":"Go?","initial":1,"options":[{"label":"Yes"},{"label":"No","hint":"later"}]})));
        let mut next = 0;
        let mut id = || {
            next += 1;
            format!("ui-{}", 10 + next)
        };
        assert!(guide
            .key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE), &mut id)
            .is_none());
        let reply = guide
            .key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE), &mut id)
            .unwrap();
        assert_eq!(reply.op, "reply");
        assert_eq!(reply.fields["value"], json!(0));
        assert_eq!(reply.fields["request_id"], json!("ui-2"));
        assert!(guide.question.is_none());
    }

    #[test]
    fn asks_and_checklists_reply_with_typed_values() {
        let mut guide = GuideState::new("prime", "g");
        guide.apply(&frame(
            json!({"ui":"ask","prompt_id":"a","label":"Name","initial":"demo"}),
        ));
        for c in "web".chars() {
            guide.key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE), || {
                "x".into()
            });
        }
        let reply = guide
            .key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE), || {
                "r1".into()
            })
            .unwrap();
        assert_eq!(reply.fields["value"], json!("web"));
        guide.apply(&frame(json!({"ui":"checklist","prompt_id":"c","label":"Do","options":[{"label":"a","checked":true},{"label":"b"}]})));
        guide.key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE), || {
            "x".into()
        });
        guide.key(
            KeyEvent::new(KeyCode::Char(' '), KeyModifiers::NONE),
            || "x".into(),
        );
        let reply = guide
            .key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE), || {
                "r2".into()
            })
            .unwrap();
        assert_eq!(reply.fields["value"], json!([true, true]));
    }

    #[test]
    fn an_edit_request_waits_for_the_main_loop() {
        let mut guide = GuideState::new("prime", "g");
        guide.apply(&frame(
            json!({"ui":"edit","prompt_id":"e","path":"C:\\tmp\\m.json"}),
        ));
        assert_eq!(guide.editor, Some(("e".into(), "C:\\tmp\\m.json".into())));
        assert!(guide
            .key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE), || "x"
                .into())
            .is_none());
        let reply = guide.edited("r".into(), "e".into(), true);
        assert_eq!(reply.fields["value"], json!("saved"));
        assert!(guide.editor.is_none());
    }
}
