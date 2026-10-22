# @luuna/tui

The terminal client for the Luuna runtime. It exposes the same product actions as the desktop
client through the shared capability catalog (`schemas/capability-catalog.json`, ADR 0020) and
explains every refusal with the same shared text (`packages/api-client/src/failures.ts`).

```sh
export LUUNA_URL=http://127.0.0.1:4242          # loopback only; this is the default
export LUUNA_API_TOKEN=...                       # never echoed; prompted (hidden) on a terminal when unset
npm run tui                                      # interactive workbench: arrows/j/k move, Enter selects, Esc back, r reload, q quit
npm run tui -- help                              # every command with its usage
npm run tui -- projects --json                   # one cataloged action for scripts; --json prints the runtime's record unchanged
npm run tui -- approve <plan> --acknowledge-hash sha256:<complete plan hash>
npm run tui -- follow <run>                      # live events over SSE, resumed after an outage from the last sequence
npm run tui -- home                              # Home summary: projects, validation health, blockers (a projection, not an action)
npm run tui -- board --project <id>              # Kanban projection of the recorded run states; nothing is dragged
npm run tui -- doctor                            # Settings: the runtime's environment and credential presence by name (the doctor table); values are never shown
npm run tui -- create-ticket <project> --purpose testing_setup --title … --intent … --criterion …   # the testing-setup prerequisite (ADR 0022)
npm run tui -- plan <ticket> --check unit=python,-m,unittest@120                                  # a setup plan's recipes (or --checks file.json)
npm run tui -- plan <ticket> --task "shared=lib;role=repository_lead" --task "api=src>shared" --override api:shared:waive:"pinned"   # roles and overrides (ADR 0023)
```

Exit codes: 0 done, 1 refused or failed (`<Action> refused: <reason> <next step>` on stderr), 2 usage.
Transport failures and 5xx responses are plain sentences; a server body is never shown.

`home` and `board` are projections of cataloged read actions (`PROJECTIONS` in `src/commands.mjs`), the same
the desktop's Home and Board panels render from `@luuna/api-client` projections; they carry no catalog entry.
`doctor` is the settings surface of ADR 0027 point 4: one cataloged read (`GET /api/v1/doctor`) that prints the
same table as `luuna-runtime doctor` for the running runtime. Credentials are configured in the runtime's
environment (`LUUNA_API_TOKEN`, `LUUNA_GITHUB_TOKEN`, the provider variables); the client only reports presence.

## Interactive workbench

The production interactive renderer is the Rust application (`crates/luuna-tui`),
built with `npm run build:tui` at the repository root. The Node entry passes an
absolute local JSONL bridge path and the current Node executable; all commands
continue using the shared client. No JavaScript-renderer fallback is used.
Development launches select `target/debug/luuna-tui[.exe]` (or the explicit
`CARGO_TARGET_DIR`); installed launches select the binary in the installed root.
Node 24.19.0 and Rust 1.90.0 are the tested repository toolchain pins.

Luuna opens on Home. F3 selects Projects, F4 Missions, F6 Atlas, F7 Beacon,
F8 Runs, F2 the complete command catalog, and F1 Help. F10 opens navigation;
Tab changes focus. Arrows select records; Enter inspects them; Esc returns.
F5 refreshes reads. At narrow widths the navigation becomes a separate panel.

Missions shows the eight recorded workflow columns. Atlas exposes scoped memory
and exact-hash correction, promotion and deletion. Beacon previews exact prompt
versions and edits multiline bodies. Runs separates run, candidate, diff, tasks,
worktrees, attempts, events and publication evidence. Select memory or a prompt
with s to include it in an unsent plan; user memory requires an explicit u choice.
Creating a plan and approving its full immutable hash remain separate actions.

Forms use Tab or Up/Down to move fields, Ctrl-U to clear, Alt-Enter for a newline,
and Ctrl-S to submit. Printable q is text inside forms. Esc cancels an unsent form.
The terminal restores raw mode, cursor and main screen on exit. A disconnected
runtime is visible and reconnect refreshes the current view.

## Tones

States are printed as the runtime's unchanged words. On a terminal they are painted in the six
tones of the design system (`src/format.mjs`, the same tables as `apps/desktop/src/design/tone.ts`):
success green (passed evidence, `reviewed`, a live connection), active cyan (the runtime working),
danger red (`failed`, `blocked`, `testing_blocked`), attention yellow (`plan_ready`, `approved`,
`paused`, `unconfirmed`, `warning`), neutral dim (`queued`, `completed`, `cancelled`, `pending`) and
interrupted magenta (`interrupted`, `abandoned`, the outage header). Colour is used only when stdout
is a terminal, `NO_COLOR` is unset or empty and `TERM` is not `dumb`; otherwise, and always with
`--json`, the output is plain text.

## Evidence

Adding an action: one catalog entry, one `LuunaClient` method, one object in `src/commands.mjs`
(with its `example`); `npm test` then checks the parity (`test/commands.test.mjs`) and the rendering
helpers and tone tables (`test/text.test.mjs`, `test/format.test.mjs`). The end-to-end evidence is
`node scripts/tui-smoke.mjs` (the command mode through the documented walkthrough) and
`node scripts/tui-interactive-audit.mjs` (native terminal UI against a disposable
synthetic runtime). Pass `--runtime <binary> --components-root <checkout> --out <new-directory>`.
The Windows harness uses real ConPTY input, resize, terminal cells and SGR colors;
HTML captures reconstruct those cells and are not operating-system screenshots.
Reports distinguish passed, failed and not-run requirements. No provider is called.
`npm run test:tui-terminal` verifies the driver, screen parser and console restoration.
