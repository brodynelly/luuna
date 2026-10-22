use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use luuna_tui::{
    app::AppState,
    bridge::{default_bridge, Bridge},
    protocol::safe_text,
    terminal::{install_panic_restore, TerminalGuard},
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
    time::Duration,
};

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
    let guard = TerminalGuard::enter()?;
    let mut terminal = guard.screen()?;
    let theme = Theme::from_env();
    let mut token = std::env::var("LUUNA_API_TOKEN").unwrap_or_default();
    if token.trim().is_empty() {
        match secret(&mut terminal, theme)? {
            Some(value) => token = value,
            None => return Ok(0),
        }
    }
    let url = std::env::var("LUUNA_URL").ok();
    let mut bridge = Bridge::spawn(&node, &script, &token, url.as_deref())?;
    token.clear();
    let mut app = AppState::default();
    app.start();
    let mut transport_stopped = false;
    let result = loop {
        while let Some(request) = app.queue.pop_front() {
            if let Err(error) = bridge.send(&request) {
                app.transport_failed(&error);
                break;
            }
        }
        // Bound work per frame: terminal input still runs when the producer is busy.
        for _ in 0..32 {
            match bridge.try_recv() {
                Some(Ok(event)) => app.apply(event),
                Some(Err(error)) => {
                    app.transport_failed(&error);
                    break;
                }
                None => break,
            }
        }
        if app.bridge_failed && !transport_stopped {
            bridge.shutdown().await;
            transport_stopped = true;
        }
        if let Err(error) = terminal.draw(|frame| ui::render(frame, &mut app, theme)) {
            break Err(error);
        }
        if app.quit {
            break Ok(0);
        }
        match event::poll(Duration::from_millis(35)) {
            Ok(true) => match event::read() {
                Ok(Event::Key(key)) if key.kind != KeyEventKind::Release => app.key(key),
                Ok(Event::Paste(text)) => app.paste(&text),
                Ok(_) => {}
                Err(error) => break Err(error),
            },
            Ok(false) => {}
            Err(error) => break Err(error),
        }
        tokio::task::yield_now().await;
    };
    bridge.shutdown().await;
    drop(terminal);
    drop(guard);
    result
}

fn secret(terminal: &mut luuna_tui::terminal::Screen, theme: Theme) -> io::Result<Option<String>> {
    let mut value = String::new();
    loop {
        terminal.draw(|frame|{
            let text=format!("LUUNA / LOCAL RUNTIME\n\nService token (hidden): {}\n\nEnter connects · Esc quits\nThe token remains in process memory and the owned bridge environment.","•".repeat(value.chars().count().min(32)));
            frame.render_widget(Paragraph::new(text).block(Block::default().borders(Borders::ALL).title(" Connection ")).style(theme.panel().add_modifier(Modifier::BOLD)).wrap(Wrap{trim:false}),frame.area());
        })?;
        match event::read()? {
            Event::Key(key) if key.kind != KeyEventKind::Release => match key.code {
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
            },
            Event::Paste(text) => {
                let text = safe_text(&text);
                if !text.contains('\n') && value.len() + text.len() <= 8192 {
                    value.push_str(&text);
                }
            }
            _ => {}
        }
    }
}
