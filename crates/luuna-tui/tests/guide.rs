//! The setup guide screen (`lu init`): synthetic frames in the shape crate::prime sends
//! (tests/guide_flow.rs proves the flow itself against a mock runtime).
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use luuna_tui::{
    app::{AppState, Mode},
    protocol::BridgeEvent,
    theme::Theme,
    ui,
    views::{self, Screen},
};
use ratatui::{backend::TestBackend, Terminal};
use serde_json::{json, Map, Value};

const G: &str = "\u{E000}green\u{E001}";
const C: &str = "\u{E000}cyan\u{E001}";
const D: &str = "\u{E000}dim\u{E001}";
const B: &str = "\u{E000}bold\u{E001}";
const E: &str = "\u{E002}";

fn started() -> (AppState, String) {
    let mut app = AppState::default();
    app.connection = "connected".into();
    views::guide::begin(&mut app, "init", Map::new());
    let id = app.active_request.clone().unwrap();
    let request = app.queue.pop_back().unwrap();
    assert_eq!(request.op, "guide");
    assert_eq!(request.fields["name"], json!("init"));
    (app, id)
}

fn frame(app: &mut AppState, id: &str, payload: Value) {
    let mut event = json!({"v":1,"id":id,"event":"guide"});
    event
        .as_object_mut()
        .unwrap()
        .extend(payload.as_object().unwrap().clone());
    app.apply(serde_json::from_value::<BridgeEvent>(event).unwrap());
}

fn steps(current: usize) -> Value {
    let names = [
        "Runtime",
        "Project",
        "Discovery",
        "Manifest",
        "Baseline",
        "Suite",
        "Agents",
        "Ticket",
    ];
    let states: Vec<&str> = (0..names.len())
        .map(|i| {
            if i < current {
                if i == 2 {
                    "skipped"
                } else {
                    "done"
                }
            } else if i == current {
                "current"
            } else {
                "pending"
            }
        })
        .collect();
    json!({"ui":"step","index":current,"steps":names,"states":states,"blurb":"Coding agents that open a repository directly read CLAUDE.md or AGENTS.md at session start. Onboarding adds a section per component; priming prints what they work from."})
}

