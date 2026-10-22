# Feature: Ship and verify the Rust terminal entry point

## Metadata

- Type: feature
- Source: user request; actual Rust terminal TUI using sibling `luuna-ai` appearance and component layout confirmed on 2026-10-22
- Date: 2026-10-22
- Wave: 3; depends on integrated Rust/JSONL bridge foundation and completed component views

## Feature Description

Make Luuna's existing terminal entry points launch the new native Rust workbench by default. Preserve the scriptable command interface and Windows runtime bootstrap, stage the native executable with its bridge dependencies, and produce real terminal evidence of the new experience on Windows. The result must be the application users actually open, including its component navigation, forms and runtime reconnection.

## User Story

As a Luuna CLI user, I want the Rust workbench inspired by `luuna-ai` to open through my normal Luuna terminal commands so I can use the full product without choosing another executable or losing scripted workflows.

## Solution Statement

Keep Node as the established command-mode client and local versioned JSONL bridge to `@luuna/api-client`; use `crates/luuna-tui` for interactive rendering and input. Route no-command terminal launches to the native binary with inherited terminal handles and privately inherited connection configuration. Resolve artifacts from the checkout or installed layout explicitly, exercise the actual public entry under ConPTY, and record implementation-specific terminal evidence separately from provider or clean-machine release evidence.

## Out of Scope

- Changing the runtime's authorization, service lifetime, component internals, API semantics, desktop design, real provider configuration, or sibling `luuna-ai` source.
- Publishing, installer signing, installation into the user's existing deployment, cloud account actions, or claiming clean-machine/macOS compatibility without execution.
- Rewriting earlier-wave Rust views or bridge contracts except a documented integration fix agreed with the orchestrator.
- Editing, snapshotting, committing or resetting unrelated component/user changes in the original checkout.

## Relevant Files

- `AGENTS.md`, `AI-START-HERE.md`, `docs/CURRENT-ARCHITECTURE.md`, `docs/decisions/0011-windows-native-bootstrap.md`, `0020-capability-catalog-and-tui.md`, `0024-portable-component-distribution.md`, `0026-ticket-and-memory-controls-and-client-parity.md`, `0027-v1-advertised-scope.md` — read governing boundaries.
- `packages/tui/bin/luuna-tui.mjs`, `packages/tui/src/cli.mjs` (`main`, `connect`) — public dispatch, credentials, command behavior and exit codes.
- `packages/tui/src/native.mjs` (new if foundation has no launcher module) — deterministic native resolution/spawn/lifecycle.
- `crates/luuna-tui/`, `packages/tui/src/bridge.mjs` (earlier waves) — integrated native application and bridge, consume their actual documented startup contract.
- `packages/tui/test/cli.test.mjs`, `packages/tui/test/native.test.mjs` (new) — dispatch, artifact resolution, failures, lifecycle and command regression coverage.
- `package.json`, `packages/tui/package.json`, lockfiles only if needed — supported scripts and pinned tooling.
- `scripts/start-terminal.ps1`, `scripts/package-windows.ps1` — secure Windows startup, build/staging/verification/reporting.
- `scripts/tui-interactive-audit.mjs`, `scripts/tui-smoke.mjs` — existing real-terminal audit and command/runtime fixture walkthrough.
- `scripts/tui-conpty-audit.ps1` (new), optional narrowly scoped helper/test files under `scripts/` — native Windows ConPTY adapter, input, resize, bounded capture and lifecycle observations; choose a pinned dependency or repository-owned OS API helper rather than unversioned global tooling.
- `README.md`, `packages/tui/README.md`, `docs/PACKAGING.md`, `docs/CURRENT-ARCHITECTURE.md`, `.github/workflows/ci.yml` — actual entry/build requirements, controls, boundaries and checks.
- `docs/decisions/<next-free-number>-rust-terminal-workbench.md` (new; resolve next free number at implementation time) — replacement of interactive renderer, Rust/Node boundary, deterministic distribution and evidence limits.

## Implementation Plan

### Foundation

Record current HEAD and `git status --short` at implementation start; the shared source checkout is changing. Work from the orchestrator's latest verified isolated integration HEAD after waves 1 and 2. Do not pin a stale SHA, absorb unrelated dirty files or create a second copy of the bridge contract. Read the integrated launch contract before choosing artifact/bridge locations.

### Core

