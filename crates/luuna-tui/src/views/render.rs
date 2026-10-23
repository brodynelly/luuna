//! Terminal-cell adaptation of LUUNA-AI's blue desktop and framed workbench.
//! This module only displays bridge snapshots; it never decides runtime policy.
use super::{hints, rows, selected, snapshot, Screen, EVIDENCE, NAV};
use crate::{
    app::AppState,
    protocol::safe_text,
    theme::{state_tone, Theme},
};
use ratatui::{
    layout::{Constraint, Layout, Rect},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, List, ListItem, ListState, Paragraph, Wrap},
    Frame,
};
use serde_json::Value;
use unicode_width::UnicodeWidthChar;

pub fn render(frame: &mut Frame, app: &mut AppState, area: Rect, theme: Theme) {
    let content = if area.width >= 100 {
        let [navigation, content] =
            Layout::horizontal([Constraint::Percentage(26), Constraint::Percentage(74)])
                .areas(area);
        render_navigation(frame, app, navigation, theme);
        content
    } else if app.workbench.nav {
        render_navigation(frame, app, area, theme);
        return;
    } else {
        area
    };
    let content = if let Some(error) = &app.workbench.error {
        let [notice, rest] =
            Layout::vertical([Constraint::Length(2), Constraint::Min(1)]).areas(content);
        frame.render_widget(
            Paragraph::new(format!("! {}", safe_text(error)))
                .style(theme.tone("danger"))
                .wrap(Wrap { trim: false }),
            notice,
        );
        rest
    } else {
        content
    };
    let screen = app.workbench.screen;
    let title = match screen {
        Screen::Home => "Home / workspace health",
        Screen::Projects => "Projects / repositories",
        Screen::Project => "Project / recorded identity",
        Screen::Missions => "Missions / workflow board",
        Screen::Ticket => "Missions / ticket",
        Screen::Memory => "Atlas / scoped memory",
        Screen::MemoryDetail => "Atlas / record",
        Screen::Prompts => "Beacon / versioned prompts",
        Screen::PromptDetail => "Beacon / exact preview",
        Screen::Runs => "Runs / recorded workflows",
        Screen::RunDetail => "Run / evidence",
        Screen::Plan => "Plan / immutable snapshot",
        Screen::Commands => "Commands",
        Screen::Help => "Help / keyboard reference",
        Screen::Setup => "Setup",
    };
    let block = panel(title, !app.workbench.nav, theme);
    let inside = block.inner(content);
    frame.render_widget(block, content);
    if inside.height == 0 || inside.width == 0 {
        return;
    }
    let [body, keys] = Layout::vertical([Constraint::Min(1), Constraint::Length(1)]).areas(inside);
    frame.render_widget(Paragraph::new(hints(screen)).style(theme.accent()), keys);
    match screen {
        Screen::Missions => render_board(frame, app, body, theme),
        Screen::Home => render_home(frame, app, body, theme),
        Screen::Projects | Screen::Memory | Screen::Prompts | Screen::Runs => {
            render_collection(frame, app, body, theme)
        }
        Screen::RunDetail => render_run(frame, app, body, theme),
        Screen::Help => render_help(frame, app, body, theme),
        Screen::Commands => {
            paragraph(
                frame,
                vec![Line::raw("F2 opens all runtime commands.")],
                body,
                &mut app.scroll,
                theme,
            );
        }
        _ => {
            let record = selected(app);
            let mut lines = detail_lines(screen, &record, theme);
            if matches!(screen, Screen::Ticket | Screen::Plan) {
                append_context(&mut lines, app, theme);
            }
            if screen == Screen::MemoryDetail {
                lines.insert(
                    0,
                    field(
                        "Unsent context",
                        if app.workbench.memory_ids.contains(&text(&record, "id")) {
                            "selected / s removes"
                        } else {
                            "not selected / s selects"
                        },
                        theme,
                    ),
                );
            }
            if screen == Screen::PromptDetail {
                let identity = format!(
                    "{}@{}#{}",
                    text(&record, "name"),
                    text(&record, "version"),
                    text(&record, "hash")
                );
                lines.insert(
                    0,
                    field(
                        "Unsent context",
                        if app.workbench.prompt_selection.as_deref() == Some(identity.as_str()) {
                            "selected / s removes"
                        } else {
                            "not selected / s selects"
                        },
                        theme,
                    ),
                );
            }
            paragraph(frame, lines, body, &mut app.scroll, theme);
        }
    }
}

