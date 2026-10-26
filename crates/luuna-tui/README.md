# Luuna terminal client (`luuna-tui`, `lu`, `luuna`)

One Rust executable for the Luuna runtime: the scriptable command line and the interactive
workbench. It exposes the same product actions as the desktop client through the shared
capability catalog (`schemas/capability-catalog.json`, ADR 0020) and explains every refusal with
the shared sentence `<Action> refused: <reason> <next step>`. The runtime alone authorizes
execution, approval, validation and publication. Since [ADR 0037](../../docs/decisions/0037-single-rust-terminal-client.md)
the client has no Node process: it was a Node command line plus a Node bridge behind the Rust
renderer, and is now this crate alone, with byte-identical commands, output and requests.

```sh
cargo build --locked -p luuna-tui                # target/debug/luuna-tui[.exe]; `npm run tui -- …` runs it too
export LUUNA_URL=http://127.0.0.1:4242          # loopback only; this is the default
export LUUNA_API_TOKEN=...                       # never echoed; prompted (hidden) on a terminal when unset
luuna-tui                                        # interactive workbench (on a terminal)
luuna-tui help                                   # the overview: commands grouped by workflow, the component CLIs, flags, environment
luuna-tui plan --help                            # one command's page: arguments, every flag, the runtime route, an example (also `help plan`)
luuna-tui help --all                             # the complete reference
luuna-tui init                                   # guided project setup (terminal only)
luuna-tui projects --json                        # one cataloged action for scripts; --json prints the runtime's record unchanged
luuna-tui approve 3f2a91c0 --acknowledge-hash <first 8+ hash digits>   # short ids and hash prefixes work (ADR 0042)
luuna-tui run latest                             # the newest run; ticket, plan, run and memory ids accept their short id
luuna-tui follow <run>                           # live events over SSE, resumed after an outage from the last sequence
luuna-tui home                                   # Home summary: projects, validation health, blockers (a projection, not an action)
luuna-tui board --project <id>                   # Kanban projection of the recorded run states; nothing is dragged
luuna-tui doctor                                 # Settings: environment and credential presence by name; values are never shown
luuna-tui catalog                                # the capability catalog, as embedded
```

On Windows, `bin\luuna.cmd` (and `bin/luuna` for Git Bash; the installed `lu.cmd` calls it) run
the client through `scripts/start-terminal.ps1`, which supplies `LUUNA_URL` and the token in memory
(ADR 0011) and names the client `lu` in its help (`LUUNA_CLI_NAME`). Every help form needs no
token and starts no runtime. `lu missions|atlas|beacon …` (and `lu help missions`) run the
component CLIs themselves. `-DataDirectory <dir>` is accepted only by name.

Exit codes: 0 done, 1 refused or failed, 2 usage. Transport failures and 5xx responses are plain
sentences; a server body is never shown.

## Layout

| Module | What it is |
| --- | --- |
| `cli.rs` | The command line: argument parsing, connection, hidden token entry, exit codes |
| `commands.rs` + `commands.json` | The command table (data, also read by `scripts/check-contracts.mjs`) and each command's behaviour |
| `client.rs` | Loopback URL check, bearer-token HTTP/1.1, refusal mapping, SSE follower with `Last-Event-ID` |
| `failures.rs` | The shared failure explanations and next steps |
| `builders.rs`, `projections.rs` | The registration and plan request builders; the Home and Board projections |
| `format.rs`, `help.rs`, `text.rs` | Human output with the six tones, the help, width-aware wrapping |
| `js.rs` | A JSON value with JavaScript semantics (key order, `undefined`, number printing, UTF-16 lengths) |
| `bridge.rs` | The workbench's in-process command service (the versioned protocol of `protocol.rs`) |
| `prime.rs`, `components.rs` | `lu init`'s flow and the component CLI runner |
| `app.rs`, `views/`, `ui.rs`, `guide.rs` | The workbench's state and screens, including the guide mode |

`js.rs` exists so output stays exactly what the original JavaScript client printed: objects keep
insertion order with integer-like keys first, missing fields are `undefined` and omitted from
JSON, numbers print like `Number.prototype.toString`, and string lengths count UTF-16 units.
serde_json's order-preserving feature is deliberately not enabled: it would change ordering for
the whole workspace, including the runtime's canonical hashing.

## `init`

`init` is a guide, not a catalog action. On a terminal it opens the workbench's full-screen guide
mode. Eight steps: runtime, project (an already registered checkout is continued; `--project <id>`
names one), discovery, manifest (review, add a required check, edit in `$EDITOR`, confirm),
baseline, suite (managed stores, an optional first Atlas memory), agents, and the first ticket.
Each runtime step runs a cataloged command, so it sends the same bodies as the commands and every
refusal is the runtime's, offered as retry, skip or leave. The agents step runs the component CLIs
in the checkout only as ticked (repo-local stores, CLAUDE.md/AGENTS.md sections previewed before
they are written, optional Claude Code hooks, each component's primed context); they run with
Bun's own executable, no shell, and never receive the runtime's URL or token.

## Workbench

Luuna opens on Home. `s` on Home or Projects (or "Set up a project" in the menu) starts the guide.
F3 Projects, F4 Missions, F6 Atlas, F7 Beacon, F8 Runs, F2 the complete command catalog, F1 Help;
F10 opens navigation, Tab changes focus, arrows select, Enter inspects, Esc returns, F5 refreshes.
Forms: Tab or Up/Down move fields, Left/Right pick from a field's choices (repositories, records,
scopes, yes/no), Ctrl-U clears, Alt-Enter adds a line, Ctrl-S submits. Approval shows the complete
plan and hash and takes a typed `approve` (or the hash's first 8 digits), never a prefilled answer;
a terminal too small to show the plan cannot approve. Lists show short ids, and every ticket, plan,
run and memory argument accepts one (ADR 0042). Esc stops local waiting; the `cancel` action requests runtime cancellation. Quitting
leaves the runtime running.

Frames are event-driven and capped at `LUUNA_TUI_FPS` (default 60, 30-144); an idle workbench does
not redraw. DEC 2026 synchronized output is on by default (`LUUNA_TUI_SYNC=0` turns it off); large
scroll jumps ease over about 120 ms (`LUUNA_TUI_ANIMATION=0` makes them instant). `NO_COLOR` and
`TERM=dumb` disable colour. The in-process service keeps the former bridge's limits: four reads and
one mutation at a time, health polled every two seconds, the token redacted from every event.

## Evidence

```sh
cargo test --locked -p luuna-tui
cargo clippy --locked -p luuna-tui --all-targets -- -D warnings
npm run test:contracts
```

`tests/cli.rs` runs the built client against a mock runtime: every catalog entry's command issues
its method and route, request bodies, refusal sentences, usage errors, the full-hash approval and
SSE resumption. `tests/guide_flow.rs` drives `init` with scripted answers, `tests/bridge_service.rs`
the workbench's service, and `tests/terminal_lifecycle.rs` and `tests/guide_pty.rs` run the binary
in a real PTY (ConPTY on Windows). The end-to-end harnesses are `node scripts/tui-smoke.mjs` and
`node scripts/tui-native-audit.mjs` against a disposable synthetic runtime. These are fixture and
local-host checks, not genuine-provider or other-platform evidence.