Interactive no-command dispatch launches the Rust executable, never silently falls back to `interactive.mjs`. Pass the foundation's `--bridge <absolute bridge.mjs path>` and `--node <Node executable path>` options explicitly, using the launcher's `process.execPath`; connection configuration uses inherited environment only. Resolve by the package/module location rather than caller cwd or arbitrary PATH: installed root `luuna-tui.exe` on Windows; documented checkout `target/debug/luuna-tui[.exe]` after `cargo build --locked -p luuna-tui` (an explicit supported release selection may be added, but no newest-file heuristics). A development artifact must never override the installed artifact. Missing/incompatible native binaries produce actionable deterministic build/reinstall instructions and nonzero status. Script commands and help must work without the Rust binary.

### Integration

The Rust application owns raw mode, cursor and alternate-screen restoration; the entry point owns bounded child completion/error propagation, and bridge lifetime is tied to its native owner. Runtime lifetime remains independent: normal quit never shuts down the service. Keep startup tokens out of argv, diagnostics, fixture captures and reports; Windows helper results remain memory-only and existing process environment is restored in `finally`. Package the native binary, bridge, catalog and compiled API client together and include the terminal executable path/hash in the package report.

## Step by Step Tasks

1. Inspect the recorded source status, integrated native/bridge interfaces, current manifests/CI, and accepted ADRs. Establish an initial validation baseline and record unrelated component drift separately; do not modify gitlinks/pins to make checks pass.
2. Implement/test the minimal native launcher and wire `main`/the executable shim consistently. No-command with no TTY remains help plus exit 2; `help`/`--help`/`-h` and `catalog` remain credential-free. Named commands still use shared `runCommand`; preserve exact JSON, usage/refusal exit codes (0/1/2), prompts, `AbortSignal`, and all existing commands/projections. Avoid launching Node recursively or creating two terminal input readers.
3. Verify missing-token terminal prompting against the integrated bridge contract: hidden input remains hidden, invalid loopback URLs remain refused, cancellation restores terminal state, and failures do not expose token values. A piped command's output and diagnostics stay unpainted where previously required.
4. Update `start-terminal.ps1` to reach the same native default while preserving fixed startup-helper use, saved environment restoration and child exit status. Do not bypass DPAPI/startup identity checks or invoke another runtime reconnect sequence against live user state.
5. Extend `package-windows.ps1` to build `luuna-tui` with Rust 1.90.0 and `--locked` in the selected debug/release profile, stage `luuna-tui.exe` beside `luuna-runtime.exe`, retain bridge/API/catalog files and Node prerequisite, verify copied files and hashes, and fail if native staging is missing. Validate resolved absolute stage containment before existing recursive replacement. Smoke help alone is insufficient: add a staged fixture terminal launch. A narrowly scoped stage-only option/testable staging helper is acceptable to run this proof without installing or publishing.
6. Adapt `tui-interactive-audit.mjs` around a terminal-driver boundary: retain tmux on supported Unix hosts and add real Windows ConPTY, with common input/resize/capture/close assertions. Add `--terminal conpty|tmux` and `--client-root` as explicit new harness options; `--client-root` selects a staged root while preserving default source behavior. Windows must execute the native Windows binary through the real Node public entry, not a WSL binary or snapshot renderer.
7. Exercise every delivered top-level view, detail route and form category, including Home, projects, Missions/tickets, Atlas/memory, Beacon/prompts, board, runs/events, plans/approval, settings/doctor, help and generic actions. Derive the exact coverage inventory from wave 2 and the command catalog; list each case as pass/fail/not-run with evidence. Drive representative mutations through UI forms into the disposable runtime and verify authoritative API state; ensure all 59 baseline actions remain reachable (recount current catalog if changed).
8. Add scenarios for invalid form input, escaped/back navigation, long/Unicode text, scrolling/focus, narrow and large windows (40x12, 60x24, 80x24, 120x40), resize while a form is active, DOS palette/readable runtime status tones, `NO_COLOR`, `TERM=dumb`, Ctrl-C/quit/cancel while busy, bridge failure and missing binary. Kill/restart the disposable runtime to prove outage versus workflow state, recovery refresh and event replay without duplicate displayed events. Capture alternate screen/cursor restoration, console mode restoration and no surviving native/bridge child after exit; assert runtime still lives after normal client quit.
9. Run the staged layout from an unrelated cwd with development artifacts inaccessible to prove installed resolution. Exercise `npm run tui`, `node packages/tui/bin/luuna-tui.mjs`, package-local start and the Windows launcher routes; verify actual executable path/hash/PID ancestry, not merely a version string. Windows launcher tests must use disposable runtime data/config and never user's real credential files.
10. Update docs and create a collision-safe new ADR. Document exact build/run commands, Node bridge prerequisite, layout/keyboard adaptations from `luuna-ai`, failure guidance, staged layout, and measured versus blocked platform checks. Preserve historical ADR content with a link to the new decision. Delegate expert improvement after final integration through the orchestrator; do not hand-maintain expertise as this item's primary workflow.
11. Run the validation stack below, fix attributable integration failures, and produce a concise coverage/evidence report with command, host, SHA, executable path/hash and exit status. Remove test-owned children/resources in `finally`, retain useful sanitized reports outside Git, and inspect final diff/status for unrelated edits.