fn panel(title: &str, focus: bool, theme: Theme) -> Block<'static> {
    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Double)
        .border_style(if focus {
            theme.focused()
        } else {
            theme.muted()
        })
        .title(Line::styled(
            format!(" {}{} ", if focus { "> " } else { "" }, safe_text(title)),
            if focus { theme.title() } else { theme.muted() },
        ))
        .style(theme.panel())
}

fn render_navigation(frame: &mut Frame, app: &AppState, area: Rect, theme: Theme) {
    let block = panel("LUUNA", app.workbench.nav, theme);
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let context_height = if inner.height >= 18 { 7 } else { 0 };
    let [list_area, context_area] =
        Layout::vertical([Constraint::Min(1), Constraint::Length(context_height)]).areas(inner);
    let items = NAV
        .iter()
        .enumerate()
        .map(|(i, (label, screen))| {
            let active = *screen == app.workbench.screen
                || match screen {
                    Screen::Projects => app.workbench.screen == Screen::Project,
                    Screen::Missions => {
                        matches!(app.workbench.screen, Screen::Ticket | Screen::Plan)
                    }
                    Screen::Memory => app.workbench.screen == Screen::MemoryDetail,
                    Screen::Prompts => app.workbench.screen == Screen::PromptDetail,
                    Screen::Runs => app.workbench.screen == Screen::RunDetail,
                    _ => false,
                };
            ListItem::new(Line::from(vec![
                Span::styled(format!(" {} ", i + 1), theme.accent()),
                Span::styled(
                    format!("{label}{}", if active { " *" } else { "" }),
                    if active { theme.title() } else { theme.panel() },
                ),
            ]))
        })
        .collect::<Vec<_>>();
    let mut state = ListState::default().with_selected(if app.workbench.nav {
        Some(app.workbench.nav_cursor)
    } else {
        None
    });
    frame.render_stateful_widget(
        List::new(items)
            .highlight_style(theme.selected())
            .highlight_symbol(">"),
        list_area,
        &mut state,
    );
    if context_height > 0 {
        let mut lines = vec![
            heading("PROJECT", theme),
            Line::raw(safe_text(
                app.context
                    .get("project")
                    .map(String::as_str)
                    .unwrap_or("Choose a project"),
            )),
            Line::raw(""),
            heading("UNSENT PLAN CONTEXT", theme),
            Line::raw(format!(
                "{} memory selection(s)",
                app.workbench.memory_ids.len()
            )),
        ];
        lines.push(Line::raw(
            app.workbench
                .prompt_selection
                .as_deref()
                .map(safe_text)
                .unwrap_or_else(|| "No prompt selected".into()),
        ));
        lines.push(Line::styled("F10 menu / Tab focus", theme.muted()));
        frame.render_widget(
            Paragraph::new(lines).wrap(Wrap { trim: false }),
            context_area,
        );
    }
}

fn paragraph(
    frame: &mut Frame,
    lines: Vec<Line<'static>>,
    area: Rect,
    scroll: &mut crate::scroll::ScrollState,
    theme: Theme,
) {
    let lines = cell_lines(lines, area.width);
    let max_scroll = lines
        .len()
        .saturating_sub(usize::from(area.height))
        .min(usize::from(u16::MAX)) as u16;
    let scroll = scroll.clamp(max_scroll);
    frame.render_widget(
        Paragraph::new(lines)
            .style(theme.panel())
            .scroll((scroll, 0)),
        area,
    );
}

