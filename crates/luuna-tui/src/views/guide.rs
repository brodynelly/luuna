//! The guide screen: a step rail with a moon that waxes as steps settle, the guide's styled log
//! with boxed previews, and the open question (a prompt, a choice, a checklist) or the spinner.
use crate::{
    app::{AppState, Mode},
    guide::{Ending, GuideState, Ink, Question, Row, Segment},
    protocol::ClientCommand,
    theme::Theme,
};
use crossterm::event::{KeyCode, KeyEvent};
use ratatui::{
    layout::{Constraint, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Clear, Paragraph},
    Frame,
};
use serde_json::{json, Map, Value};
use unicode_width::UnicodeWidthChar;

const SPINNER: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const MOON: [&str; 4] = ["◐", "◓", "◑", "◒"];

/// Starts a guide over the bridge (`prime` is the only one); the workbench shows it full-screen.
pub fn begin(app: &mut AppState, name: &str, flags: Map<String, Value>) {
    if app.bridge_failed {
        app.status =
            "Transport stopped. Restart the terminal to reconnect; nothing was sent.".into();
        return;
    }
    if app.active_request.is_some() {
        app.status =
            "Finish or Esc-stop the current request before starting the setup guide.".into();
        return;
    }
    let id = app.id();
    let request = ClientCommand::new(&id, "guide", json!({"name": name, "flags": flags}));
    app.pending.insert(id.clone(), request.clone());
    app.active_request = Some(id.clone());
    app.guide = Some(GuideState::new(name, &id));
    app.mode = Mode::Guide;
    app.status = "Setting up a project".into();
    app.queue.push_back(request);
}

/// Leaves the finished (or abandoned) guide for the workbench, on the project it set up when known.
fn leave(app: &mut AppState) {
    let project = app
        .guide
        .take()
        .map(|guide| {
            guide
                .finish
                .map(|finish| finish.project)
                .filter(|p| !p.is_empty())
                .unwrap_or(guide.project)
        })
        .unwrap_or_default();
    app.mode = Mode::Workbench;
    app.workbench.initialized = true;
    if project.is_empty() {
        super::open(app, super::Screen::Home);
    } else {
        super::choose_project(app, &project);
        super::open(app, super::Screen::Project);
    }
}

pub fn key(app: &mut AppState, key: KeyEvent) {
    let reply_id = app.id();
    let Some(guide) = app.guide.as_mut() else {
        app.mode = Mode::Workbench;
        return;
    };
    if guide.ending.is_some() {
        match key.code {
            KeyCode::Enter | KeyCode::Esc => leave(app),
            KeyCode::Char('q') => app.quit = true,
            KeyCode::PageUp => guide.scroll = guide.scroll.saturating_add(8),
            KeyCode::PageDown => guide.scroll = guide.scroll.saturating_sub(8),
            _ => {}
        }
        return;
    }
    if guide.leaving {
        match key.code {
            KeyCode::Enter | KeyCode::Char('y') => {
                guide.leaving = false;
                let request_id = guide.request_id.clone();
                app.queue.push_back(ClientCommand::new(
                    reply_id,
                    "abort",
                    json!({"request_id": request_id}),
                ));
                app.status = "Leaving the setup; nothing is undone.".into();
            }
            KeyCode::Esc | KeyCode::Char('n') => guide.leaving = false,
            _ => {}
        }
        return;
    }
    if key.code == KeyCode::Esc {
        guide.leaving = true;
        return;
    }
    if let Some(reply) = guide.key(key, || reply_id) {
        app.queue.push_back(reply);
    }
}

fn ink(theme: Theme, ink: Ink) -> Style {
    let style = match ink {
        Ink::Plain => theme.panel(),
        Ink::Bold => theme.panel().add_modifier(Modifier::BOLD),
        Ink::Dim => theme.base(),
        Ink::Cyan => theme.accent(),
        Ink::Green => theme.tone("success"),
        Ink::Red => theme.tone("danger"),
        Ink::Yellow => theme.tone("attention"),
        Ink::Magenta => theme.tone("interrupted"),
    };
    if theme.color {
        style
    } else {
        match ink {
            Ink::Bold | Ink::Red | Ink::Green => style.add_modifier(Modifier::BOLD),
            Ink::Dim => style.add_modifier(Modifier::DIM),
            _ => style,
        }
    }
}

