//! Synthetic response fixtures follow the public API types. Native/runtime proof is separate.
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use luuna_tui::{
    app::{AppState, Mode},
    protocol::{BridgeEvent, CommandDef},
    scroll::{ScrollMotion, DEFAULT_SCROLL_DURATION},
    theme::{state_tone, Theme},
    ui,
    views::{self, Screen},
};
use ratatui::{backend::TestBackend, style::Color, Terminal};
use serde_json::{json, Value};
use std::time::Duration;

fn key(app: &mut AppState, code: KeyCode) {
    app.key(KeyEvent::new(code, KeyModifiers::NONE));
}
fn hash() -> String {
    format!("sha256:{}", "a".repeat(64))
}
fn app() -> AppState {
    let mut app = AppState::default();
    app.commands =
        serde_json::from_str::<Vec<CommandDef>>(include_str!("fixtures/catalog.json")).unwrap();
    app.mode = Mode::Workbench;
    app.connection = "connected".into();
    app.context.insert("project".into(), "demo".into());
    app.context.insert("ticket".into(), "ticket-1".into());
    app.context.insert("run".into(), "run-1".into());
    app.context.insert("plan".into(), "plan-1".into());
    app.snapshots.insert(
        "projects".into(),
        json!([{"id":"demo","name":"Demo workspace","revision":2}]),
    );
    app.snapshots.insert("home".into(),json!({"projects":[{"id":"demo","name":"Demo workspace","revision":2,"tickets":1,"active_workflows":1,"repositories":[{"repository_id":"api","local_path":"/fixture/api","baseline":{"run_id":"baseline-1","status":"passed","manifest_revision":2,"commit":"aabbcc"}}]}],"blockers":[{"project_id":"demo","title":"Greeting","state":"plan_ready","detail":"Review the immutable plan"}]}));
    app.snapshots.insert("project".into(),json!({"project":{"id":"demo","name":"Demo workspace","revision":2},"repositories":[{"repository_id":"api","local_path":"/fixture/api"},{"repository_id":"web","local_path":"/fixture/web"}],"manifest":{"hash":hash(),"revision":2},"prerequisites":[]}));
    let columns=["Backlog","Testing prerequisite","Discovery / plan","Approval","Implementation","Checks","Review","PRs"].iter().enumerate().map(|(i,title)|json!({"column":{"id":i.to_string(),"title":title,"description":"Recorded runtime state"},"cards":if i==0{json!([{"title":"Greeting ticket","ticket_id":"ticket-1","ticket_revision":3,"project_id":"demo","kind":"ticket","run_id":"run-1","state":"plan_ready"}])}else{json!([])}})).collect::<Vec<_>>();
    app.snapshots.insert(
        "board".into(),
        json!({"columns":columns,"note":"Read-only runtime projection"}),
    );
    app.snapshots.insert("show-ticket".into(),json!({"id":"ticket-1","project_id":"demo","title":"Greeting ticket","intent":"Print a useful greeting","revision":3,"acceptance_criteria":["Print hello","Keep exit code zero"],"repository_ids":["api","web"],"source":{"kind":"missions"}}));
    app.snapshots.insert("memory".into(),json!([{"id":"mem-1","scope":"project","content":"Use structured errors","provenance":"Maintainer notes","hash":hash()}]));
    app.snapshots
        .insert("prompts".into(), json!([{"name":"review","version":2}]));
    app.snapshots.insert("render-prompt".into(),json!({"name":"review","version":2,"hash":hash(),"body":"Review the exact candidate.\nExplain every finding."}));
    let run = json!({"id":"run-1","project_id":"demo","state":"plan_ready","metadata":{"kind":"workflow","plan_id":"plan-1","ticket_id":"ticket-1","plan_revision":1},"created_at":"2026-10-22T00:00:00Z"});
    app.snapshots.insert("runs".into(), json!([run.clone()]));
    app.snapshots.insert("run".into(), run);
    app.snapshots.insert("candidate".into(),json!({"active":false,"evidence":{"candidate":{"hash":hash(),"revision":1,"repository_commits":{"api":"abc"}},"status":"reviewed","results":[{"recipe_id":"tests","status":"passed","exit_code":0}],"review":{"verdict":"passed","findings":[]}},"validate_allowed":false,"decision_reasons":{"validate":"already reviewed"}}));
    app.snapshots.insert("show-plan".into(),json!({"id":"plan-1","ticket_id":"ticket-1","revision":1,"hash":hash(),"tasks":[{"id":"api","repository_id":"api","role":"implementer","paths":["src"],"operations":["read","write"],"depends_on":[]}],"budgets":{"max_attempts":2,"timeout_seconds":90},"component_context":{"memory":[],"prompt":null}}));
    app.workbench.selected = app.snapshots["render-prompt"].clone();
    app
}
fn draw(app: &mut AppState, w: u16, h: u16, color: bool) -> String {
    let mut terminal = Terminal::new(TestBackend::new(w, h)).unwrap();
    terminal
        .draw(|f| ui::render(f, app, Theme { color }))
        .unwrap();
    terminal
        .backend()
        .buffer()
        .content
        .chunks(usize::from(w))
        .map(|line| {
            line.iter()
                .map(|c| c.symbol())
                .collect::<String>()
                .trim_end()
                .to_owned()
        })
        .collect::<Vec<_>>()
        .join("\n")
}
fn event(app: &mut AppState, value: Value) {
    let id = app.active_request.clone().unwrap();
    let e: BridgeEvent = serde_json::from_value(
        json!({"v":1,"id":id,"event":"result","value":value,"formatted":"Runtime fixture"}),
    )
    .unwrap();
    app.apply(e);
}

