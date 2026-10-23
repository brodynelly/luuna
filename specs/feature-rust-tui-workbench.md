# Feature: Runtime-backed DOS terminal workbench

## Metadata

- Type: feature
- Source: user request to replace Luuna's terminal UI with a genuine Rust terminal adaptation of `../luuna-ai`.
- Date: 2026-10-22
- Wave: 2; depends on `specs/feature-rust-tui-foundation.md` and its integrated Rust shell/JSONL bridge.

## Feature Description

Make the actual Luuna CLI a keyboard-operated DOS workbench with dedicated Missions, Atlas and Beacon surfaces, plus project, plan and run evidence views. Reproduce LUUNA-AI's blue desktop, framed panes, menus and component organization while preserving Luuna's runtime authority and existing command capabilities. This is a terminal application, not a Tauri launcher or webview.

## User Story

As a Luuna operator, I want a cohesive visual workbench for tickets, knowledge, prompts and approved execution so that I can inspect and perform real workflows without assembling commands by hand.

## Solution Statement

Build views on the foundation's Rust `AppState`, command queue and versioned Node bridge. Use bridge `Catalog`, `Result { value, formatted }`, `Prompt`, `Output`, `Connection`, `Event` and `Error` messages; issue `Read`, `Invoke`, `Reply` and `Abort` requests rather than calling HTTP, Pi or component CLIs from Rust views. Preserve the shared command/request builders and projections. Dedicated forms improve common operations; a generated catalog palette exposes every remaining action without replacing domain guards.

## Out of Scope

- Desktop launch/installation and named CLI command dispatch (launch/packaging item); foundation transport and terminal lifecycle (wave 1).
- New runtime routes, component storage migration, standalone LUUNA-AI private stores, direct Pi sessions/configuration, arbitrary shell execution or component source changes.
- Dragging tickets between states, standalone Missions priorities/dependencies, Atlas domain/type/classification forms, Beacon archive/source-history editing: the current runtime does not expose these desktop operations.
- Automatic context loading, approval, execution, publication or merge; runtime policies remain authoritative.

## Relevant Files

- `AGENTS.md`, `AI-START-HERE.md`, `docs/CURRENT-ARCHITECTURE.md`, accepted ADRs 0013/0014/0020/0026/0027: product boundaries and evidence semantics.
- `.claude/experts/tui/expertise.yaml`: current domain map; curator updates it after integration.
- `packages/tui/src/commands.mjs`: `COMMANDS`, `PROJECTIONS`, `acknowledgedHash`, command arguments/flags and exact shared request behavior.
- `packages/tui/src/format.mjs`: six tone tables, human evidence and next-step explanations; do not invent green success for `completed`.
- `packages/api-client/src/projections.ts`: `homeSummary`, `boardProjection`, eight `BOARD_COLUMNS`; projections are read-only.
- `schemas/capability-catalog.json`: complete action set (currently 59); generic menu coverage must derive from it.
- `crates/luuna-tui/src/{app,ui,theme,protocol}.rs` (foundation-created): navigation/context state, queue, rendering integration and shared palette.
- `crates/luuna-tui/src/views/{mod,home,projects,missions,memory,prompts,runs,plan,forms,catalog}.rs` (new): dedicated views and common interaction logic; combine small modules if clearer.
- `crates/luuna-tui/tests/workbench.rs`, `crates/luuna-tui/tests/fixtures/`, `crates/luuna-tui/tests/snapshots/` (new): meaningful rendering, key interaction and workflow contracts.
- `../luuna-ai/renderer/{renderer.css,workbench.css,workbench.js}` and `../luuna-ai/assets/screenshot-menu.png`: read-only visual reference.
- `../luuna-ai/.tac/runs/8d2ea719/tester-native/{kanban,prompt,memory}-{normal,minimum}.png`: read-only component appearance reference, including uncommitted source work.

## Implementation Plan

### Foundation

Consume the actual integrated foundation interfaces; coordinate compatible names without duplicating transport. Foundation modules provide terminal lifecycle, command metadata, prompt callbacks, inline document input (`Invoke.stdin_document`) for `save-prompt` with `-`, and sanitized display. Its `io.readStdin` consumes that document or issues a document prompt; it never reads JSONL protocol stdin as a body. Add view state for stable selected IDs, scroll offsets, explicit project/ticket/plan/run context and unsent form data. Responses from an earlier project/request generation must not overwrite the current selection.

### Core

Use the exact VGA palette from LUUNA-AI: blue `#0000AA`, gray `#AAAAAA`, white `#FFFFFF`, yellow `#FFFF55`, cyan `#00AAAA`, light cyan `#55FFFF`, green `#00AA00`, red `#AA0000`, magenta `#AA00AA`, with the remaining named VGA entries. Wide screens use a gray menu row with red mnemonics, blue background, double-line panes, white focus border, yellow focused title, left navigation near 26%, main detail/workbench pane and a gray context-sensitive key footer. Forms replace the desktop message composer; no fake chat shell.