/// Segments wrapped to `width` columns at the last space that fits (inside a word only when the
/// word alone is wider than a row); continuation rows are indented by `indent`.
fn wrap(segments: &[(String, Style)], width: usize, indent: usize) -> Vec<Line<'static>> {
    let width = width.max(8);
    let indent = indent.min(width / 2);
    let cells: Vec<(char, Style)> = segments
        .iter()
        .flat_map(|(text, style)| text.chars().map(move |c| (c, *style)))
        .collect();
    let mut rows: Vec<Vec<(char, Style)>> = Vec::new();
    let mut row: Vec<(char, Style)> = Vec::new();
    let mut used = 0;
    let mut last_space: Option<usize> = None;
    for (c, style) in cells {
        let w = c.width().unwrap_or(0);
        if used + w > width {
            let pad = vec![(' ', Style::default()); indent];
            if c == ' ' {
                rows.push(std::mem::take(&mut row));
                row = pad;
                used = indent;
                last_space = None;
                continue;
            }
            let carry = match last_space {
                Some(at) if at > indent => {
                    let tail = row.split_off(at + 1);
                    row.pop();
                    tail
                }
                _ => Vec::new(),
            };
            rows.push(std::mem::take(&mut row));
            row = pad;
            row.extend(carry);
            used = row.iter().map(|(ch, _)| ch.width().unwrap_or(0)).sum();
            last_space = None;
        }
        if c == ' ' {
            last_space = Some(row.len());
        }
        row.push((c, style));
        used += w;
    }
    rows.push(row);
    rows.into_iter()
        .map(|cells| {
            let mut spans: Vec<Span<'static>> = Vec::new();
            let mut run = String::new();
            let mut run_style = cells.first().map(|(_, style)| *style).unwrap_or_default();
            for (c, style) in cells {
                if style != run_style && !run.is_empty() {
                    spans.push(Span::styled(std::mem::take(&mut run), run_style));
                }
                run_style = style;
                run.push(c);
            }
            if !run.is_empty() {
                spans.push(Span::styled(run, run_style));
            }
            Line::from(spans)
        })
        .collect()
}

fn log_lines(guide: &GuideState, width: usize, theme: Theme) -> Vec<Line<'static>> {
    let dim = ink(theme, Ink::Dim);
    let mut out = Vec::new();
    let styled = |segments: &[Segment]| {
        segments
            .iter()
            .map(|(text, kind)| (text.clone(), ink(theme, *kind)))
            .collect::<Vec<_>>()
    };
    for row in &guide.log {
        match row {
            Row::Line(segments) if segments.is_empty() => out.push(Line::raw("")),
            Row::Line(segments) => out.extend(wrap(&styled(segments), width, 4)),
            Row::PanelTop(title) => {
                let rule = width.saturating_sub(title.chars().count() + 9);
                out.push(Line::from(vec![
                    Span::styled("    ╭─ ", dim),
                    Span::styled(title.clone(), ink(theme, Ink::Bold)),
                    Span::styled(format!(" {}", "─".repeat(rule)), dim),
                ]));
            }
            Row::PanelBody(text) => {
                for line in wrap(
                    &[(text.clone(), ink(theme, Ink::Plain))],
                    width.saturating_sub(6),
                    0,
                ) {
                    let mut spans = vec![Span::styled("    │ ", dim)];
                    spans.extend(line.spans);
                    out.push(Line::from(spans));
                }
            }
            Row::PanelBottom => out.push(Line::styled(
                format!("    ╰{}", "─".repeat(width.saturating_sub(5))),
                dim,
            )),
        }
    }
    out
}

