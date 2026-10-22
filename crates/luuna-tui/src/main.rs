use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use luuna_tui::{
    app::AppState,
    bridge::{default_bridge, Bridge},
    frame::{sync_from, FrameClock},
    input::{Input, INPUT_QUEUE},
    protocol::{safe_text, BridgeEvent, QUEUE_SIZE},
    scroll::ScrollMotion,
    terminal::{draw_frame, install_panic_restore, Shutdown, TerminalGuard},
    theme::Theme,
    ui,
};
use ratatui::{
    style::Modifier,
    widgets::{Block, Borders, Paragraph, Wrap},
};
use std::{
    io::{self, IsTerminal},
    path::PathBuf,
    time::{Duration, Instant},
};

/// Shutdown marker/signal check cadence; it never draws.
const SHUTDOWN_POLL: Duration = Duration::from_millis(100);

const HELP:&str="luuna-tui — Rust terminal workbench\n\nUsage: luuna-tui [--bridge <absolute bridge.mjs path>] [--node <node executable>]\n\nConnection: LUUNA_URL (HTTP loopback) and LUUNA_API_TOKEN (hidden prompt if absent).\nUse the existing Luuna CLI for named script commands and JSON output.\nF1 help · F2 catalog · F5 refresh · q/Ctrl+C quit · Esc stops local request.\n";

#[tokio::main]
async fn main() -> std::process::ExitCode {
    match run().await {
        Ok(code) => std::process::ExitCode::from(code),
        Err(error) => {
            eprintln!("Luuna terminal: {}", safe_text(&error.to_string()));
            std::process::ExitCode::FAILURE
        }
    }
}

async fn run() -> io::Result<u8> {
    let mut args = std::env::args().skip(1);
    let mut script = default_bridge();
    let mut node = PathBuf::from("node");
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                print!("{HELP}");
                return Ok(0);
            }
            "--bridge" => {
                script = PathBuf::from(
                    args.next()
                        .ok_or_else(|| io::Error::other("--bridge needs a path"))?,
                );
                if !script.is_absolute() {
                    return Err(io::Error::other("--bridge must be an absolute path"));
                }
            }
            "--node" => {
                node = PathBuf::from(
                    args.next()
                        .ok_or_else(|| io::Error::other("--node needs an executable"))?,
                )
            }
            _ => {
                eprintln!("Unknown terminal option.\n{HELP}");
                return Ok(2);
            }
        }
    }
    if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
        print!("{HELP}");
        return Ok(2);
    }
    if !script.is_file() {
        return Err(io::Error::other(
            "Transport bridge missing; use the packaged launcher or --bridge.",
        ));
    }
    install_panic_restore();
    let shutdown = Shutdown::install()?;
    let guard = TerminalGuard::enter()?;
    // Declared after `guard` so early returns join the input thread before restoration.
    let mut input = Input::spawn()?;
    let mut terminal = guard.screen()?;
    let sync = sync_from(std::env::var("LUUNA_TUI_SYNC").ok().as_deref());
    let mut clock = FrameClock::from_env();
    let theme = Theme::from_env();
    let mut token = std::env::var("LUUNA_API_TOKEN").unwrap_or_default();
    if token.trim().is_empty() {
        match secret(
            &mut terminal,
            theme,
            &shutdown,
            &mut input,
            sync,
            &mut clock,
        )
        .await?
        {
            Some(value) => token = value,
            None => {
                drop(input);
                drop(terminal);
                drop(guard);
                return Ok(0);
            }
        }
    }
    let url = std::env::var("LUUNA_URL").ok();
    let mut bridge = Bridge::spawn(&node, &script, &token, url.as_deref())?;
    token.clear();
    let mut app = AppState::default();
    app.set_scroll_motion(ScrollMotion::from_env());
    app.start();
    let mut transport_stopped = false;
    let mut bridge_open = true;
    clock.mark_dirty();
    let mut shutdown_tick = tokio::time::interval(SHUTDOWN_POLL);
    shutdown_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let result = loop {
        if shutdown.requested() {
            break Ok(0);
        }
        while let Some(request) = app.queue.pop_front() {
            clock.mark_dirty();
            if let Err(error) = bridge.send(&request) {
                app.transport_failed(&error);
                break;
            }
        }
        if app.bridge_failed && !transport_stopped {
            bridge.shutdown().await;
            transport_stopped = true;
            clock.mark_dirty();
        }
        if app.animating() {
            clock.request_animation_frame();
        }
        let now = Instant::now();
        if clock.should_draw(now) {
            app.advance_animations(clock.frame_delta(now));
            if let Err(error) = draw_frame(&mut terminal, sync, |frame| {
                ui::render(frame, &mut app, theme)
            }) {
                break Err(error);
            }
            clock.frame_drawn(now);
        }
        if app.quit {
            break Ok(0);
        }
        let deadline = clock
            .next_deadline(Instant::now())
            .map(tokio::time::Instant::from_std);
        tokio::select! {
            biased;
            event = input.recv() => match event {
                Some(Ok(event)) => {
                    handle_input(&mut app, &mut clock, event);
                    let mut failed = None;
                    for _ in 0..INPUT_QUEUE {
                        match input.try_recv() {
                            Some(Ok(event)) => handle_input(&mut app, &mut clock, event),
                            Some(Err(error)) => {
                                failed = Some(error);
                                break;
                            }
                            None => break,
                        }
                    }
                    if let Some(error) = failed {
                        break Err(error);
                    }
                }
                Some(Err(error)) => break Err(error),
                None => break Err(io::Error::other("Terminal input closed")),
            },
            event = bridge.recv(), if bridge_open && !transport_stopped => {
                clock.mark_dirty();
                match event {
                    Some(first) => {
                        // Bound work per wake: terminal input still runs when the producer is busy.
                        let mut next = Some(first);
                        for _ in 0..=QUEUE_SIZE {
                            let Some(result) = next.take() else { break };
                            if !apply_bridge(&mut app, result) {
                                break;
                            }
                            next = bridge.try_recv();
                        }
                    }
                    None => {
                        bridge_open = false;
                        if !app.bridge_failed {
                            app.transport_failed("Bridge event channel closed. Inspect runtime state before retrying an in-flight mutation.");
                        }
                    }
                }
            },
            _ = tokio::time::sleep_until(deadline.unwrap_or_else(tokio::time::Instant::now)), if deadline.is_some() => {},
            _ = shutdown_tick.tick() => {},
        }
    };
    bridge.shutdown().await;
    drop(input);
    drop(terminal);
    drop(guard);
    result
}