// Wrap styled spans into terminal rows: complete hashes stay readable and End
// has an exact bound, including wide Unicode and newline-delimited evidence.
fn cell_lines(lines: Vec<Line<'static>>, width: u16) -> Vec<Line<'static>> {
    let width = usize::from(width.max(1));
    let mut result = Vec::new();
    for line in lines {
        let mut row = Line::default().style(line.style);
        let mut used = 0;
        for span in line.spans {
            let mut part = String::new();
            for character in span.content.chars() {
                let cells = character.width().unwrap_or(0);
                if character == '\n' || used + cells > width {
                    row.spans
                        .push(Span::styled(std::mem::take(&mut part), span.style));
                    result.push(row);
                    row = Line::default().style(line.style);
                    used = 0;
                    if character == '\n' {
                        continue;
                    }
                }
                part.push(character);
                used += cells;
            }
            row.spans.push(Span::styled(part, span.style));
        }
        result.push(row);
    }
    result
}

fn append_context(lines: &mut Vec<Line<'static>>, app: &AppState, theme: Theme) {
    lines.push(Line::raw(""));
    lines.push(heading("UNSENT CONTEXT / NOT THE RECORDED PLAN", theme));
    if app.workbench.memory_ids.is_empty() {
        lines.push(Line::raw("No memory selected."));
    }
    for id in &app.workbench.memory_ids {
        lines.push(field("Memory", id, theme));
    }
    lines.push(field(
        "Exact prompt",
        app.workbench
            .prompt_selection
            .as_deref()
            .unwrap_or("none selected"),
        theme,
    ));
    lines.push(Line::styled(
        "s toggles a record / z clears unsent context",
        theme.muted(),
    ));
}

fn heading(text: &str, theme: Theme) -> Line<'static> {
    Line::styled(safe_text(text), theme.title())
}

fn field(label: &str, value: impl AsRef<str>, theme: Theme) -> Line<'static> {
    Line::from(vec![
        Span::styled(format!("{label}: "), theme.muted()),
        Span::raw(safe_text(value.as_ref())),
    ])
}

fn text(value: &Value, key: &str) -> String {
    match value.get(key) {
        Some(Value::String(value)) => safe_text(value),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn array<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn status(state: &str, theme: Theme) -> Line<'static> {
    let tone = state_tone(state);
    let mark = match tone {
        "success" => "+",
        "active" => ">",
        "danger" => "!",
        "attention" => "?",
        "interrupted" => "~",
        _ => "-",
    };
    Line::styled(format!("{mark} {}", safe_text(state)), theme.tone(tone))
}

fn empty(app: &AppState) -> Vec<Line<'static>> {
    vec![
        Line::raw(if app.active_request.is_some() {
            "Reading recorded runtime state..."
        } else {
            "No records in this view."
        }),
        Line::raw(""),
        Line::raw("F5 refreshes. F2 opens available commands."),
    ]
}

