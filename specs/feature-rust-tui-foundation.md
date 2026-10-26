# Feature: Rust terminal foundation and shared command bridge

## Metadata

- Type: feature
- Source: user request; genuine Rust terminal TUI adopting sibling `luuna-ai` appearance, confirmed October 22
- Date: 2026-10-22
- Orchestration: wave 1; foundation for dedicated workbench views (wave 2) and launch/distribution (wave 3)

## Feature Description

Replace the terminal presentation engine with a real Rust terminal application while retaining Luuna's existing runtime-facing command implementation. The foundation supplies a DOS-style shell, complete catalog navigation, interactive forms and a supervised Node bridge. Rust owns drawing, keyboard interaction and terminal restoration; runtime authority and shared request semantics remain unchanged.

## User Story

As a Luuna developer, I want the attractive component workbench experience inside my actual terminal, with every existing action available and the same approval and recovery behavior.

## Solution Statement

Add `crates/luuna-tui` using Ratatui/Crossterm and a bounded JSONL child protocol to new `packages/tui/src/bridge.mjs`. Reuse `COMMANDS`, `PROJECTIONS`, `runCommand`, `LuunaClient`, shared request builders, formatters and failure explanations. This avoids a second handwritten implementation of 59 command bodies and resumable transport. This is explicitly a Rust terminal plus Node transport architecture, not a claim of a standalone all-Rust binary.

## Out of Scope

- Desktop/Tauri replacement, copying sibling component execution logic, direct component/Pi execution, runtime policy changes or component migration.
- Dedicated rich Home/Missions/Atlas/Beacon/runner views: wave 2 layers them over this foundation.
- Default launcher routing, Windows installer/staging and replacement interactive audit: wave 3.
- Changing existing script command behavior, existing catalog IDs, automatic hash acknowledgment, automatic merge, credential storage or unrequested provider work.
- Committing/stashing/snapshotting unrelated changes. The orchestrator owns branch/worktree preparation and integration.

## Relevant Files

- `.claude/experts/tui/expertise.yaml`, `AGENTS.md`, `AI-START-HERE.md`, `docs/CURRENT-ARCHITECTURE.md`, ADRs 0020/0026: current boundaries and parity obligations; read before implementation.
- `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`: wildcard crate membership and Rust 1.90.0 constraint; update lockfile only for real new dependencies.
- `packages/tui/src/{cli,commands,catalog,format,text}.mjs`: existing dispatch, action definitions, metadata, formatting and safe text helpers; reuse without behavioral forks.
- `packages/api-client/src/{index,failures,projections}.ts`: loopback transport, request builders, failures, shared views; remain authoritative client implementation.
- `schemas/capability-catalog.json`, `scripts/check-contracts.mjs`, `packages/tui/test/commands.test.mjs`: dynamic catalog parity and request-body evidence.
- `crates/luuna-tui/Cargo.toml`, `src/{lib,main,protocol,bridge,app,theme,terminal,ui}.rs` (new): binary/library, protocol, child lifecycle, state, DOS tokens, terminal guard, generic UI.
- `crates/luuna-tui/tests/{bridge_process,terminal_lifecycle}.rs` (new): process/protocol and terminal lifecycle integration tests.
- `packages/tui/src/bridge.mjs`, `packages/tui/test/bridge.test.mjs` (new): injectable bridge dispatcher and framed executable entry, behavioral parity tests.
- `crates/luuna-tui/README.md` (new): development invocation, protocol, limits, supported tools and evidence boundaries.
- `../luuna-ai` source/screenshots (read-only reference): visual vocabulary; final module implementation belongs in this repository.

## Implementation Plan

### Foundation

Verify the exact current clean commit selected by the orchestrator immediately before isolated implementation; record full SHA. The observed checkout advanced during planning: do not freeze a stale SHA or sweep user changes into the worktree. Inspect status before and after; preserve dirty original checkout and concurrent work. No blanket add, stash, reset or component-pin changes.