#[test]
fn every_view_has_content_at_every_supported_size_in_color_and_plain() {
    for screen in [
        Screen::Home,
        Screen::Projects,
        Screen::Project,
        Screen::Missions,
        Screen::Ticket,
        Screen::Memory,
        Screen::MemoryDetail,
        Screen::Prompts,
        Screen::PromptDetail,
        Screen::Runs,
        Screen::RunDetail,
        Screen::Plan,
        Screen::Help,
    ] {
        for (w, h) in [(40, 12), (60, 24), (80, 12), (80, 24), (120, 35)] {
            for color in [true, false] {
                let mut a = app();
                a.workbench.screen = screen;
                a.workbench.selected = if screen == Screen::PromptDetail {
                    a.snapshots["render-prompt"].clone()
                } else {
                    a.snapshots["memory"][0].clone()
                };
                let painted = draw(&mut a, w, h, color);
                assert_eq!(painted.lines().count(), usize::from(h));
                assert!(painted.contains("LUUNA"), "{screen:?} {w}x{h}");
                assert!(!painted.contains("\u{1b}"));
                assert!(
                    !painted.lines().last().unwrap_or("").trim().is_empty(),
                    "missing keyboard footer for {screen:?} {w}x{h}"
                );
            }
        }
    }
}
#[test]
fn snapshots_pin_actual_terminal_cells_for_component_layouts() {
    for (name, screen) in [
        ("home", Screen::Home),
        ("missions", Screen::Missions),
        ("atlas", Screen::Memory),
        ("beacon", Screen::PromptDetail),
    ] {
        let mut a = app();
        a.workbench.screen = screen;
        let actual = draw(&mut a, 120, 35, false);
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/snapshots")
            .join(format!("{name}.txt"));
        if std::env::var_os("UPDATE_TUI_SNAPSHOTS").is_some() {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &actual).unwrap();
        }
        assert_eq!(
            actual,
            // Git may check text fixtures out with native Windows newlines.
            std::fs::read_to_string(path).unwrap().replace("\r\n", "\n"),
            "{name} snapshot"
        );
    }
}
#[test]
fn board_is_read_only_and_all_eight_columns_remain_reachable() {
    let mut a = app();
    a.workbench.screen = Screen::Missions;
    for n in 0..8 {
        assert_eq!(a.workbench.column, n);
        key(&mut a, KeyCode::Right);
    }
    assert_eq!(a.workbench.column, 0);
    assert!(a.queue.is_empty());
    key(&mut a, KeyCode::Enter);
    assert_eq!(a.workbench.screen, Screen::Ticket);
    assert_eq!(a.queue.back().unwrap().fields["name"], "show-ticket");
}
#[test]
fn ticket_form_preserves_displayed_revision_and_all_repositories() {
    let mut a = app();
    a.workbench.screen = Screen::Ticket;
    key(&mut a, KeyCode::Char('e'));
    let f = a.form.as_ref().unwrap();
    let (_, flags) = f.input().unwrap();
    assert_eq!(flags["revision"], "3");
    assert_eq!(flags["repository"], json!(["api", "web"]));
    assert_eq!(
        flags["criterion"],
        json!(["Print hello", "Keep exit code zero"])
    );
}
#[test]
fn memory_selection_is_explicit_and_project_switch_clears_private_context() {
    let mut a = app();
    a.workbench.screen = Screen::Memory;
    key(&mut a, KeyCode::Enter);
    key(&mut a, KeyCode::Char('s'));
    assert!(a.workbench.memory_ids.contains("mem-1"));
    assert!(a.queue.is_empty());
    a.workbench.include_user = true;
    a.workbench.prompt_selection = Some(format!("review@2#{}", hash()));
    views::choose_project(&mut a, "other");
    assert!(!a.workbench.include_user);
    assert!(a.workbench.memory_ids.is_empty());
    assert!(a.workbench.prompt_selection.is_none());
    assert!(a.snapshots.is_empty());
}
#[test]
fn memory_delete_requires_explicit_confirmation_and_displayed_hash() {
    let mut a = app();
    a.workbench.screen = Screen::MemoryDetail;
    a.workbench.selected = a.snapshots["memory"][0].clone();
    key(&mut a, KeyCode::Char('d'));
    assert!(a.form.as_ref().unwrap().input().is_err());
    let f = a.form.as_mut().unwrap();
    f.fields
        .iter_mut()
        .find(|f| f.name == "@confirm")
        .unwrap()
        .value = "yes".into();
    let (args, flags) = f.input().unwrap();
    assert_eq!(args, vec!["demo", "mem-1", &hash()]);
    assert!(!flags.contains_key("@confirm"));
}
#[test]
fn prompt_edit_uses_inline_document_and_exact_displayed_version() {
    let mut a = app();
    a.workbench.screen = Screen::PromptDetail;
    key(&mut a, KeyCode::Char('e'));
    let f = a.form.as_mut().unwrap();
    f.fields
        .iter_mut()
        .find(|f| f.name == "@document")
        .unwrap()
        .value = "New body\n界".into();
    a.submit();
    let request = a.queue.back().unwrap();
    assert_eq!(request.fields["name"], "save-prompt");
    assert_eq!(request.fields["args"], json!(["demo", "review", "-"]));
    assert_eq!(request.fields["flags"]["expected-version"], "2");
    assert_eq!(request.fields["stdin_document"], "New body\n界");
    assert!(request.fields["flags"].get("@document").is_none());
}
#[test]
fn creating_plan_opens_exact_plan_and_binds_related_run() {
    let mut a = app();
    a.invoke("plan", vec!["ticket-1".into()], Default::default(), false);
    event(
        &mut a,
        json!({"plan":{"id":"new-plan"},"run":{"id":"new-run"}}),
    );
    assert_eq!(a.context["plan"], "new-plan");
    assert_eq!(a.context["run"], "new-run");
    assert_eq!(a.workbench.screen, Screen::Plan);
    assert_eq!(a.queue.back().unwrap().fields["name"], "show-plan");
}
#[test]
fn all_catalog_actions_have_reachable_forms_and_hash_is_never_prefilled() {
    let mut a = app();
    let names = a
        .commands
        .iter()
        .map(|c| c.name.clone())
        .collect::<Vec<_>>();
    assert_eq!(names.len(), 61);
    for name in names {
        a.active_request = None;
        a.begin(&name);
        if let Some(form) = &a.form {
            assert!(form.fields.iter().all(|f| f.name != "acknowledge-hash"));
        }
    }
}
#[test]
fn stale_result_does_not_change_snapshots_or_view() {
    let mut a = app();
    let before = a.snapshots.clone();
    a.apply(
        serde_json::from_value(
            json!({"v":1,"id":"stale","event":"result","value":{"id":"foreign"},"formatted":"bad"}),
        )
        .unwrap(),
    );
    assert_eq!(a.snapshots, before);
}
#[test]
fn exact_six_tones_and_monochrome_preserve_status_semantics() {
    let t = Theme { color: true };
    let colors = [
        "success",
        "active",
        "danger",
        "attention",
        "neutral",
        "interrupted",
    ]
    .iter()
    .map(|v| format!("{:?}", t.tone(v).fg))
    .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(colors.len(), 6);
    assert_eq!(t.base().bg, Some(Color::Rgb(0, 0, 170)));
    assert_eq!(state_tone("completed"), "neutral");
    assert_eq!(state_tone("interrupted"), "interrupted");
    assert_eq!(state_tone("reviewed"), "success");
    assert_eq!(Theme { color: false }.tone("danger").fg, None);
}
#[test]
fn empty_error_loading_and_end_scrolling_remain_visible() {
    for screen in [
        Screen::Home,
        Screen::Projects,
        Screen::Missions,
        Screen::Memory,
        Screen::Prompts,
        Screen::Runs,
    ] {
        let mut a = app();
        a.snapshots.clear();
        a.workbench.screen = screen;
        let text = draw(&mut a, 40, 12, false);
        assert!(!text.is_empty());
        a.workbench.error = Some("Stale record: refresh before retry".into());
        assert!(draw(&mut a, 60, 24, false).contains("Stale record"));
    }
    let mut a = app();
    a.workbench.screen = Screen::Plan;
    key(&mut a, KeyCode::End);
    assert!(draw(&mut a, 40, 12, false).contains("Plan"));
}