fn render_home(frame: &mut Frame, app: &mut AppState, area: Rect, theme: Theme) {
    let home = snapshot(app, "home");
    let projects = array(&home, "projects");
    if projects.is_empty() {
        paragraph(frame, empty(app), area, &mut app.scroll, theme);
        return;
    }
    let current = app.workbench.cursor.min(projects.len() - 1);
    let [selector, area] =
        Layout::vertical([Constraint::Length(2), Constraint::Min(1)]).areas(area);
    frame.render_widget(
        Paragraph::new(vec![
            Line::styled(
                format!(
                    "> {} [{}/{}]",
                    text(&projects[current], "name"),
                    current + 1,
                    projects.len()
                ),
                theme.selected(),
            ),
            Line::styled(
                "Up/Down project / Enter opens / PgUp/PgDn details",
                theme.muted(),
            ),
        ]),
        selector,
    );
    let mut lines = vec![
        heading("YOUR DEVELOPMENT WORKSPACE", theme),
        Line::raw("Repository health and work waiting for your attention."),
        Line::raw(""),
    ];
    for (index, project) in projects.iter().enumerate().skip(current).take(1) {
        lines.push(Line::styled(
            format!(
                "{} {}",
                if index == app.workbench.cursor {
                    ">"
                } else {
                    " "
                },
                text(project, "name")
            ),
            if index == app.workbench.cursor {
                theme.selected()
            } else {
                theme.title()
            },
        ));
        lines.push(field("Project", text(project, "id"), theme));
        lines.push(field("Manifest revision", text(project, "revision"), theme));
        lines.push(field(
            "Manifest hash",
            text(project, "manifest_hash"),
            theme,
        ));
        lines.push(field(
            "Work",
            format!(
                "{} tickets / {} active workflows",
                text(project, "tickets"),
                text(project, "active_workflows")
            ),
            theme,
        ));
        append_repositories(&mut lines, array(project, "repositories"), theme);
        lines.push(Line::raw(""));
    }
    lines.push(heading("NEEDS ATTENTION", theme));
    let blockers = array(&home, "blockers");
    if blockers.is_empty() {
        lines.push(Line::styled("No recorded blockers.", theme.muted()));
    }
    for blocker in blockers {
        lines.push(field("Project", text(blocker, "project_id"), theme));
        lines.push(heading(&text(blocker, "title"), theme));
        let state = text(blocker, "state");
        if !state.is_empty() {
            lines.push(status(&state, theme));
        }
        lines.push(Line::raw(text(blocker, "detail")));
        lines.push(Line::raw(""));
    }
    paragraph(frame, lines, area, &mut app.scroll, theme);
}

fn append_repositories(lines: &mut Vec<Line<'static>>, repositories: &[Value], theme: Theme) {
    for repository in repositories {
        lines.push(field(
            "Repository",
            text(repository, "repository_id"),
            theme,
        ));
        lines.push(field("Checkout", text(repository, "local_path"), theme));
        if let Some(baseline) = repository.get("baseline").filter(|v| !v.is_null()) {
            lines.push(status(&text(baseline, "status"), theme));
            for (key, label) in [
                ("run_id", "Baseline run"),
                ("manifest_revision", "Baseline manifest revision"),
                ("commit", "Commit"),
                ("reason", "Reason"),
            ] {
                if !text(baseline, key).is_empty() {
                    lines.push(field(label, text(baseline, key), theme));
                }
            }
        } else {
            lines.push(Line::styled(
                "Baseline: not recorded in this view",
                theme.muted(),
            ));
        }
        if let Some(prerequisite) = repository.get("prerequisite").filter(|v| !v.is_null()) {
            lines.push(field(
                "Testing prerequisite",
                text(prerequisite, "reason"),
                theme,
            ));
        }
    }
}

