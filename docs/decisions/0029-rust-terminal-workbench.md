# ADR 0029: Rust terminal workbench with the shared command bridge

Date: 2026-10-22. Status: accepted for the terminal migration.

## Context

The user selected a real Rust terminal interface using the DOS appearance and
component layout of the sibling `luuna-ai` desktop application. Launching that
desktop application would not satisfy the terminal requirement. ADR 0020's
catalog, shared client and command interface already preserve product parity.

## Decision

`crates/luuna-tui` owns terminal input, layout, forms and restoration. Its local
Node JSONL bridge in `packages/tui/src/bridge.mjs` runs the existing command table
and `@luuna/api-client`. Runtime policy remains authoritative; the terminal does
not duplicate approval, mutation or event-resumption rules.

The public Node entry starts Rust only for no-command launches with terminal
input and output. Named commands, JSON, help and catalog retain their script
interface. No production dispatch falls back to the former JavaScript renderer.
Rust reads a missing token without echo; the launcher passes credentials only
through environment inheritance. It passes absolute `--bridge` and `--node`
paths, with the exact Node executable running the public entry.

Source checkouts resolve `target/debug/luuna-tui[.exe]` relative to their package
root, honoring Cargo's explicit `CARGO_TARGET_DIR`. Installed layouts resolve
`luuna-tui.exe` beside their runtime and ignore development target overrides.
There is no PATH search for an arbitrary Luuna binary or newest-file heuristic.
Missing binaries give a build or reinstall instruction. Help and named commands
do not require the native binary. Node remains a host prerequisite.

Windows packaging builds the native terminal with the locked Rust toolchain and
stages it with the bridge, command code, catalog and compiled API client. The
shared `scripts/stage-terminal.mjs` also produces an independently testable
terminal payload. Packaging records the native executable hash. The fixed
Windows startup helper and memory-only credential transfer remain ADR 0011's;
closing the terminal does not stop the independent runtime.

Launcher shutdown signals write an empty marker in a private temporary directory.
Rust observes that marker during both connection entry and normal interaction,
restores the terminal and reaps its bridge. Direct native signals use the same
cleanup path. The launcher bounds the wait before terminating an unresponsive
owned child; it does not immediately kill Windows children on SIGTERM.

## Validation and limits

Launcher tests cover selection, errors, exit status, command dispatch and private
argument handling. `npm run test:tui-terminal` exercises a real Windows ConPTY
session using a standard-library Python helper and a bounded VT screen model,
including input, resizing and console restoration. This driver test is distinct
from native Luuna UI acceptance: only executing the actual entry, compiled Rust
binary and disposable synthetic runtime establishes that behavior.

Native UI coverage must identify views, forms, colors, narrow layouts, outage
recovery, cleanup, executable identity and staged launch. Missing or unexecuted
cases remain visible. Fixture evidence does not establish provider success,
clean-machine installation, signing, or another platform's compatibility.

`npm run test:tui-interactive-audit -- --runtime <native-runtime> --components-root
<checkout> --out <new-directory>` runs the public entry and staged payload. Windows
uses ConPTY; native Unix uses an isolated tmux server. Reports include required
coverage, executable hashes, owned-process cleanup and reconstructed terminal
cells. Wrapper console changes are independently measured with no-op npm and
PowerShell sessions. The native CI jobs use Node 24.19.0, Rust 1.90.0, Python 3.12
and Bun 1.4.3; actual host execution is required for a platform acceptance claim.

## Amendment, 2026-10-22: the setup guide (`lu prime`)

`lu prime` (also `s` on Home and Projects, and "Set up a project" in the menu) opens the workbench in a full-screen guide mode instead of Home (`luuna-tui --guide prime [--guide-flag path=<dir>|project=<id>]`). The guide's flow lives once, in `packages/tui/src/prime.mjs`, written against a small UI interface with two faces: the bridge face (`src/bridge-guide.mjs`) for this workbench and a line-mode face (`src/prime-ui.mjs`) used when the native binary is not built. The bridge gains one operation and one event: `{op: "guide", name: "prime", flags}` runs the guide as a mutation-class request, and `guide` events carry its presentation (`step`, `line`, `panel`, `spin`, `spin_stop`, `finish`, a `batch` of those emitted in one synchronous burst so a long step cannot exhaust the output queue) and its questions (`ask`, `choose`, `checklist`, `edit`), each with a `prompt_id` answered through the existing `reply` operation, typed per kind (text a string, a choice an index in range, a checklist one boolean per option, an edit `saved`). Styles travel as private-use markers (U+E000 style U+E001 text U+E002) that the workbench turns into spans; text the guide did not style has markers removed so it cannot style itself. The workbench (`crates/luuna-tui/src/guide.rs`, `views/guide.rs`) only presents: a step rail with a progress gauge and a moon whose lit part grows with the settled steps, the styled log with boxed previews, the open question, a spinner, an Esc confirmation before leaving (which sends `abort`; nothing is undone), and the ending, whose Enter opens the project in the workbench. An `edit` question suspends the terminal (input thread joined, alternate screen and raw mode left), runs `$VISUAL`, `$EDITOR` or the platform editor on the guide's temporary draft, and takes the terminal back.

Every runtime step of the guide is a cataloged command run through its own `run`, so it sends the bodies the commands send and every decision and refusal stays the runtime's; a refusal is shown with the shared failure text and offers retry, skip or leave. The guide is not a catalog action. Its seventh step onboards the coding agents that open a repository directly: with the developer's explicit choices it runs the Missions, Atlas and Beacon CLIs in the registered checkout (`init` for missing repo-local stores, `onboard --stdout` previewed before `onboard` writes CLAUDE.md or AGENTS.md, `setup claude` for Claude Code hooks only when ticked, and `prime` to show what each component primes an agent with). These are repo-local stores in the checkout (ADR 0028), separate from the runtime's managed stores (ADR 0014); the component processes run with Bun's own executable (never a shell shim), no shell, the checkout as working directory, bounded time and output, and an environment without `LUUNA_URL` or `LUUNA_API_TOKEN` (`packages/tui/src/components.mjs`). When discovery proposes no required check, the guide can add one (a test command, validated by the runtime at confirmation).

Evidence: `packages/tui/test/prime.test.mjs` (the flow with scripted answers, the component runs and their order, the bridge's guide frames and typed replies, refusal of unknown guides, flags and out-of-range replies); `crates/luuna-tui/src/guide.rs` and `views/guide.rs` unit tests, `tests/guide.rs` (the screen at 120x36 pinned as `tests/snapshots/guide.txt`, smaller sizes, keys to replies, the leave confirmation, the ending into the workbench) and `tests/guide_pty.rs` (the binary in a real PTY answering a scripted bridge by keys and restoring the terminal). An end-to-end run of the real bridge against a disposable runtime with the synthetic Pi fixture, a throwaway Git repository and the installed component CLIs passed 13 of 13 checks on Windows (registration, an added required check confirmed as manifest r1, a passing baseline of the real unittest, a ticket, the three repo-local stores, the three CLAUDE.md sections, the Claude Code hooks, each component's primed context, and no token in any frame); component activation was not exercised there because this host's Missions submodule differs from its pin (`npm run components:verify`). Screen-reader output of the guide is not audited.