#[test]
fn every_catalog_form_keeps_its_focused_field_and_input_visible_when_small() {
    let names = app()
        .commands
        .iter()
        .map(|c| c.name.clone())
        .collect::<Vec<_>>();
    for name in names {
        let mut a = app();
        a.begin(&name);
        let Some(form) = a.form.as_mut() else {
            continue;
        };
        if form.fields.is_empty() {
            continue;
        }
        form.cursor = form.fields.len() - 1;
        form.fields.last_mut().unwrap().value = "Unicode 界\nlast-input-marker".into();
        for (w, h) in [(40, 12), (60, 24), (80, 12), (120, 35)] {
            let painted = draw(&mut a, w, h, false);
            assert!(
                painted.contains("last-input-marker"),
                "{name} focused input hidden at {w}x{h}"
            );
            assert!(painted.contains("submit"), "{name} submit hint hidden");
        }
        key(&mut a, KeyCode::Char('q'));
        assert!(!a.quit, "q must enter text in {name}");
    }
}

#[test]
fn selected_context_enters_only_explicit_plan_form_submission() {
    let mut a = app();
    a.workbench.screen = Screen::PromptDetail;
    key(&mut a, KeyCode::Char('s'));
    assert!(a.queue.is_empty());
    a.workbench.memory_ids.insert("mem-1".into());
    a.workbench.screen = Screen::Ticket;
    key(&mut a, KeyCode::Char('p'));
    assert!(a.queue.is_empty());
    let (_, flags) = a.form.as_ref().unwrap().input().unwrap();
    assert_eq!(flags["memory"], json!(["mem-1"]));
    assert_eq!(flags["prompt"], format!("review@2#{}", hash()));
    a.submit();
    assert_eq!(a.queue.back().unwrap().fields["name"], "plan");
}