fn render_collection(frame: &mut Frame, app: &AppState, area: Rect, theme: Theme) {
    let records = rows(app);
    let screen = app.workbench.screen;
    let [search, body] = Layout::vertical([
        Constraint::Length(if matches!(screen, Screen::Memory | Screen::Prompts) {
            2
        } else {
            1
        }),
        Constraint::Min(1),
    ])
    .areas(area);
    let title = if screen == Screen::Memory {
        format!(
            "Search: {}{}\nUser memory: {} (explicit choice)",
            safe_text(&app.workbench.query),
            if app.workbench.searching { "_" } else { "" },
            if app.workbench.include_user {
                "included"
            } else {
                "excluded"
            }
        )
    } else if screen == Screen::Prompts {
        format!(
            "Search: {}{}\nVersioned source; preview before selection",
            safe_text(&app.workbench.query),
            if app.workbench.searching { "_" } else { "" }
        )
    } else {
        format!(
            "{} recorded {}",
            records.len(),
            if screen == Screen::Projects {
                "projects"
            } else {
                "runs"
            }
        )
    };
    frame.render_widget(Paragraph::new(title).style(theme.muted()), search);
    if records.is_empty() {
        paragraph(frame, empty(app), body, &mut Default::default(), theme);
        return;
    }
    let (list_area, preview_area) = if body.width >= 72 {
        let [left, right] =
            Layout::horizontal([Constraint::Percentage(40), Constraint::Percentage(60)])
                .areas(body);
        (left, Some(right))
    } else {
        (body, None)
    };
    let items = records
        .iter()
        .map(|record| {
            let mut lines = match screen {
                Screen::Projects => vec![
                    heading(
                        &text(record.get("project").unwrap_or(record), "name"),
                        theme,
                    ),
                    field(
                        "id",
                        text(record.get("project").unwrap_or(record), "id"),
                        theme,
                    ),
                ],
                Screen::Memory => vec![
                    heading(
                        &format!("[{}] {}", text(record, "scope"), text(record, "id")),
                        theme,
                    ),
                    Line::raw(
                        text(record, "content")
                            .lines()
                            .next()
                            .unwrap_or("")
                            .to_owned(),
                    ),
                ],
                Screen::Prompts => vec![
                    heading(&text(record, "name"), theme),
                    field("version", text(record, "version"), theme),
                ],
                _ => vec![
                    heading(&text(record, "id"), theme),
                    status(&text(record, "state"), theme),
                ],
            };
            lines.push(Line::raw(""));
            ListItem::new(lines)
        })
        .collect::<Vec<_>>();
    let mut state =
        ListState::default().with_selected(Some(app.workbench.cursor.min(records.len() - 1)));
    frame.render_stateful_widget(
        List::new(items)
            .highlight_style(theme.selected())
            .highlight_symbol("> "),
        list_area,
        &mut state,
    );
    if let Some(preview_area) = preview_area {
        let block = Block::default()
            .borders(Borders::LEFT)
            .border_type(BorderType::Double)
            .border_style(theme.muted());
        let inside = block.inner(preview_area);
        frame.render_widget(block, preview_area);
        let record = &records[app.workbench.cursor.min(records.len() - 1)];
        paragraph(
            frame,
            detail_lines(screen, record, theme),
            inside,
            &mut Default::default(),
            theme,
        );
    }
}

fn render_board(frame: &mut Frame, app: &AppState, area: Rect, theme: Theme) {
    let board = snapshot(app, "board");
    let columns = array(&board, "columns");
    if columns.is_empty() {
        paragraph(frame, empty(app), area, &mut Default::default(), theme);
        return;
    }
    let visible = usize::from(area.width / 27).clamp(1, 3).min(columns.len());
    let selected_column = app.workbench.column.min(columns.len() - 1);
    let start = (selected_column / visible) * visible;
    let end = (start + visible).min(columns.len());
    let [info, cards] = Layout::vertical([Constraint::Length(2), Constraint::Min(1)]).areas(area);
    frame.render_widget(Paragraph::new(format!("Read-only runtime projection / columns {}-{} of {}\nLeft/Right changes column; Enter inspects the card", start + 1, end, columns.len())).style(theme.muted()), info);
    let constraints = vec![Constraint::Ratio(1, (end - start) as u32); end - start];
    let areas = Layout::horizontal(constraints).split(cards);
    for (offset, column) in columns[start..end].iter().enumerate() {
        let records = array(column, "cards");
        let index = start + offset;
        let focused = index == selected_column;
        let name = text(&column["column"], "title");
        let block = panel(&format!("{name} ({})", records.len()), focused, theme);
        let inner = block.inner(areas[offset]);
        frame.render_widget(block, areas[offset]);
        if records.is_empty() {
            frame.render_widget(Paragraph::new("\n No cards").style(theme.muted()), inner);
            continue;
        }
        let items = records
            .iter()
            .map(|card| {
                let mut lines = vec![heading(&text(card, "title"), theme)];
                if text(card, "kind") == "prerequisite" {
                    lines.push(field("Repository", text(card, "repository_id"), theme));
                    lines.push(Line::raw(text(card, "reason")));
                } else {
                    lines.push(field("Ticket", text(card, "ticket_id"), theme));
                    lines.push(field("Revision", text(card, "ticket_revision"), theme));
                    let state = text(card, "state");
                    if !state.is_empty() {
                        lines.push(status(&state, theme));
                    }
                    if !text(card, "run_id").is_empty() {
                        lines.push(field("Run", text(card, "run_id"), theme));
                    }
                }
                lines.push(Line::styled("------------------------", theme.muted()));
                ListItem::new(lines)
            })
            .collect::<Vec<_>>();
        let mut state = ListState::default().with_selected(if focused {
            Some(app.workbench.cursor.min(records.len() - 1))
        } else {
            None
        });
        frame.render_stateful_widget(
            List::new(items)
                .highlight_style(theme.selected())
                .highlight_symbol(">"),
            inner,
            &mut state,
        );
    }
}