/// A moon drawn in cells whose lit part grows from the right edge with `progress` (0 to 1).
fn moon(progress: f64, rows: u16, theme: Theme) -> Vec<Line<'static>> {
    let rows = rows.clamp(3, 9) as i32;
    let radius = rows as f64 / 2.0;
    let cols = rows * 2;
    let lit = theme.tone("attention");
    let dark = theme.base();
    (0..rows)
        .map(|r| {
            let y = (r as f64 + 0.5 - radius) / radius;
            let spans = (0..cols)
                .map(|c| {
                    let x = (c as f64 + 0.5 - rows as f64) / rows as f64;
                    if x * x + y * y > 1.0 {
                        Span::styled(" ", dark)
                    } else if x >= 1.0 - 2.0 * progress {
                        Span::styled("█", lit)
                    } else {
                        Span::styled("░", dark)
                    }
                })
                .collect::<Vec<_>>();
            Line::from(spans)
        })
        .collect()
}

fn mark(state: &str) -> (&'static str, &'static str) {
    match state {
        "done" => ("✔", "success"),
        "current" => ("●", "active"),
        "skipped" => ("–", "neutral"),
        _ => ("○", "neutral"),
    }
}

fn render_rail(frame: &mut Frame, guide: &GuideState, area: Rect, theme: Theme) {
    let block = Block::default()
        .title(Line::styled(" Setup ", theme.title()))
        .borders(Borders::ALL)
        .border_type(BorderType::Double)
        .border_style(theme.focused())
        .style(theme.panel());
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let mut lines = vec![Line::raw("")];
    for (index, step) in guide.steps.iter().enumerate() {
        let state = guide
            .states
            .get(index)
            .map(String::as_str)
            .unwrap_or("pending");
        let (symbol, tone) = mark(state);
        let current = state == "current" && guide.ending.is_none();
        let label = format!(" {symbol}  {step}");
        let padded = format!("{label:<width$}", width = inner.width as usize);
        lines.push(if current {
            Line::styled(padded, theme.selected())
        } else {
            Line::from(vec![
                Span::styled(format!(" {symbol}  "), theme.tone(tone)),
                Span::styled(
                    step.clone(),
                    if state == "pending" {
                        theme.base()
                    } else {
                        theme.panel()
                    },
                ),
            ])
        });
    }
    let (settled, total) = guide.progress();
    let bar_width = inner.width.saturating_sub(8) as usize;
    let filled = bar_width * settled / total;
    lines.push(Line::raw(""));
    lines.push(Line::from(vec![
        Span::raw(" "),
        Span::styled("█".repeat(filled), theme.tone("success")),
        Span::styled("░".repeat(bar_width - filled), theme.base()),
        Span::styled(format!(" {settled}/{total}"), theme.panel()),
    ]));
    let used = lines.len() as u16;
    frame.render_widget(Paragraph::new(lines).style(theme.panel()), inner);
    let room = inner.height.saturating_sub(used + 1);
    if room >= 5 && inner.width >= 16 {
        let size = room.min(9).min(inner.width / 2);
        let art = moon(settled as f64 / total as f64, size, theme);
        let width = (size * 2).min(inner.width);
        let x = inner.x + (inner.width - width) / 2;
        let y = inner.y + used + (room - size) / 2 + 1;
        frame.render_widget(
            Paragraph::new(art).style(theme.panel()),
            Rect {
                x,
                y,
                width,
                height: size.min(inner.height.saturating_sub(used)),
            },
        );
    }
}