fn draw(app: &mut AppState, w: u16, h: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(w, h)).unwrap();
    terminal
        .draw(|f| ui::render(f, app, Theme { color: false }))
        .unwrap();
    let buffer = terminal.backend().buffer().clone();
    (0..h)
        .map(|y| {
            (0..w)
                .map(|x| buffer[(x, y)].symbol().to_string())
                .collect::<String>()
                .trim_end()
                .to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn key(app: &mut AppState, code: KeyCode) {
    app.key(KeyEvent::new(code, KeyModifiers::NONE));
}

fn agents_step(app: &mut AppState, id: &str) {
    frame(
        app,
        id,
        json!({"ui":"batch","frames":[
            steps(6),
            {"ui":"line","text":format!("    {C}demo{E}  C:\\work\\demo")},
            {"ui":"line","text":format!("      {D}○{E} {B}Missions {E} tickets and plans {D}.luuna/missions not created{E}")},
            {"ui":"line","text":format!("  {G}✔{E} Atlas store created")},
            {"ui":"panel","title":"Sections for CLAUDE.md","text":"<!-- luuna-missions:start -->\n## Missions\nAt the start of every session, run luuna-missions prime.\n<!-- luuna-missions:end -->"}
        ]}),
    );
    frame(
        app,
        id,
        json!({"ui":"checklist","prompt_id":"prompt-9","label":"Set up the agents in demo","options":[
            {"label":"Create the repo-local stores","hint":".luuna/missions, .luuna/atlas","checked":true},
            {"label":"Add session-start instructions to CLAUDE.md","hint":"creates the file","checked":true},
            {"label":"Install Claude Code hooks","hint":".claude/settings.json","checked":false},
            {"label":"Show what each agent is primed with","hint":"read-only","checked":true}
        ]}),
    );
}

#[test]
fn the_guide_screen_shows_the_rail_the_log_a_preview_and_the_question() {
    let (mut app, id) = started();
    assert_eq!(app.mode, Mode::Guide);
    agents_step(&mut app, &id);
    let screen = draw(&mut app, 120, 36);
    for expected in [
        "LUUNA",
        "INIT",
        "7 of 8 · Agents",
        "✔  Runtime",
        "–  Discovery",
        "Agents",
        "○  Ticket",
        "6/8",
        "╭─ Sections for CLAUDE.md",
        "│ ## Missions",
        "? Set up the agents in demo",
        "[x] Create the repo-local stores",
        "[ ] Install Claude Code hooks",
        "Space toggle",
    ] {
        assert!(
            screen.contains(expected),
            "missing {expected:?} in\n{screen}"
        );
    }
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/snapshots/guide.txt");
    if std::env::var_os("UPDATE_TUI_SNAPSHOTS").is_some() {
        std::fs::write(&path, &screen).unwrap();
    }
    assert_eq!(
        screen,
        std::fs::read_to_string(path).unwrap().replace("\r\n", "\n"),
        "guide snapshot"
    );
    // Narrow and short terminals drop the rail and the banner but keep the question.
    for (w, h) in [(60, 20), (40, 12), (24, 8)] {
        let small = draw(&mut app, w, h);
        assert!(small.lines().count() == h as usize);
    }
}

#[test]
fn checklist_answers_reply_and_leaving_asks_first_then_aborts() {
    let (mut app, id) = started();
    agents_step(&mut app, &id);
    key(&mut app, KeyCode::Down);
    key(&mut app, KeyCode::Down);
    key(&mut app, KeyCode::Char(' '));
    key(&mut app, KeyCode::Enter);
    let reply = app.queue.pop_back().unwrap();
    assert_eq!(reply.op, "reply");
    assert_eq!(reply.fields["value"], json!([true, true, true, true]));
    assert_eq!(reply.fields["prompt_id"], json!("prompt-9"));
    frame(&mut app, &id, json!({"ui":"spin","text":"Priming"}));
    assert!(app.animating());
    key(&mut app, KeyCode::Esc);
    assert!(draw(&mut app, 100, 30).contains("Leave the setup? Nothing is undone."));
    assert!(app.queue.is_empty(), "Esc alone sends nothing");
    key(&mut app, KeyCode::Esc);
    assert!(app.queue.is_empty(), "Esc again stays");
    key(&mut app, KeyCode::Esc);
    key(&mut app, KeyCode::Enter);
    let abort = app.queue.pop_back().unwrap();
    assert_eq!(abort.op, "abort");
    assert_eq!(abort.fields["request_id"], json!(id));
}

#[test]
fn a_finished_guide_shows_the_next_steps_and_opens_its_project_in_the_workbench() {
    let (mut app, id) = started();
    frame(
        &mut app,
        &id,
        json!({"ui":"finish","title":format!("{B}demo{E} {D}(demo){E}  manifest r1"),"summary":"registered demo · manifest r1 · suite enabled","next":[["lu plan ticket-1","record a plan, then approve it by its exact hash"],["lu home","what needs your attention"]],"steps":["Runtime","Ticket"],"states":["done","done"],"project":"demo"}),
    );
    app.apply(serde_json::from_value::<BridgeEvent>(json!({"v":1,"id":id,"event":"result","value":{"guide":"init","code":0,"project":"demo"},"formatted":"","code":0})).unwrap());
    assert!(app.active_request.is_none());
    let screen = draw(&mut app, 110, 32);
    for expected in [
        "Setup complete",
        "Ready",
        "lu plan ticket-1",
        "Enter opens demo in the workbench",
        "2/2",
    ] {
        assert!(
            screen.contains(expected),
            "missing {expected:?} in\n{screen}"
        );
    }
    key(&mut app, KeyCode::Enter);
    assert_eq!(app.mode, Mode::Workbench);
    assert_eq!(app.workbench.screen, Screen::Project);
    assert_eq!(app.context.get("project").map(String::as_str), Some("demo"));
    assert!(app.guide.is_none());
}

#[test]
fn the_workbench_starts_the_guide_from_home_and_the_menu() {
    let mut app = AppState::default();
    app.mode = Mode::Workbench;
    key(&mut app, KeyCode::Char('s'));
    assert_eq!(app.mode, Mode::Guide);
    assert_eq!(app.queue.back().unwrap().op, "guide");
    let mut app = AppState::default();
    app.mode = Mode::Workbench;
    views::open(&mut app, Screen::Setup);
    assert_eq!(app.mode, Mode::Guide);
}
