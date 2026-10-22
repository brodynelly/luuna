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

On Windows, `bin\luuna.cmd` (and `bin/luuna` for Git Bash) run the same client through
`scripts/start-terminal.ps1`, which supplies `LUUNA_URL` and the token in memory: with the
checkout's `bin` folder on PATH, `luuna` opens the workbench and `luuna projects --json` runs one
command. `-DataDirectory <dir>` is accepted only by name; every other word goes to the client.

Exit codes: 0 done, 1 refused or failed (`<Action> refused: <reason> <next step>` on stderr), 2 usage.
Transport failures and 5xx responses are plain sentences; a server body is never shown.

`home` and `board` are projections of cataloged read actions (`PROJECTIONS` in `src/commands.mjs`), the same
the desktop's Home and Board panels render from `@luuna/api-client` projections; they carry no catalog entry.
`doctor` is the settings surface of ADR 0027 point 4: one cataloged read (`GET /api/v1/doctor`) that prints the
same table as `luuna-runtime doctor` for the running runtime. Credentials are configured in the runtime's
environment (`LUUNA_API_TOKEN`, `LUUNA_GITHUB_TOKEN`, the provider variables); the client only reports presence.

## Interactive workbench

`luuna-tui` alone opens the workbench on the terminal's alternate screen: menus generated from the
command table (every cataloged action is reachable), each item showing the action, the command name
and the catalog title. Keys: `↑`/`↓` (or `j`/`k`) move, `PgUp`/`PgDn`/`Home`/`End` jump, `Enter`
(or `→`/`l`) selects, `Esc` (or `←`/`h`/`Backspace`) goes back, `r` reloads the list from the
runtime, `q` or `Ctrl-C` quits from anywhere (also while an action runs; `Esc` then aborts the action
instead). An action's inputs are asked one per line (an empty line ends a list; `Ctrl-C` quits); its
result opens as a text screen that scrolls with `↑`/`↓`, `PgUp`/`PgDn`, `Home`/`End` and shows
`lines x–y of n`. The header shows the connection, `RUNTIME OUTAGE · …` while `/health` does not
answer, and every list reloads when it answers again.

Rendering is sized to the terminal (`src/text.mjs`): exactly `rows` rows are drawn, menu rows are
truncated to the width with `…`, text screens wrap at the last space that fits, long menus scroll
behind a viewport that keeps the cursor visible and names its position in the footer, and the help
footer shortens its wording down to `↑↓ Enter r Esc q` so it stays on the last row at 40 columns.
Raw mode, the cursor and the main screen are restored on exit.

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
`node scripts/tui-interactive-audit.mjs` (the interactive mode in real pseudo-terminals through
tmux: menus, keys, prompts, scrolling, the outage header, the tones and their plain-text degradation,
and 40/60/80-column and 12-row rendering), both against a built runtime and the synthetic Pi fixture
(`--runtime <binary> --out <dir>`; each writes `report.md` and `report.json` to `--out`).
