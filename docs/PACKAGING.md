# Packaging the Windows development distribution

`scripts/package-windows.ps1` builds an unsigned NSIS development installer
(ADR 0018, ADR 0024). This page records what the installer contains, how the
packaged layout is verified, and the clean-machine procedure that establishes
whether the installer delivers the integrated product on a host that never
had the build checkout.

**Status: the clean-machine procedure below has NOT been executed in the
change that introduced the portable component layout (2026-10-22). The
packager, the staging script and the verifier are covered by unit tests on
Linux; no installer carrying components has been built or installed on a
Windows host yet. Until a run is recorded here, the installer remains a
development distribution with unverified portable component evidence.**

## What the installer carries

The terminal payload is `luuna-tui.exe` alone, built with `cargo build --locked
-p luuna-tui` in the selected profile: the command line, the workbench and its
in-process command service are one executable that embeds its command table and the
capability catalog (ADR 0037), so the terminal needs no Node. The installed launcher
always selects this staged binary; it never selects a checkout's debug executable.
The package report includes its SHA-256.

To stage only this payload for testing, first build the native terminal, then use
`node scripts/stage-terminal.mjs --out <new-stage-directory> --binary <absolute-luuna-tui.exe>`.
This creates the same terminal payload used by the packager without installing
an application. A staged `--help` check only proves command startup: actual
interactive acceptance must launch this directory's public entry in ConPTY
against a disposable runtime, from an unrelated working directory.

The bundle's `luuna/` folder beside `luuna-desktop.exe` contains:

| Path | Origin | Purpose |
| --- | --- | --- |
| `luuna-runtime.exe` | `cargo build --locked --release -p luuna-runtime` | the service |
| `luuna-tui.exe` | `cargo build --locked --release -p luuna-tui` | the native terminal workbench |
| `scripts\*.ps1`, `Configure Luuna.cmd`, `Stop Luuna.cmd` | repository | fixed bootstrap and helpers (ADR 0011) |
| `pi\` | `npm ci --ignore-scripts --omit=dev` in `tools/pi` | the pinned Pi engine |
| `components\manifest.json` | byte copy of the repository manifest | the pins (ADR 0012) |
| `components\dist-manifest.json` | `scripts/stage-components.mjs` | per-component commit and tree digest, Bun hash |
| `components\missions`, `components\atlas`, `components\beacon` | frozen, script-free Bun install in the pinned checkouts, copied without `.git` | the component CLIs with their dependencies |
| `bun\bun.exe` | `npm install bun@1.4.3` into `.tools\bun` (as `scripts/setup-cloud.sh`) | the pinned Bun 1.4.3 |
| `Luuna Terminal.cmd`, `luuna.cmd`, `scripts\start-terminal.ps1` | repository / generated | opens `luuna-tui` against the local runtime with the connection obtained in memory from the fixed helper |

Host prerequisites on the target (reported by `luuna-runtime doctor`):
WebView2 (bootstrapped by the installer), Node.js 24.19 or newer on `PATH`
(Pi and the TypeScript client), Git 2.43 or newer, Python 3 for Python
recipes, and a provider key saved with `Configure Luuna.cmd`. No Node is
bundled.

## How the packaged layout is verified

1. On the packaging host, `stage-components.mjs stage` refuses to stage
   unless every pin agrees with its gitlink and `.gitmodules` URL and every
   checkout is clean at the pinned commit (the `components.mjs verify`
   rules). It installs with `bun install --frozen-lockfile --ignore-scripts`,
   checks that root Git hooks did not change, copies each tree and digests
   the copy. `stage-components.mjs verify` re-checks the staged folder and,
   after `tauri build`, the bundled copy.
2. On the target, `Components::discover` finds `components\dist-manifest.json`
   beside the runtime (or under `LUUNA_COMPONENTS_ROOT`, which the startup
   helper sets to the packaged folder), checks the manifest hash, the pinned
   commits, the Bun hash and every tree digest at discovery, and the Bun
   version and the component's digest again before every call. A mismatch is
   refused by component name (`ComponentError::Distribution`).
3. `luuna-runtime doctor` prints the layout kind and root under `components`
   and the Bun version and path under `bun`.

## Build

```powershell
npm ci --ignore-scripts
npm run components:setup          # the source checkout must verify before staging
powershell -NoProfile -File scripts/package-windows.ps1            # release profile
powershell -NoProfile -File scripts/package-windows.ps1 -DebugBuild
powershell -NoProfile -File scripts/package-windows.ps1 -SkipComponents   # component-less installer, debugging only
```

The script writes `apps/desktop/src-tauri/target/<profile>/package-report-<utc>.json`
with the installer's SHA-256, the staged component commits and digests, the
Bun version and `clean_machine_test: not executed by this script`. Keep that
report with any evidence; it is build output, not product evidence.

## Clean-machine procedure (not yet executed)

Use a Windows 11 x64 host (physical or a fresh virtual machine snapshot) that
has never had the Luuna checkout, Rust, Bun or a `.luuna` directory. Record
the host and every command's output in a new directory under
`docs/evidence/`; do not commit tokens, keys or provider transcripts.

1. **Prerequisites only.** Install Node.js 24.19 or newer, Git 2.43 or newer
   and Python 3. Confirm `where bun` finds nothing and no `LUUNA_*` variable
   is set.
2. **Install.** Run the installer from the package report. Record the
   installed path and the SHA-256 of `luuna\luuna-runtime.exe` and
   `luuna\bun\bun.exe`; they must match the report.
3. **Doctor before configuration.** From the installed `luuna` folder, run
   `.\luuna-runtime.exe doctor --json --data-dir "$env:USERPROFILE\.luuna\windows"`.
   Expected: `git`, `node`, `pi` and `data_dir` ok; `components` ok with
   `portable layout at <installed path>`; `bun` ok with `bun 1.4.3 at
   <installed path>\bun\bun.exe`; `api_token`, `provider_credentials` warning.
   If `components` is a warning, the portable verifier refused the layout:
   stop and record the reason.
4. **Configure and start.** Run `Configure Luuna.cmd` with a provider key,
   then start the desktop. The automatic connection of ADR 0011 must succeed
   without a checkout. Record `.luuna\logs\runtime.log` contains no
   `component` refusals.
5. **Components.** Register a disposable Git repository as a project, select
   **Enable components**, create a ticket (Missions), create and search a
   project memory (Atlas), create and preview a prompt (Beacon), and run
   `GET /api/v1/projects/{id}/components`. Expected: every call succeeds and
   the component status names the private workspace. This exercises the
   staged trees through the runtime's bounded CLI bridge on the staged Bun.
6. **Tampering is refused.** Stop the runtime, append one byte to
   `luuna\components\atlas\package.json`, start again and repeat the memory
   search. Expected: the request is refused with the Atlas distribution
   mismatch and `doctor` reports `components` as a warning naming `atlas`.
   Restore the file (reinstall) and confirm the search works again.
7. **Terminal client.** Run `Luuna Terminal.cmd projects --json` and
   `Luuna Terminal.cmd` interactively. Expected: the project list is printed
   without prompting for a token and the interactive workbench opens; no
   token appears in any output or log.
8. **Shutdown and persistence.** `Stop Luuna.cmd`, then start again; the
   project, ticket and memory must still be present.
9. **Record.** Add the results, the package report identity and the host
   description to `docs/WINDOWS-VERIFICATION.md` and update the status line
   at the top of this page.

A failure at any step is a finding against the installer, not against the
checkout-based verification already recorded; both remain required.

## Not covered

- macOS and Linux have no packager or native bootstrap; the portable layout
  and verifier are platform-neutral and can be staged with
  `node scripts/stage-components.mjs stage --out <dir> --bun <bun>` for a
  manual `LUUNA_COMPONENTS_ROOT` test, but no evidence exists.
- Signing, a host update policy and service supervision are unchanged
  (ADR 0018).

The packager starts the staged terminal client once (`luuna-tui.exe --help`) before building the installer.