fn handle_input(app: &mut AppState, clock: &mut FrameClock, event: Event) {
    match event {
        Event::Key(key) if key.kind != KeyEventKind::Release => {
            app.key(key);
            clock.mark_dirty();
        }
        Event::Paste(text) => {
            app.paste(&text);
            clock.mark_dirty();
        }
        Event::Resize(..) => clock.mark_dirty(),
        _ => {}
    }
}

/// Returns false when the transport failed and draining should stop.
fn apply_bridge(app: &mut AppState, result: Result<BridgeEvent, String>) -> bool {
    match result {
        Ok(event) => {
            app.apply(event);
            true
        }
        Err(error) => {
            app.transport_failed(&error);
            false
        }
    }
}

async fn secret(
    terminal: &mut luuna_tui::terminal::Screen,
    theme: Theme,
    shutdown: &Shutdown,
    input: &mut Input,
    sync: bool,
    clock: &mut FrameClock,
) -> io::Result<Option<String>> {
    let mut value = String::new();
    let mut shutdown_tick = tokio::time::interval(SHUTDOWN_POLL);
    shutdown_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    clock.mark_dirty();
    loop {
        if shutdown.requested() {
            return Ok(None);
        }
        let now = Instant::now();
        if clock.should_draw(now) {
            draw_frame(terminal, sync, |frame| {
                let text=format!("LUUNA / LOCAL RUNTIME\n\nService token (hidden): {}\n\nEnter connects · Esc quits\nThe token remains in process memory and the owned bridge environment.","•".repeat(value.chars().count().min(32)));
                frame.render_widget(
                    Paragraph::new(text)
                        .block(Block::default().borders(Borders::ALL).title(" Connection "))
                        .style(theme.panel().add_modifier(Modifier::BOLD))
                        .wrap(Wrap { trim: false }),
                    frame.area(),
                );
            })?;
            clock.frame_drawn(now);
        }
        let deadline = clock
            .next_deadline(Instant::now())
            .map(tokio::time::Instant::from_std);
        let event = tokio::select! {
            biased;
            event = input.recv() => match event {
                Some(event) => event?,
                None => return Err(io::Error::other("Terminal input closed")),
            },
            _ = tokio::time::sleep_until(deadline.unwrap_or_else(tokio::time::Instant::now)), if deadline.is_some() => continue,
            _ = shutdown_tick.tick() => continue,
        };
        match event {
            Event::Key(key) if key.kind != KeyEventKind::Release => {
                clock.mark_dirty();
                match key.code {
                    KeyCode::Esc => return Ok(None),
                    KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        return Ok(None)
                    }
                    KeyCode::Enter if !value.trim().is_empty() => return Ok(Some(value)),
                    KeyCode::Backspace => {
                        value.pop();
                    }
                    KeyCode::Char(c) if !c.is_control() && value.len() < 8192 => value.push(c),
                    _ => {}
                }
            }
            Event::Paste(text) => {
                clock.mark_dirty();
                let text = safe_text(&text);
                if !text.contains('\n') && value.len() + text.len() <= 8192 {
                    value.push_str(&text);
                }
            }
            Event::Resize(..) => clock.mark_dirty(),
            _ => {}
        }
    }
}
