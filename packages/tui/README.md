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
npm run tui -- create-ticket <project> --purpose testing_setup --title … --intent … --criterion …   # the testing-setup prerequisite (ADR 0022)
npm run tui -- plan <ticket> --check unit=python,-m,unittest@120                                  # a setup plan's recipes (or --checks file.json)
npm run tui -- plan <ticket> --task "shared=lib;role=repository_lead" --task "api=src>shared" --override api:shared:waive:"pinned"   # roles and overrides (ADR 0023)
```

Exit codes: 0 done, 1 refused or failed (`<Action> refused: <reason> <next step>` on stderr), 2 usage.
Transport failures and 5xx responses are plain sentences; a server body is never shown.

`home` and `board` are projections of cataloged read actions (`PROJECTIONS` in `src/commands.mjs`), the same
the desktop's Home and Board panels render from `@luuna/api-client` projections; they carry no catalog entry.

Adding an action: one catalog entry, one `LuunaClient` method, one object in `src/commands.mjs`
(with its `example`); `npm test` then checks the parity (`test/commands.test.mjs`). The end-to-end
evidence is `node scripts/tui-smoke.mjs` against a built runtime and the synthetic Pi fixture.