fn detail_lines(screen: Screen, record: &Value, theme: Theme) -> Vec<Line<'static>> {
    if record.is_null() {
        return vec![Line::raw("No recorded detail yet. F5 refreshes this view.")];
    }
    let mut lines = Vec::new();
    match screen {
        Screen::Projects | Screen::Project => {
            let project = record.get("project").unwrap_or(record);
            lines.push(heading(&text(project, "name"), theme));
            append_fields(
                &mut lines,
                project,
                &[("id", "Project"), ("revision", "Manifest revision")],
                theme,
            );
            if let Some(manifest) = record.get("manifest").filter(|v| !v.is_null()) {
                append_fields(&mut lines, manifest, &[("hash", "Manifest hash")], theme);
            }
            lines.push(Line::raw(""));
            lines.push(heading("REPOSITORIES", theme));
            append_repositories(&mut lines, array(record, "repositories"), theme);
            if !array(record, "prerequisites").is_empty() {
                lines.push(heading("TESTING PREREQUISITES", theme));
                for prerequisite in array(record, "prerequisites") {
                    append_fields(
                        &mut lines,
                        prerequisite,
                        &[("repository_id", "Repository"), ("reason", "Reason")],
                        theme,
                    );
                }
            }
        }
        Screen::Ticket => {
            lines.push(heading(&text(record, "title"), theme));
            append_fields(
                &mut lines,
                record,
                &[
                    ("id", "Ticket"),
                    ("revision", "Expected revision"),
                    ("purpose", "Purpose"),
                    ("project_id", "Project"),
                ],
                theme,
            );
            lines.push(Line::raw(""));
            lines.push(heading("INTENT", theme));
            lines.push(Line::raw(text(record, "intent")));
            lines.push(Line::raw(""));
            lines.push(heading("ACCEPTANCE CRITERIA", theme));
            for criterion in array(record, "acceptance_criteria") {
                lines.push(Line::raw(format!(
                    "[ ] {}",
                    safe_text(criterion.as_str().unwrap_or(""))
                )));
            }
            lines.push(heading("REPOSITORIES", theme));
            structured(&record["repository_ids"], &mut lines, 0, theme);
            for key in ["source", "usage"] {
                if let Some(value) = record.get(key) {
                    lines.push(heading(&key.to_uppercase(), theme));
                    structured(value, &mut lines, 0, theme);
                }
            }
        }
        Screen::Memory | Screen::MemoryDetail => {
            lines.push(heading(&text(record, "id"), theme));
            append_fields(
                &mut lines,
                record,
                &[
                    ("scope", "Scope"),
                    ("provenance", "Provenance"),
                    ("hash", "Exact hash"),
                    ("created_at", "Recorded"),
                ],
                theme,
            );
            lines.push(Line::raw(""));
            lines.push(heading("CONTENT", theme));
            for line in text(record, "content").lines() {
                lines.push(Line::raw(line.to_owned()));
            }
            lines.push(Line::raw(""));
            lines.push(Line::styled(
                "Context selection is unsent until you submit a plan.",
                theme.muted(),
            ));
        }
        Screen::Prompts | Screen::PromptDetail => {
            lines.push(heading(&text(record, "name"), theme));
            append_fields(
                &mut lines,
                record,
                &[
                    ("version", "Version"),
                    ("hash", "Exact hash"),
                    ("provenance", "Provenance"),
                ],
                theme,
            );
            lines.push(Line::raw(""));
            if record.get("body").is_some() {
                lines.push(heading("RENDERED BODY", theme));
                for line in text(record, "body").lines() {
                    lines.push(Line::raw(line.to_owned()));
                }
            } else {
                lines.push(Line::styled(
                    "Enter previews this exact version.",
                    theme.muted(),
                ));
            }
        }
        Screen::Runs | Screen::RunDetail => {
            lines.push(heading(&text(record, "id"), theme));
            lines.push(status(&text(record, "state"), theme));
            append_fields(
                &mut lines,
                record,
                &[
                    ("project_id", "Project"),
                    ("revision", "Revision"),
                    ("created_at", "Created"),
                    ("updated_at", "Updated"),
                ],
                theme,
            );
            if let Some(metadata) = record.get("metadata") {
                lines.push(heading("RECORDED CONTEXT", theme));
                structured(metadata, &mut lines, 0, theme);
            }
            lines.push(Line::raw(""));
            lines.push(Line::styled(
                "completed is a settled run, not passed validation.",
                theme.muted(),
            ));
        }
        Screen::Plan => {
            lines.push(heading("IMMUTABLE PLAN / REVIEW BEFORE APPROVAL", theme));
            append_fields(
                &mut lines,
                record,
                &[
                    ("id", "Plan"),
                    ("revision", "Revision"),
                    ("hash", "Complete plan hash"),
                    ("project_id", "Project"),
                    ("ticket_id", "Ticket"),
                    ("ticket_revision", "Ticket revision"),
                    ("manifest_hash", "Manifest hash"),
                ],
                theme,
            );
            lines.push(Line::raw(""));
            // Preserve every plan field, including future extensions, as readable
            // labelled evidence. Never shorten hashes or hide approved scope.
            for (key, value) in record.as_object().into_iter().flatten() {
                if [
                    "id",
                    "revision",
                    "hash",
                    "project_id",
                    "ticket_id",
                    "ticket_revision",
                    "manifest_hash",
                ]
                .contains(&key.as_str())
                {
                    continue;
                }
                lines.push(heading(&key.replace('_', " ").to_uppercase(), theme));
                structured(value, &mut lines, 0, theme);
                lines.push(Line::raw(""));
            }
            lines.push(Line::styled(
                "Approval requires typing the complete hash into a blank prompt.",
                theme.tone("attention"),
            ));
            lines.push(Line::raw("Implementation is a separate explicit action."));
        }
        _ => structured(record, &mut lines, 0, theme),
    }
    lines
}