#[test]
fn memory_scope_choice_issues_explicit_read_and_can_be_removed() {
    let mut a = app();
    a.workbench.screen = Screen::Memory;
    assert!(!a.workbench.include_user);
    key(&mut a, KeyCode::Char('u'));
    let request = a.queue.back().unwrap();
    assert_eq!(request.fields["flags"]["include-user"], true);
    event(
        &mut a,
        json!([{"id":"personal","scope":"user","content":"Private","hash":hash()}]),
    );
    a.workbench.memory_ids.insert("personal".into());
    key(&mut a, KeyCode::Char('u'));
    assert!(!a.workbench.include_user);
    assert!(!a.workbench.memory_ids.contains("personal"));
    assert_eq!(
        a.queue.back().unwrap().fields["flags"]["include-user"],
        false
    );
}

#[test]
fn reconnect_refreshes_the_visual_view_without_discarding_unsent_forms() {
    let mut a = app();
    a.workbench.screen = Screen::Memory;
    a.connection = "reconnecting".into();
    a.apply(serde_json::from_value(json!({"v":1,"id":"connection","event":"connection","state":"connected","message":"restored"})).unwrap());
    assert_eq!(a.mode, Mode::Workbench);
    assert_eq!(a.queue.back().unwrap().fields["name"], "memory");
    event(&mut a, json!([]));
    a.begin("remember");
    a.form
        .as_mut()
        .unwrap()
        .fields
        .iter_mut()
        .find(|f| f.name == "content")
        .unwrap()
        .value = "unsent draft".into();
    a.connection = "reconnecting".into();
    let queued = a.queue.len();
    a.apply(serde_json::from_value(json!({"v":1,"id":"connection","event":"connection","state":"connected","message":"restored"})).unwrap());
    assert_eq!(a.mode, Mode::Form);
    assert_eq!(a.queue.len(), queued);
    assert_eq!(
        a.form
            .as_ref()
            .unwrap()
            .fields
            .iter()
            .find(|f| f.name == "content")
            .unwrap()
            .value,
        "unsent draft"
    );
}