## Testing Strategy

- Unit: actual dispatch/selection/argument behavior and negative artifact paths; spawn failure and status propagation, including signal exit; command/client parity stays under existing tests. Do not replace native evidence with launcher mocks.
- Integration/E2E: real native ConPTY client launched through public entry against `scripts/tui-smoke.mjs` conventions (disposable repository/data, synthetic Pi, random loopback port/token); common interactive scenarios also runnable through tmux. Validate staging without source checkout dependencies.
- Edge cases: inaccessible/invalid artifact, spaces/Unicode in paths, unrelated cwd, missing Node/bridge, protocol mismatch/child death, token prompt cancellation, runtime outage/restart, color degradation, resizing and normal/error teardown.

## Acceptance Criteria

- [ ] Existing default CLI and `npm run tui` open the real Rust terminal workbench with `luuna-ai` appearance; installed Windows launcher resolves its staged executable deterministically.
- [ ] No fallback to the previous JavaScript interactive renderer exists in production dispatch; named commands, help/catalog, `--json`, approvals and usage/refusal codes retain behavior.
- [ ] Windows staging carries and verifies the executable/bridge/client/catalog; missing components fail with actionable instructions, and package reporting names native hashes.
- [ ] Native Windows ConPTY evidence proves the actual public entry, views/forms, sizing/color modes, error handling/recovery and terminal/process cleanup. Untested routes are explicitly listed and block claims of complete interactive coverage.
- [ ] Synthetic runtime evidence is labeled synthetic; snapshots/Unix results/frontend builds do not stand in for native execution, provider success, or clean-machine installation.
- [ ] Required checks pass or each unrelated baseline/environment failure is precisely separated; scoped diffs preserve user and component changes.

## Validation Commands

Current commands verified in manifests/workflow (use pinned Node 24.19.0, npm 11.9.0 and Rust 1.90.0):

- `npm ci --ignore-scripts`
- `cargo fmt --all -- --check`
- `cargo clippy --locked --workspace --all-targets -- -D warnings`
- `cargo test --locked --workspace`
- `npm test` (contracts, guard, component pins, smoke harness and workspace tests)
- `node scripts/check-hygiene.mjs`
- `npm run typecheck`
- `npm run build`
- `cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` (native CI compatibility check; report unavailable host prerequisites)
- `npm run test --workspace @luuna/tui`
- `npm run test:contracts`
- `cargo build --locked -p luuna-runtime`
- `npm run test:tui-smoke -- --runtime target/debug/luuna-runtime.exe` (Windows; default fresh temp evidence directory)
- `node scripts/components.mjs verify` and `node scripts/components-smoke.mjs` (current component CI checks; execute against correctly initialized pins, keep existing dirty-component failures separate)

New/native commands to implement or made available by earlier waves (not existing execution evidence):

- `cargo build --locked -p luuna-tui`
- `cargo test --locked -p luuna-tui`
- `npm run test:tui-interactive-audit -- --runtime target/debug/luuna-runtime.exe --terminal conpty` (fresh temporary evidence directory, Windows)
- `npm run test:tui-interactive-audit -- --runtime target/debug/luuna-runtime --terminal tmux` (Unix only when a native build and tmux are available)
- `powershell -NoProfile -File scripts/package-windows.ps1 -DebugBuild` (existing package command extended for Rust TUI; prerequisites/component drift may block full bundle, do not claim installation)
- Staged audit invokes the same new `--client-root` option with the actual absolute stage directory recorded by the staging step; never substitute source-root execution.

## Notes

The current tree has unrelated dirty component work and can advance during planning. Prior-wave ownership and a clean isolated builder are required before edits. ConPTY coverage is a deliverable, not an optional check; unsupported-host or tool failures must remain visible instead of converting them into passing snapshots. Use local test identities and sanitized reports; a command or screenshot alone does not prove executable identity or cleanup.