fn append_fields(
    lines: &mut Vec<Line<'static>>,
    value: &Value,
    fields: &[(&str, &str)],
    theme: Theme,
) {
    for (key, label) in fields {
        let value = text(value, key);
        if !value.is_empty() {
            lines.push(field(label, value, theme));
        }
    }
}

/// Structured evidence preserves exact values without a JSON punctuation wall.
fn structured(value: &Value, lines: &mut Vec<Line<'static>>, depth: usize, theme: Theme) {
    let indent = "  ".repeat(depth.min(8));
    match value {
        Value::Object(values) => {
            for (key, value) in values {
                let label = format!("{indent}{}", safe_text(key).replace('_', " "));
                if value.is_array() || value.is_object() {
                    lines.push(Line::styled(format!("{label}:"), theme.accent()));
                    structured(value, lines, depth + 1, theme);
                } else {
                    let display = scalar(value);
                    if ["state", "status", "verdict", "severity"].contains(&key.as_str()) {
                        lines.push(Line::from(vec![
                            Span::styled(format!("{label}: "), theme.muted()),
                            Span::styled(display.clone(), theme.tone(state_tone(&display))),
                        ]));
                    } else {
                        lines.push(field(&label, display, theme));
                    }
                }
            }
        }
        Value::Array(values) => {
            if values.is_empty() {
                lines.push(Line::styled(
                    format!("{indent}(none recorded)"),
                    theme.muted(),
                ));
            }
            for (index, value) in values.iter().enumerate() {
                if value.is_object() || value.is_array() {
                    lines.push(Line::styled(
                        format!("{indent}[{}]", index + 1),
                        theme.muted(),
                    ));
                    structured(value, lines, depth + 1, theme);
                } else {
                    lines.push(Line::raw(format!("{indent}- {}", scalar(value))));
                }
            }
        }
        _ => lines.push(Line::raw(format!("{indent}{}", scalar(value)))),
    }
}