fn fail_read(a: &mut AppState, aborted: bool) {
    if aborted {
        key(a, KeyCode::Esc);
    }
    let id = a.active_request.clone().unwrap();
    a.apply(serde_json::from_value(json!({"v":1,"id":id,"event":"error","message":"Record read failed","outcome":if aborted{"aborted"}else{"refused"}})).unwrap());
}

#[test]
fn failed_or_aborted_ticket_switch_cannot_prefill_previous_ticket_into_new_id() {
    for aborted in [false, true] {
        let mut a = app();
        a.workbench.screen = Screen::Missions;
        a.snapshots.get_mut("board").unwrap()["columns"][0]["cards"][0]["ticket_id"] =
            json!("ticket-B");
        a.snapshots.get_mut("board").unwrap()["columns"][0]["cards"][0]["run_id"] = json!("run-B");
        key(&mut a, KeyCode::Enter);
        assert_eq!(a.context["ticket"], "ticket-B");
        assert!(!a.context.contains_key("plan"));
        fail_read(&mut a, aborted);
        assert!(views::selected(&a).is_null());
        let queued = a.queue.len();
        key(&mut a, KeyCode::Char('e'));
        assert!(a.form.is_none());
        assert_eq!(a.queue.len(), queued);
        assert!(a.status.contains("not loaded"));
    }
}

#[test]
fn generic_record_switches_clear_cached_bodies_and_dependent_identity() {
    for (screen, command, argument, new_id, action) in [
        (Screen::RunDetail, "run", "run", "run-B", 'p'),
        (Screen::Plan, "show-plan", "plan", "plan-B", 'a'),
        (
            Screen::PromptDetail,
            "render-prompt",
            "name",
            "prompt-B",
            'e',
        ),
    ] {
        let mut a = app();
        a.workbench.screen = screen;
        a.begin(command);
        a.form
            .as_mut()
            .unwrap()
            .fields
            .iter_mut()
            .find(|f| f.name == argument)
            .unwrap()
            .value = new_id.into();
        if command == "render-prompt" {
            a.form
                .as_mut()
                .unwrap()
                .fields
                .iter_mut()
                .find(|f| f.name == "version")
                .unwrap()
                .value = "2".into();
        }
        a.submit();
        assert!(a.active_request.is_some(), "{command}");
        fail_read(&mut a, true);
        a.mode = Mode::Workbench;
        a.form = None;
        assert!(
            views::selected(&a).is_null(),
            "{command} retained a foreign record"
        );
        key(&mut a, KeyCode::Char(action));
        assert!(a.form.is_none());
        if command == "run" {
            assert!(!a.context.contains_key("plan"));
        }
        if command == "show-plan" {
            assert!(!a.context.contains_key("run"));
        }
    }
}

#[test]
fn successful_prompt_for_other_query_cannot_be_edited_under_previous_selection() {
    let mut a = app();
    a.workbench.screen = Screen::PromptDetail;
    a.invoke(
        "render-prompt",
        vec!["demo".into(), "other".into(), "2".into()],
        Default::default(),
        true,
    );
    event(
        &mut a,
        json!({"name":"other","version":2,"hash":hash(),"body":"Foreign body"}),
    );
    a.mode = Mode::Workbench;
    assert!(views::selected(&a).is_null());
    key(&mut a, KeyCode::Char('e'));
    assert!(a.form.is_none());
}

