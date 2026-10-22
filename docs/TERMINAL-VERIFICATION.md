# Native terminal verification

The 2026-10-22 native Windows run passed 93 checks and all 37 required UI cases,
with 135 reconstructed terminal captures. `ui_complete` was true; `complete`
remained false because an existing service occupied port 4242. Production
bootstrap warm reuse was left blocked, while controlled PowerShell routing to
the actual staged Rust application passed. The disposable runtime and every
owned terminal/bridge process exited. Native Unix and the new hosted CI job
were not executed in that Windows run.

Use Node 24.19.0, Rust 1.90.0 and the pinned component checkouts with Bun 1.4.3.
Windows requires Python 3 for the standard-library ConPTY driver. Native Unix
uses tmux; it does not stand in for Windows evidence.

```sh
npm ci --ignore-scripts
npm run components:setup
npm run build --workspace @luuna/api-client
cargo build --locked -p luuna-runtime -p luuna-tui
npm run test:tui-terminal
npm run test:tui-interactive-audit -- --runtime target/debug/luuna-runtime.exe --components-root . --terminal conpty --out <new-directory>
```

On Unix, use `target/debug/luuna-runtime` and `--terminal tmux`. An explicit
`CARGO_TARGET_DIR` is honored for checkout binaries; installed payloads ignore it.
The audit refuses to reuse an output directory. All projects, repositories,
runtime data, tokens and mutations belong to disposable synthetic fixtures.
It never invokes a real model provider.

The audit drives the public CLI, the compiled Rust application, its Node bridge,
the real runtime and all three real components. It exercises dedicated views,
forms, exact approval, stale identities, all catalog entries, event replay,
resize, color degradation, startup errors and owned-process cleanup. It also
stages the executable with its shared client and catalog, verifies its identity,
and launches it from an unrelated directory through Node, npm and PowerShell.

`report.json` distinguishes `ui_complete` from `complete`. Every required UI case
must pass for `ui_complete`; `complete` additionally requires no external
validation gaps. Not-run requirements cannot silently count as passes. Partial
diagnostic modes (`--foundation`, `--shutdown-launch-only`) always remain
incomplete. The process returns nonzero for incomplete acceptance.

Windows production bootstrap owns loopback port 4242. If an existing service
occupies it, the audit preserves that service and its credentials. It then tests
the unchanged `start-terminal.ps1` using a controlled helper that returns only
the disposable runtime connection in memory. That is launcher-routing evidence;
production bootstrap warm reuse remains explicitly blocked in `validation_gaps`.
With port 4242 free, the same harness exercises production warm reuse with an
isolated profile and a DPAPI-encrypted disposable connection record.

Npm and PowerShell console modes are independently measured with no-op programs
before comparing their launch paths. Direct native launches must restore their
exact initial console modes. Every route must restore the main screen and cursor
and reap its native process and bridge while leaving the runtime independent.
The signal case delivers the SIGTERM event to the real Node launcher handler;
Windows `process.kill(SIGTERM)` forcibly terminates a process and is not used as
a graceful signal test. Rust lifecycle tests separately cover native shutdown
control and hidden-token cancellation.

Captures include the terminal cell grid and SGR styles plus standalone HTML.
These are reconstructed terminal captures, not operating-system screenshots.
Fixture results do not establish clean-machine installer, signing, provider or
unexecuted platform compatibility. CI uploads reports and captures only, not
the fixture credentials or staged profile.