fn scalar(value: &Value) -> String {
    match value {
        Value::String(s) => safe_text(s),
        Value::Null => "not recorded".into(),
        _ => value.to_string(),
    }
}

fn render_run(frame: &mut Frame, app: &mut AppState, area: Rect, theme: Theme) {
    let [tabs, body] = Layout::vertical([Constraint::Length(2), Constraint::Min(1)]).areas(area);
    let index = app.workbench.evidence.min(EVIDENCE.len().saturating_sub(1));
    let (command, label) = EVIDENCE[index];
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                format!(" < {} / {}: {label} > ", index + 1, EVIDENCE.len()),
                theme.selected(),
            ),
            Span::styled(" Left/Right evidence", theme.muted()),
        ])),
        tabs,
    );
    let record = if index == 0 {
        selected(app)
    } else {
        snapshot(app, command)
    };
    let mut lines = if index == 0 {
        detail_lines(Screen::RunDetail, &record, theme)
    } else {
        vec![heading(&label.to_uppercase(), theme)]
    };
    if index != 0 {
        if record.is_null() {
            lines.push(Line::raw(
                "No evidence loaded. F5 refreshes the selected tab.",
            ));
        } else {
            structured(&record, &mut lines, 0, theme);
        }
    }
    if command == "events" && !app.events.is_empty() {
        lines.push(heading("LIVE EVENT STREAM", theme));
        for event in &app.events {
            structured(event, &mut lines, 0, theme);
        }
    }
    paragraph(frame, lines, body, &mut app.scroll, theme);
}

fn render_help(frame: &mut Frame, app: &mut AppState, area: Rect, theme: Theme) {
    let mut lines = vec![
        heading("LUUNA / TERMINAL WORKBENCH", theme),
        Line::raw("A local runtime workbench, operated with the keyboard."),
        Line::raw(""),
    ];
    for (title, body) in [
        ("NAVIGATE", "F10 opens the menu. Tab changes focus. Arrow keys select; Enter opens. Escape returns. F1 opens Help; F2 opens every command; F5 refreshes. PageUp/PageDown scroll details. Ctrl+C quits the client."),
        ("MISSIONS", "Left/Right pages all eight runtime workflow columns. Cards open tickets or testing prerequisites. This is a read-only projection: a card never moves a workflow or bypasses approval."),
        ("ATLAS AND BEACON", "Browse scoped memory and versioned prompts. User memory requires explicit inclusion. Select context deliberately; it stays unsent until a plan is submitted. Project changes clear these choices."),
        ("FORMS", "Tab and Shift+Tab move fields. Alt+Enter inserts a line. Ctrl+S submits. Escape cancels. Letters, including q, are text while editing. Shared commands retain their confirmations and stale-version guards."),
        ("PLANS AND EVIDENCE", "Read the complete plan and hash. Approval starts with a blank acknowledgment; the complete hash must match. Implementation remains separate. Run evidence tabs retain exact runtime state and reasons."),
        ("SERVICE LIFETIME", "Leaving a view or closing this client never cancels the underlying run. Cancel and shutdown are explicitly named commands. Interrupted work is distinct from failed checks; completed alone is not passed evidence."),
    ] { lines.push(heading(title, theme)); lines.push(Line::raw(body)); lines.push(Line::raw("")); }
    lines.push(heading("STATE LEGEND / WORDS REMAIN AUTHORITATIVE", theme));
    for state in [
        "passed",
        "running",
        "failed",
        "plan_ready",
        "completed",
        "interrupted",
    ] {
        lines.push(status(state, theme));
    }
    lines.push(Line::raw(
        "z clears unsent plan context. s toggles the inspected record.",
    ));
    paragraph(frame, lines, area, &mut app.scroll, theme);
}