Map success/active/danger/attention/neutral/interrupted to distinct palette tones while preserving every exact runtime state word and reason. `completed` and `cancelled` are neutral; interruption and outages are distinct from failure. Under `NO_COLOR` and `TERM=dumb`, omit color styling but retain words, boundaries, focus markers and usable keyboard navigation.

Provide Home, Projects, Missions, Atlas, Beacon, Runs, Commands and Help navigation. At 120x35 show navigation and details together; narrow/short terminals show one focused pane with reachable tabs/menus. Missions shows a horizontally pageable set of columns at wide sizes and one selected column/list at narrow sizes; all eight columns remain reachable, including empty columns. Never shrink text to illegibility or create off-screen confirmation fields.

### Integration

All dedicated buttons/forms enqueue existing named commands through the bridge. Render authoritative JSON records; keep formatted output as an inspectable detail fallback. After writes, refresh the affected projection and preserve selection by ID. Keep errors, stale-source refusals and reconnection reasons visible; do not optimistically claim a successful mutation. Component activation is an explicit command, never a view-open side effect. Keep generic command execution usable for all catalog actions, including repeatable flags, booleans, optional values, multiline fields and document inputs.

## Step by Step Tasks

1. Read the integrated foundation spec/interfaces and register a view router in `app.rs`/`ui.rs`; use the shared queue and theme. Define view-local state and a checked transition table for selection, opening/back, form submission, cancellation and read completion. Do not edit foundation bridge semantics without coordination.
2. Implement DOS chrome, focus markers, menu/dropdown and footer. F1 opens Help, F10 opens menus, Tab/Shift-Tab cycles available panes/fields, arrows and PageUp/PageDown/Home/End navigate, Enter opens/submits the focused action, Escape returns or cancels the active prompt/request. Map refresh and Commands to visible keys; printable letters and `q` must remain text inside forms. Preserve the foundation's explicit quit/cancel semantics and runtime-independent service lifetime.
3. Implement Home and Projects from `home`/`projects`/`project`: repository identity, manifest revision, per-repository baseline, testing prerequisites, blockers and selected project. Offer runtime registration/discovery/manifest/baseline actions through catalog forms; render all repositories rather than assuming index zero.
4. Implement Missions using `board --project` and existing `boardProjection` output: Backlog, Testing prerequisite, Discovery / plan, Approval, Implementation, Checks, Review, PRs. Cards show title, ticket/revision, runtime state and related run; opening a card leads to ticket details, while prerequisite cards lead to project/repository details. Explain the read-only projection. Provide real create/edit forms for title, intent, repeated acceptance criteria, repositories and purpose; send the displayed expected revision on edits. Expose source inspection/reconciliation with explicit refresh and revision, and plan/run navigation. No move/start/close shortcuts masquerading as ticket status writes.
5. Implement Atlas list/search/detail with scope, content, provenance and complete hash. User memory is excluded until an explicit include-user choice; changing project clears this opt-in and pending plan context. Provide create/correct/delete/promote controls using displayed hashes and valid scopes; generic retention/export actions stay discoverable. Show scope-widening and deletion confirmations without replacing the shared command's own guards. Do not invent Atlas classification controls.
6. Implement Beacon list/detail/preview and create/update forms for name/body. Feed multiline body through the foundation's inline-document channel to existing `save-prompt project name -`; updates carry the displayed expected version. Render exact preview version/hash and available provenance. Stale versions produce a visible refusal and refresh option, never a silent overwrite. No archive/history buttons when unsupported.
7. Add explicit plan-context selection from Atlas and rendered Beacon previews. Display selected memory IDs and the prompt's exact `name@version#hash`; removal and clearing are explicit. Selection does not submit anything. On an explicit plan form submission, pass only those chosen flags through existing `plan`; scope choices, task roles/dependencies/overrides/budgets remain available in its catalog form. Clear pending selections on project change and distinguish unsent selection from a recorded immutable plan snapshot.
8. Implement plan detail with complete identity, revision/hash, tasks/scope, budgets and selected component context. Approval displays the full plan and blank acknowledgment input: require the user to type `approve` or a hash prefix of at least eight digits (ADR 0040 replaced the complete-hash entry), never prefill/auto-copy/auto-submit it. Empty or mismatched acknowledgment creates no approval request. Use shared `approve` behavior and keep implementation a separate explicit action.
9. Implement Runs and run detail: exact runtime state, event stream/replay, task assignments/dependencies, candidate commits/hash, checks/log references, independent review, usage, publication and next-step explanations. Evidence tabs/actions invoke existing `candidate`, `diff`, `tasks`, `worktrees`, `attempts`, `events`, `follow`, `publication`, `artifact` commands. Use runtime admission flags/reasons when provided; otherwise let the runtime decide and render refusal. Leaving follow cancels the client subscription, not the underlying run; run cancellation is a separately named action.
10. Implement generated Commands palette grouped by metadata context, with searchable command name/action, contextual ID defaults and complete argument/flag forms. All current catalog IDs remain reachable, including export/import, setup/scaffold, repair/publication and doctor/shutdown. Avoid hard-coded capability counts or actions with no executable handler; preserve shared confirmation prompts and output-file behavior.
11. Add fixture-backed Rust view tests and deterministic cell snapshots plus serialized key-event tests. Demonstrate every view and relevant state listed below, including stale results, form bounds and canceled approval. Add workflow tests against the versioned bridge with recorded real runtime response shapes; coordinate live runtime interaction coverage with the launch/validation item instead of treating mock success as native evidence.
12. Run the validation commands, fix item failures and record an every-view coverage checklist with verified/untested/blocked entries under the orchestration run directory. Retain synthetic fixture labeling and report native-host limitations accurately.

