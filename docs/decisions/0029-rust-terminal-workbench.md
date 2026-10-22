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