#[test]
fn fresh_board_ticket_run_plan_navigation_uses_each_runs_authoritative_plan() {
    let mut a = app();
    for suffix in ["B", "C"] {
        a.active_request = None;
        a.workbench.screen = Screen::Missions;
        a.snapshots.get_mut("board").unwrap()["columns"][0]["cards"][0]["ticket_id"] =
            json!(format!("ticket-{suffix}"));
        a.snapshots.get_mut("board").unwrap()["columns"][0]["cards"][0]["run_id"] =
            json!(format!("run-{suffix}"));
        key(&mut a, KeyCode::Enter);
        assert!(!a.context.contains_key("plan"));
        event(
            &mut a,
            json!({"id":format!("ticket-{suffix}"),"revision":3,"title":"Current ticket"}),
        );
        key(&mut a, KeyCode::Char('g'));
        assert_eq!(
            a.queue.back().unwrap().fields["args"],
            json!([format!("run-{suffix}")])
        );
        event(
            &mut a,
            json!({"id":format!("run-{suffix}"),"metadata":{"plan_id":format!("plan-{suffix}"),"ticket_id":format!("ticket-{suffix}")}}),
        );
        key(&mut a, KeyCode::Char('p'));
        assert_eq!(
            a.queue.back().unwrap().fields["args"],
            json!([format!("plan-{suffix}")])
        );
        event(&mut a, json!({"id":format!("plan-{suffix}"),"hash":hash()}));
    }
}

#[test]
fn delayed_user_memory_response_cannot_appear_under_excluded_scope() {
    let mut a = app();
    a.workbench.screen = Screen::Memory;
    key(&mut a, KeyCode::Char('u'));
    let first = a.active_request.clone();
    assert!(a.workbench.include_user);
    key(&mut a, KeyCode::Char('u'));
    assert!(a.workbench.include_user);
    assert_eq!(a.active_request, first);
    event(
        &mut a,
        json!([{"id":"private","scope":"user","content":"Explicit only","hash":hash()}]),
    );
    assert_eq!(views::rows(&a).len(), 1);
    a.workbench.memory_ids.insert("private".into());
    key(&mut a, KeyCode::Char('u'));
    assert!(!a.workbench.include_user);
    assert!(views::rows(&a).is_empty());
    assert!(a.workbench.memory_ids.is_empty());
    // Defense in depth: even an unexpected included row in an excluded response is never selectable.
    event(
        &mut a,
        json!([{"id":"private","scope":"user","content":"Unexpected","hash":hash()}]),
    );
    assert!(views::rows(&a).is_empty());
}

fn result_app(lines: usize, motion: ScrollMotion) -> AppState {
    let mut a = AppState::default();
    a.mode = Mode::Result;
    a.output = (0..lines).map(|i| format!("line-{i:03}\n")).collect();
    a.set_scroll_motion(motion);
    a
}

/// Draw once, then advance+draw until settled. Returns every drawn frame.
fn settle(a: &mut AppState) -> Vec<String> {
    let mut frames = vec![draw(a, 60, 20, false)];
    for _ in 0..32 {
        if !a.animating() {
            return frames;
        }
        a.advance_animations(Duration::from_millis(16));
        frames.push(draw(a, 60, 20, false));
    }
    panic!("scroll animation did not settle within 32 frames");
}

#[test]
fn eased_scroll_settles_to_the_instant_frame() {
    let mut instant = result_app(200, ScrollMotion::Instant);
    let mut eased = result_app(200, ScrollMotion::Eased(DEFAULT_SCROLL_DURATION));
    let mut previous = draw(&mut instant, 60, 20, false);
    settle(&mut eased);
    for code in [
        KeyCode::PageDown,
        KeyCode::PageDown,
        KeyCode::PageDown,
        KeyCode::End,
        KeyCode::Home,
        KeyCode::PageDown,
    ] {
        key(&mut instant, code);
        key(&mut eased, code);
        let expected = draw(&mut instant, 60, 20, false);
        let frames = settle(&mut eased);
        let last = frames.last().unwrap();
        assert_eq!(last, &expected);
        assert!(
            frames[..frames.len() - 1]
                .iter()
                .any(|f| *f != previous && f != last),
            "no intermediate frame was drawn for {code:?}"
        );
        previous = expected;
    }
}

#[test]
fn eased_tail_follow_tracks_new_output_until_the_user_scrolls_up() {
    let mut a = result_app(100, ScrollMotion::Eased(DEFAULT_SCROLL_DURATION));
    settle(&mut a);
    key(&mut a, KeyCode::End);
    settle(&mut a);
    for i in 100..130 {
        a.append(&format!("line-{i:03}\n"));
    }
    assert!(settle(&mut a).pop().unwrap().contains("line-129"));
    key(&mut a, KeyCode::Up);
    let held = settle(&mut a).pop().unwrap();
    for i in 130..160 {
        a.append(&format!("line-{i:03}\n"));
    }
    assert_eq!(settle(&mut a).pop().unwrap(), held);
}