fn question_lines(guide: &GuideState, width: usize, theme: Theme) -> Vec<Line<'static>> {
    let accent = theme.accent();
    let dim = ink(theme, Ink::Dim);
    let bold = ink(theme, Ink::Bold);
    let row = |pointer: bool, label: &str, hint: &str, prefix: String| {
        let mut spans = vec![
            Span::styled(if pointer { " ❯ " } else { "   " }, accent),
            Span::styled(prefix, if pointer { bold } else { theme.panel() }),
            Span::styled(
                label.to_string(),
                if pointer { bold } else { theme.panel() },
            ),
        ];
        if !hint.is_empty() {
            spans.push(Span::styled(format!("   {hint}"), dim));
        }
        let line = Line::from(spans);
        if pointer {
            line.style(theme.selected())
        } else {
            line
        }
    };
    match (&guide.question, &guide.spinner) {
        (
            Some(Question::Ask {
                label,
                initial,
                optional,
                value,
                ..
            }),
            _,
        ) => {
            let mut lines = vec![Line::from(vec![
                Span::styled(" ? ", accent),
                Span::styled(label.clone(), bold),
            ])];
            let shown = if value.is_empty() {
                vec![
                    Span::styled(" › ", accent),
                    Span::styled("▌", accent.add_modifier(Modifier::SLOW_BLINK)),
                    Span::styled(
                        if !initial.is_empty() {
                            format!(" {initial}   Enter accepts · Tab edits it")
                        } else if *optional {
                            " Enter skips".into()
                        } else {
                            String::new()
                        },
                        dim,
                    ),
                ]
            } else {
                vec![
                    Span::styled(" › ", accent),
                    Span::styled(value.clone(), theme.panel()),
                    Span::styled("▌", accent.add_modifier(Modifier::SLOW_BLINK)),
                ]
            };
            lines.extend(wrap(
                &shown
                    .into_iter()
                    .map(|span| (span.content.to_string(), span.style))
                    .collect::<Vec<_>>(),
                width,
                3,
            ));
            lines
        }
        (
            Some(Question::Choose {
                label,
                options,
                cursor,
                ..
            }),
            _,
        ) => {
            let mut lines = vec![Line::from(vec![
                Span::styled(" ? ", accent),
                Span::styled(label.clone(), bold),
            ])];
            lines.extend(options.iter().enumerate().map(|(i, option)| {
                row(
                    i == *cursor,
                    &option.label,
                    &option.hint,
                    format!("{}. ", i + 1),
                )
            }));
            lines
        }
        (
            Some(Question::Checklist {
                label,
                options,
                checked,
                cursor,
                ..
            }),
            _,
        ) => {
            let mut lines = vec![Line::from(vec![
                Span::styled(" ? ", accent),
                Span::styled(label.clone(), bold),
            ])];
            lines.extend(options.iter().enumerate().map(|(i, option)| {
                let mark = if checked.get(i).copied().unwrap_or(false) {
                    "[x] "
                } else {
                    "[ ] "
                };
                row(i == *cursor, &option.label, &option.hint, mark.into())
            }));
            lines
        }
        (Some(Question::Edit { path, .. }), _) => vec![
            Line::from(vec![
                Span::styled(" ✎ ", accent),
                Span::styled("Editing in your editor", bold),
            ]),
            Line::styled(format!("   {path}"), dim),
            Line::styled("   Save and close the editor to come back.", dim),
        ],
        (None, Some((text, started))) => {
            let frame = (started.elapsed().as_millis() / 80) as usize % SPINNER.len();
            vec![Line::from(vec![
                Span::styled(format!(" {} ", SPINNER[frame]), accent),
                Span::styled(text.clone(), theme.panel()),
                Span::styled(format!("  {}s", started.elapsed().as_secs()), dim),
            ])]
        }
        (None, None) => Vec::new(),
    }
}

