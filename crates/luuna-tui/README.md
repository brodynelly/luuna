# Rust terminal foundation

This crate owns the actual terminal, keyboard, forms and child lifecycle. The owned
Node process in `packages/tui/src/bridge.mjs` reuses the existing command table and
typed HTTP/SSE client. Node remains a distribution prerequisite. The runtime alone
authorizes execution, approval, validation and publication.

Development invocation from the repository:

```sh
cargo run --locked -p luuna-tui
cargo run --locked -p luuna-tui -- --help
```

Large scroll jumps (PgUp/PgDn, Home/End, following streamed output) ease over about
120 ms in whole rows; settled frames are identical. `LUUNA_TUI_ANIMATION=0` (or
`off`/`false`/`no`) makes every scroll move instant.

Connection uses `LUUNA_URL` and `LUUNA_API_TOKEN`. Missing tokens are entered hidden
inside the Rust terminal and passed to the child environment, never arguments.
`--bridge <absolute path>` and `--node <executable>` support deployed launchers;
the default bridge path is compile-time checkout-relative, not relative to the
user's project. The launcher/distribution wave supplies deployed paths. Named
script commands remain in the existing Node CLI.

Ratatui **0.29.0** (declared MSRV 1.74) and matching Crossterm **0.28.1**
(declared MSRV 1.63) are exact-pinned and compile with the repository's Rust 1.90.
Version metadata was verified using `cargo info` and the registry manifests.
See [Ratatui installation](https://ratatui.rs/installation/) and
[Crossterm terminal API](https://docs.rs/crossterm/0.28.1/crossterm/terminal/).

## Rendering

Frames are event-driven and capped at `LUUNA_TUI_FPS` (default 60, clamped to
30-144); an idle workbench performs zero redraws. Terminal input, bridge events and
the frame deadline wake the loop, pending work is drained, and at most one frame is
drawn per interval. DEC 2026 synchronized output wraps each frame and is on by
default; `LUUNA_TUI_SYNC=0` turns it off. Terminals without support ignore it. A
dedicated input thread (`input.rs`) is the only crossterm event reader and is joined
before the terminal is restored. Shutdown markers and signals are checked every
100 ms, so marker latency is at most 100 ms.

## Shared interface

`app::AppState` is the UI state/reducer; `ui::render` draws it. Later views queue
commands through `begin`, `invoke` and `refresh`; they do not implement transport.
`protocol::{CommandDef, ClientCommand, BridgeEvent}` is the JSONL interface.
`bridge::Bridge` owns one Node child and bounded IO tasks. `terminal::TerminalGuard`
restores raw mode, cursor and alternate screen. `theme::Theme` supplies presentation
tokens and six outcome tones. `NO_COLOR` and `TERM=dumb` disable palette styling.

Every request is `{v:1,id,op,...}`, every response `{v:1,id,event,...}`. Operations:
`catalog`, `read`, `invoke`, `reply`, `abort`, `shutdown`. Catalog metadata exposes
all arguments/flags and the read-only classification. Reads/invocations carry
`name,args,flags`; invoke optionally carries `stdin_document`. Document input is
never read from the JSONL pipe. Reply carries `request_id,prompt_id,value` (boolean
for confirmation, string otherwise). Events are `catalog`, `result`, `error`,
`output`, `prompt`, `event`, `connection`. Results keep raw `value` and plain
`formatted` separate. Errors name `outcome` including uncertain mutation outcomes.
Control acknowledgments have their own correlation IDs. Only matching active
requests can change an action or answer a prompt.

Limits: 1 MiB frame, 32 queued frames, four reads and one mutation in the bridge,
64 KiB output chunks, 256 KiB displayed text, 200 live events. Oversized results
are explicit; dropped display history is visibly marked and durable replay remains
available. Health polling is bounded at two seconds; SSE uses the shared resumable
client. Redirect/URL guards and exact-plan acknowledgment remain shared behavior.
Malformed/oversized peer data closes the owned transport and disables further
actions; restart the terminal to reconnect. No mutation is automatically replayed.

## Interaction and checks

F2 opens all actions; Tab filters context; Enter opens a form. Forms expose every
argument/option: Tab/Up/Down select, Alt+Enter adds a line, Ctrl+S submits. Repeated
flags use one value per line. Document prompts use Enter for lines and Ctrl+S to
submit. Hash prompts accept fresh typed full hashes only; arrows and paging scroll
the plan, and a terminal too small to show it cannot approve. Esc aborts local
waiting; the separate `cancel` action requests runtime cancellation. Quit leaves
the independent runtime running.

```sh
cargo test --locked -p luuna-tui
cargo clippy --locked -p luuna-tui --all-targets -- -D warnings
npm run test --workspace @luuna/tui
npm run test:contracts
```

`LUUNA_TEST_NODE` optionally selects the exact Node executable for Rust integration
tests. `bridge_process` launches the actual Node bridge against a synthetic HTTP
server, checks fresh hash acknowledgment and process cleanup. `terminal_lifecycle`
uses portable-pty (ConPTY on Windows) for actual key/resize/exit checks. These are
fixture/local-host checks, not genuine-provider or other-platform evidence.