## Testing Strategy

- Unit: view transitions, selected identity/context isolation, menu catalog completeness, form-to-command args/flags, displayed revision/hash/version preservation, all six tones and unchanged state words.
- Rendering: actual Ratatui/TestBackend cells at 40x12, 60x24, 80x12, 80x24 and 120x35; snapshot text and key styles for Home, Projects/detail, Missions board/ticket/form, Atlas/list/detail/form, Beacon/list/preview/form, Runs/evidence, Plan/approval, Commands/form, Help, connection/error states.
- Interaction: menus, keyboard focus, long lists, wide Unicode, pasted multiline body, terminal-control sanitization, resize during form and approval, blank/hash mismatch, busy Escape, stale request completions, empty components and outage/recovery.
- Integration: fake bridge records exact invoked shared commands and supplies realistic runtime fixtures; existing Node command tests still verify method/body parity. Native audit from the integration item must open all visual surfaces and exercise real fixture-backed ticket/memory/prompt mutations, plan selection and approval refusal/success. No provider calls are needed for this item.

## Acceptance Criteria

- [ ] Actual Rust terminal view visibly follows LUUNA-AI's framed blue DOS layout and component organization; no Tauri/WebView opens.
- [ ] Every current catalog action is selectable and executable through shared command metadata, with explicit context and meaningful prompts.
- [ ] Home/projects, all eight Missions columns, Atlas, Beacon, plan/approval, runs/evidence, generic commands and Help have dedicated reachable UI and verified loading/empty/populated/error states where applicable.
- [ ] Ticket create/edit, memory create/correct/delete/promote, prompt create/update/render and explicit plan-context selection use existing runtime-backed commands with displayed concurrency tokens.
- [ ] No standalone unsupported feature is presented as functional; board movement, memory scope, versioning and runtime state remain truthful.
- [ ] Approval requires an unprefilled typed acknowledgment (ADR 0040: `approve` or an 8+ digit hash prefix) after inspectable full plan; empty/mismatched input sends no approval. Browsing/context selection never starts a worker.
- [ ] All target dimensions fit within terminal bounds, maintain a visible focus/footer and reach all columns/actions; long evidence and full hashes remain scrollable/readable.
- [ ] Six distinct status tones preserve exact words, and monochrome modes preserve meaning. `completed` is not painted as passed evidence.
- [ ] Explicit user-memory inclusion, project context isolation, current selection after refresh and stale-response rejection are covered by behavior tests.
- [ ] All view snapshot/interaction tests pass; native evidence is separately recorded and does not claim provider or untested-platform success.

## Validation Commands

- `cargo fmt --all -- --check`
- `cargo test --locked -p luuna-tui`
- `cargo clippy --locked -p luuna-tui --all-targets -- -D warnings`
- `cargo build --locked -p luuna-tui`
- `npm run test --workspace @luuna/tui`
- `npm run test:contracts`
- `cargo test --locked -p luuna-tui --test workbench` — dedicated cell snapshots, views and serialized interaction coverage added by this item.
- Integrated Windows audit, after the launch item implements the new adapter: `npm run test:tui-interactive-audit -- --runtime target/debug/luuna-runtime.exe --terminal conpty` (default fresh evidence directory).
- Integrated Unix audit, when a native build and tmux are available: `npm run test:tui-interactive-audit -- --runtime target/debug/luuna-runtime --terminal tmux`. Never cite an unrun host command as passing.

## Notes

The sibling source contains substantial existing uncommitted work; use it only as a read-only reference. Its three-column standalone board and memory taxonomy must not overwrite Luuna's eight-stage workflow and scoped memory contract. If substantially copying renderer code retain Luuna-AI's MIT notice in the product attribution file; color/layout adaptation alone does not import its backend. Foundation/launch interfaces are dependencies: coordinate changes rather than duplicating transport or overwriting another agent's files. Exact current catalog names, source response shapes and foundation APIs take precedence over examples in this spec.