Check [Ratatui installation](https://ratatui.rs/installation/), [Crossterm terminal API](https://docs.rs/crossterm/latest/crossterm/terminal/), release notes and crate manifests for Rust 1.90 compatibility before selecting exact dependency versions; match direct Crossterm dependencies to Ratatui's backend version. Commit the resolved lockfile through the authorized integration workflow. Use existing pinned Rust/Node tools. No Node terminal rendering or Node raw-mode handling exists in the new bridge.

### Core

Stable module ownership for later waves:

- `protocol.rs`: serializable `ClientCommand` and `BridgeEvent` envelopes, validation and bounds.
- `bridge.rs`: owned Node child, bounded reader/writer channels, spawn/shutdown and request correlation.
- `app.rs`: `AppState`, authoritative snapshots keyed by command/context, navigation/context IDs, focus, active action/prompt, connection and bounded output/event windows; queued `ClientCommand`s.
- `terminal.rs`: RAII terminal guard and input lifecycle, including panic/error restoration.
- `theme.rs`: DOS palette and six semantic tones, NO_COLOR behavior; wave 2 can refine sequentially.
- `ui.rs`: renderer and generic catalog/forms/results; wave 2 adds `src/views/*` and registers its views here/in `app.rs`.
- `lib.rs` exports these modules for tests and later views. Views receive state and enqueue commands; they do not spawn children or implement HTTP.

JSONL protocol v1 (document actual JSON spelling and use it consistently in both languages):

| Direction | Envelope / operation | Required behavior |
| --- | --- | --- |
| Both | `{v:1,id,op,...}` requests / `{v:1,id,event,...}` responses | String correlation IDs; reject unsupported versions, duplicate outstanding IDs, invalid fields and unknown operations before dispatch. |
| Rust → Node | `catalog` | Returns command metadata, capability IDs, projections, argument/context definitions, flag prompt/repeat/multiline/boolean definitions and confirmation text; no executable code. |
| Rust → Node | `invoke {name,args,flags,stdin_document?}` | Runs an allowlisted existing command interactively through existing command validation/handlers; returns structured value and plain formatted text. |
| Rust → Node | `read {name,args,flags}` | Allowlisted GET commands/projections only; cannot run mutations by changing a name or flag. Shares the same command implementation. |
| Rust → Node | `reply {request_id,prompt_id,value}` | Resolves only the matching outstanding prompt; stale, duplicate or wrong-request answers are rejected. |
| Rust → Node | `abort {request_id}` | Aborts the client's request/follower via its AbortController and invalidates its prompts. This does not call runtime `cancel`. |
| Rust → Node | `shutdown` | Aborts local work, ends streams, closes pipes and exits the child; never shuts down the runtime. |
| Node → Rust | `catalog`, `result {value,formatted}`, `output {kind,text}` | Machine data and uncolored human text remain separate. Stdout contains protocol frames only. |
| Node → Rust | `prompt {prompt_id,kind,question,...}` | Kinds `text`, `confirm`, `hash`, `document`; answer entered by the user in Rust, without any guessed/cached response. |
| Node → Rust | `event {record}`, `connection {state,message}`, `error {code,message,outcome}` | Emit live stream/outage/recovery notifications during work, and explicit sanitized errors. One terminal result/error per request. |

`stdin_document` supports explicit form-submitted JSON/prompt body for existing `-` operands; `io.readStdin` consumes that supplied value or requests a document prompt, never reads protocol stdin as document bytes. Existing explicitly chosen file paths retain their existing command behavior. No shell interpolation or evaluation is used.

Reuse `runCommand` with bridge IO adapters, or extract a narrowly shared command executor if needed; do not maintain two validation/confirmation implementations. Preserve structured results, plain `format` output, `io.show`, `io.emit`, failure explanations and return codes. Interactive `approve` always presents the complete current plan and requires a fresh typed acknowledgment through its existing acknowledgment callback (ADR 0042 replaced the full-hash entry: `approve`, `yes` or an 8+ digit prefix of the hash just read; the complete hash is sent). Reject `acknowledge-hash` supplied through interactive bridge requests; do not convert cached/displayed plan hashes into consent. Truncated or unavailable plan display disables approval.

The event loop stays responsive while requests, health checks, prompts and SSE are pending. Health polls every two seconds with a bounded timeout and at most one outstanding poll; restoration reloads authoritative views and does not replay mutations. SSE uses existing `followEvents`, preserving sequence validation and resumption. User `cancel` is a separate visible runtime action; leaving a view, Esc or closing the client only aborts local work. Report unknown mutation outcomes after connection loss; never retry mutations automatically.

Protocol resource limits are explicit constants with boundary tests: maximum 1 MiB UTF-8 frame, maximum 32 queued outbound frames, at most four concurrent read requests and one mutating action. Reserve control processing for abort/reply/shutdown even under output load. Await writable drain or bounded channel capacity; do not buffer unbounded promises or input lines. Stop reading/terminate a malformed or oversized peer before allocating unbounded memory. Chunk textual output into at most 64 KiB frames; keep only a bounded 256 KiB display tail and 200 live events, visibly mark omitted history and retain existing authoritative replay actions. Oversized structured results produce an explicit `result_too_large` outcome with execution status, never silent partial JSON or an invitation to repeat an already performed mutation. A single oversized complete plan cannot be approved.

Known tokens must never appear in frames, diagnostics, output, test artifacts or command arguments. Node stderr is drained with a bounded tail; raw exception stacks, raw server bodies and environment dumps are not shown. Render every externally sourced string as text: strip ESC/OSC/C0/C1 controls except intentional newlines/tabs, use display-cell widths, clamp selection/scroll and avoid terminal-title/clipboard control injection. Keep original structured payload unchanged only in in-memory transport/state when needed for existing API semantics; sanitize at all display/log boundaries.

### Integration

The crate produces binary `luuna-tui`. `--help` exits successfully without token, bridge or runtime. No arguments require terminal stdin/stdout; without them print usage and exit 2. Options `--bridge <absolute-path>` and `--node <executable-path>` are available to launchers/tests; default checkout bridge resolution must not depend on arbitrary cwd, and missing deployed resources fail clearly. Node defaults to PATH if not explicitly supplied. Do not silently run/build from sibling `luuna-ai` or install dependencies on startup.

Connection uses existing `LUUNA_URL` and `LUUNA_API_TOKEN`; Rust provides hidden token entry when missing and passes the token only in the owned child's environment. Invalid/non-loopback URLs fail before token-bearing network access using shared client validation. Tokens never become protocol bootstrap arguments. The bridge may return catalog metadata before connection initialization; connection failure must leave usable retry/help/quit UI. Exiting never stops an independently running runtime.

Use an owned child handle and bounded shutdown deadline: graceful shutdown, then kill/wait only that child if necessary, close/join pipe workers and restore terminal on every path. Test normal quit, Ctrl-C, panic, early initialization error, broken pipes, child crash, lost terminal and abort during prompt/stream. Preserve previous raw/cursor/alternate-screen state appropriately; no busy-loop or orphan bridge.

## Step by Step Tasks

1. Revalidate instructions, expert, baseline identity and catalog count; record explicit ownership and dependency documentation sources.
2. Add crate manifest/library, pinned compatible dependencies, protocol types/bounds and protocol tests; keep existing script-mode entrypoints untouched.
3. Implement injectable bridge dispatcher and executable framing with shared handlers, read allowlist, prompts/document IO, SSE/health and cancellation.
4. Add Rust child transport/lifecycle and AppState; verify wrong IDs, stream callbacks and crash behavior before UI integration.
5. Build real DOS terminal shell using double-line borders, navy surfaces, teal/cyan accents, selected-row contrast, menu/footer hints and all six status tones. Include catalog browser, context selection, dynamic argument/flag forms, full-plan/hash prompt, scrollable results and live event output.
6. Add behavior tests for every current catalog entry and projections through the new boundary, including request bodies and revision/hash/boolean/repeated input preservation.
7. Exercise terminal/process lifecycle and malicious/burst output; document interface contract, launch options and bounded display behavior for waves 2/3.
8. Run validation; fix introduced failures and report unrelated baseline failures separately. Leave all launch/packaging wiring for wave 3 and expert/architecture integration to the orchestrator.

## Testing Strategy

- Unit: protocol/parser limits, command allowlists, prompt correlation, input validation, state reduction, terminal sanitization, Unicode widths, bounded buffers and tiny terminal layouts using Ratatui TestBackend.
- Bridge behavior: fake fetch captures every existing catalog method/route; compare key register/plan/approve/memory/retention bodies with existing command tests. Assert both projections, stdin documents, file operations with temporary fixtures and complete confirmations.
- Process integration: Rust tests launch the actual bridge with fixture loopback server, exercise frames/prompts/events/reconnect/abort, kill it and verify controlled recovery/error with no raw token leakage.
- Terminal: real PTY when supported; send resize/navigation/quit/Ctrl-C, verify alternate screen/cursor/raw-mode restoration and child exit. Explicitly report unavailable PTY facilities rather than silently passing a skipped test.
- Runtime smoke below remains existing script-mode regression evidence only; it does not prove the new renderer. No fixture establishes genuine-provider or other-platform success.

## Acceptance Criteria

- [ ] Rust actually owns the terminal and remains responsive during bridge work; no browser/Tauri launch occurs.
- [ ] All catalog actions (currently 59), home and board are reachable through generic UI with equivalent context/arguments/flags; dynamic catalog equality prevents future omissions.
- [ ] Approval displays the complete freshly read plan and accepts only an unprefilled typed acknowledgment (ADR 0042: `approve`, `yes` or an 8+ digit prefix of the hash just read; the complete hash is sent); cancellation/mismatch sends no approval request.
- [ ] Shared builders, failure semantics, policy boundaries, hidden credentials, loopback restrictions, SSE resumption and all script-mode behaviors remain intact.
- [ ] Reconnect reloads read state; no mutation, approval or runtime cancellation occurs automatically.
- [ ] DOS layout works without overflow at 40x12, 60x24 and 80x24, supports resize/scrolling and plain NO_COLOR mode; tiny panes have a safe compact fallback.
- [ ] Oversized/malformed frames, blocked writers, token-bearing errors, malicious terminal text, child crashes and local cancellation have bounded verified outcomes.
- [ ] Quit/error paths restore terminal and reap the owned child, leaving runtime running; no unrelated process is killed.
- [ ] Tests exercise new Rust/Node boundary, not only old command methods or static catalog markers. Existing launch/packaging paths remain unchanged in this wave.

## Validation Commands

Commands below are grounded in root manifests, CI and `AI-START-HERE.md`; no TAC section currently exists. New crate/test commands become executable in this item.

- `cargo fmt --all -- --check`
- `cargo clippy --locked -p luuna-tui --all-targets -- -D warnings`
- `cargo test --locked -p luuna-tui`
- `cargo test --locked -p luuna-tui --test bridge_process`
- `cargo test --locked -p luuna-tui --test terminal_lifecycle -- --nocapture`
- `cargo build --locked -p luuna-tui -p luuna-runtime`
- `cargo run --locked -p luuna-tui -- --help`
- `npm run test --workspace @luuna/tui`
- `npm run test:contracts`
- `npm run typecheck`
- `npm run test:tui-smoke -- --runtime target/debug/luuna-runtime.exe --out "$env:TEMP/luuna-rust-foundation-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))"` (PowerShell/Windows; fresh synthetic runtime evidence).
- `git diff --check`

## Notes

The bridge is an intentional parity tradeoff and keeps Node as a host/package prerequisite. Ratatui/Crossterm compatibility must be proved against pinned Rust 1.90 rather than assumed from latest releases. Full workspace checks belong to final integration in addition to this focused suite. Wave 3 must replace default launch and packaging only after the Rust implementation and wave 2 views pass review; until then direct crate invocation is development evidence, not a completed default CLI migration.