fn ending_lines(guide: &GuideState, width: usize, theme: Theme) -> Vec<Line<'static>> {
    let dim = ink(theme, Ink::Dim);
    let bold = ink(theme, Ink::Bold);
    let accent = theme.accent();
    let project = guide
        .finish
        .as_ref()
        .map(|f| f.project.clone())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| guide.project.clone());
    let open = if project.is_empty() {
        "Enter opens the workbench".to_string()
    } else {
        format!("Enter opens {project} in the workbench")
    };
    match (&guide.ending, &guide.finish) {
        (Some(Ending::Finished), Some(finish)) => {
            let mut lines = vec![Line::from(vec![Span::styled(" ✔ ", theme.tone("success")), Span::styled("Ready  ", bold)])];
            let title = finish.title.iter().map(|(text, kind)| (text.clone(), ink(theme, *kind))).collect::<Vec<_>>();
            lines.extend(wrap(&[vec![("   ".to_string(), theme.panel())], title].concat(), width, 3));
            lines.extend(wrap(&[(format!("   {}", finish.summary), dim)], width, 3));
            lines.push(Line::raw(""));
            let column = finish.next.iter().map(|(command, _)| command.chars().count()).max().unwrap_or(0).min(40) + 3;
            for (command, what) in &finish.next {
                lines.push(Line::from(vec![Span::styled(format!("   {command:<column$}"), accent), Span::styled(what.clone(), dim)]));
            }
            lines.push(Line::raw(""));
            lines.push(Line::styled(format!("   {open} · q quits"), bold));
            lines
        }
        (Some(Ending::Left), _) => vec![
            Line::from(vec![Span::styled(" ◌ ", theme.tone("interrupted")), Span::styled("You left the setup. Nothing was undone.", bold)]),
            Line::styled(format!("   Run init again to continue where the runtime's records stand. {open} · q quits"), dim),
        ],
        (Some(Ending::Unavailable), _) => vec![
            Line::from(vec![Span::styled(" ✖ ", theme.tone("danger")), Span::styled("The runtime is not available.", bold)]),
            Line::styled(format!("   Start Luuna, then run init again. {open} · q quits"), dim),
        ],
        (Some(Ending::Failed(message)), _) => {
            let mut lines = vec![Line::from(vec![Span::styled(" ✖ ", theme.tone("danger")), Span::styled("The setup stopped.", bold)])];
            lines.extend(wrap(&[(format!("   {message}"), theme.panel())], width, 3));
            lines.push(Line::styled(format!("   Inspect the project before repeating a step. {open} · q quits"), dim));
            lines
        }
        _ => Vec::new(),
    }
}

pub fn render(frame: &mut Frame, app: &mut AppState, theme: Theme) {
    let area = frame.area();
    let connection = app.connection.clone();
    let Some(guide) = app.guide.as_mut() else {
        return;
    };
    frame.render_widget(Block::default().style(theme.base()), area);
    let [top, body, footer] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Min(4),
        Constraint::Length(1),
    ])
    .areas(area);
    let phase = if guide.animating() {
        (guide.started.elapsed().as_millis() / 250) as usize % MOON.len()
    } else {
        0
    };
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(format!(" {} LUUNA ", MOON[phase]), theme.selected()),
            Span::styled(" INIT · guided project setup ", theme.chrome()),
            Span::styled(format!(" {connection} "), theme.mnemonic()),
        ]))
        .style(theme.chrome()),
        top,
    );
    let sidebar = if body.width >= 72 { 26 } else { 0 };
    let [rail, main] =
        Layout::horizontal([Constraint::Length(sidebar), Constraint::Min(20)]).areas(body);
    if sidebar > 0 {
        render_rail(frame, guide, rail, theme);
    }
    let title = guide
        .steps
        .get(guide.index)
        .map(|step| format!(" {} of {} · {step} ", guide.index + 1, guide.steps.len()))
        .unwrap_or_else(|| " Starting ".into());
    let block = Block::default()
        .title(Line::styled(
            if guide.ending.is_some() {
                " Setup complete ".into()
            } else {
                title
            },
            theme.title(),
        ))
        .borders(Borders::ALL)
        .border_type(BorderType::Double)
        .border_style(theme.focused())
        .style(theme.panel());
    let inner = block.inner(main);
    frame.render_widget(block, main);
    let width = inner.width.saturating_sub(1) as usize;
    let banner = vec![
        Line::from(vec![
            Span::styled(format!(" {} ", MOON[phase]), theme.tone("attention")),
            Span::styled("L U U N A", theme.title()),
            Span::styled("  ·  I N I T", theme.accent()),
        ]),
        Line::styled(
            " set up a project with the Luuna suite, one runtime action at a time",
            theme.base(),
        ),
    ];
    let blurb = if guide.ending.is_some() {
        Vec::new()
    } else {
        wrap(
            &[(
                format!(" {}", guide.blurb),
                ink(theme, Ink::Dim).add_modifier(Modifier::ITALIC),
            )],
            width,
            1,
        )
    };
    let interaction = if guide.ending.is_some() {
        ending_lines(guide, width, theme)
    } else {
        question_lines(guide, width, theme)
    };
    let interaction_height =
        (interaction.len() as u16 + u16::from(!interaction.is_empty())).min(inner.height / 2 + 2);
    let blurb_height = (blurb.len() as u16).min(3);
    let [banner_area, blurb_area, log_area, interaction_area] = Layout::vertical([
        Constraint::Length(if inner.height >= 16 { 3 } else { 0 }),
        Constraint::Length(blurb_height + u16::from(blurb_height > 0)),
        Constraint::Min(1),
        Constraint::Length(interaction_height),
    ])
    .areas(inner);
    frame.render_widget(Paragraph::new(banner).style(theme.panel()), banner_area);
    frame.render_widget(Paragraph::new(blurb).style(theme.panel()), blurb_area);
    let lines = log_lines(guide, width, theme);
    let visible = log_area.height as usize;
    guide.scroll = guide.scroll.min(lines.len().saturating_sub(visible));
    let start = lines.len().saturating_sub(visible + guide.scroll);
    let shown = lines
        .into_iter()
        .skip(start)
        .take(visible)
        .collect::<Vec<_>>();
    frame.render_widget(Paragraph::new(shown).style(theme.panel()), log_area);
    if !interaction.is_empty() {
        let [rule, rest] =
            Layout::vertical([Constraint::Length(1), Constraint::Min(0)]).areas(interaction_area);
        frame.render_widget(
            Paragraph::new(Line::styled("─".repeat(rule.width as usize), theme.base())),
            rule,
        );
        frame.render_widget(Paragraph::new(interaction).style(theme.panel()), rest);
    }
    let hint = if guide.ending.is_some() {
        " Enter workbench · PgUp/PgDn scroll · q quit"
    } else if guide.leaving {
        " Enter leave · Esc stay"
    } else {
        match &guide.question {
            Some(Question::Ask { .. }) => {
                " Type · Enter answer · Tab take default · PgUp/PgDn scroll · Esc leave"
            }
            Some(Question::Choose { .. }) => {
                " ↑↓ move · Enter choose · 1-9 pick · PgUp/PgDn scroll · Esc leave"
            }
            Some(Question::Checklist { .. }) => {
                " ↑↓ move · Space toggle · a all · Enter continue · Esc leave"
            }
            Some(Question::Edit { .. }) => " Waiting for your editor",
            None => " Working · PgUp/PgDn scroll · Esc leave · Ctrl+C quit",
        }
    };
    frame.render_widget(Paragraph::new(hint).style(theme.chrome()), footer);
    if guide.leaving {
        let width = 54.min(area.width.saturating_sub(4));
        let popup = Rect {
            x: area.x + (area.width - width) / 2,
            y: area.y + area.height / 2 - 3,
            width,
            height: 6.min(area.height),
        };
        frame.render_widget(Clear, popup);
        frame.render_widget(
            Paragraph::new(vec![
                Line::raw(""),
                Line::styled(
                    "  Leave the setup? Nothing is undone.",
                    ink(theme, Ink::Bold),
                ),
                Line::styled("  Enter leave · Esc stay", theme.base()),
            ])
            .block(
                Block::default()
                    .title(Line::styled(" Leave ", theme.title()))
                    .borders(Borders::ALL)
                    .border_type(BorderType::Double)
                    .border_style(theme.focused()),
            )
            .style(theme.panel()),
            popup,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_moon_waxes_with_progress() {
        let lit = |progress: f64| {
            moon(progress, 5, Theme { color: false })
                .iter()
                .flat_map(|line| line.spans.iter())
                .filter(|span| span.content == "█")
                .count()
        };
        assert_eq!(lit(0.0), 0);
        assert!(lit(0.5) > 0 && lit(0.5) < lit(1.0));
    }

    #[test]
    fn wrapped_rows_never_exceed_the_width() {
        let rows = wrap(&[("word ".repeat(40), Style::default())], 30, 4);
        assert!(rows.len() > 1);
        for row in rows {
            assert!(
                row.spans
                    .iter()
                    .map(|span| span.content.chars().count())
                    .sum::<usize>()
                    <= 30
            );
        }
    }
}
