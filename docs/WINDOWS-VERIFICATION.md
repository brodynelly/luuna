# Windows development setup and verification

## PR 11 follow-up: current acceptance status

See [PR 11 Windows verification](PR-11-WINDOWS-VERIFICATION.md) for the review
fixes, 349 passing Rust checks including explicit integration/benchmark runs,
passing native/browser and fixture suites, and preservation evidence. Strict
genuine-provider M3 is still open: the final clean-revision run passed 59/61,
with no candidate produced for its blocking-review probe. One existing Windows
large-index stress fixture remains skipped. The installed build was preserved;
PR 11 was not merged or deployed. The successful earlier results below remain
historical evidence for their stated revisions.


Date: October 21, 2026. This is Windows evidence, separate from the historical
Linux reports and the original documentation validation report.

## Strict M3 harness portability follow-up

The clean-revision fixture attempt on performance commit `839e46a` passed all
workflow scenarios but only 65/68 total assertions. Windows had no harness-wide
descendant owner, making the final leak scan untrusted. The ignored-file audit
also exceeded its byte bound because Git collapsed `.tools/` into one ignored
parent and the documented dependency exclusions were not applied recursively.

The harness now starts under `scripts/windows-m3-job.py`: a fresh kill-on-close
Job Object owns Node before it resumes, including detached descendants and
descendants of a hard-killed runtime. Before scanning artifacts, the helper
verifies membership on opened handles, stops owned survivors and waits for the
job to contain only the harness and its short-lived inspection helper. Missing
ownership or failure to drain remains a failed acceptance check. Tests cover
detached grandchildren, breakaway requests, supervisor death, an unrelated
live process and missing ownership. This is test-process ownership, not a
sandbox or a change to approval/runtime policy.

Ignored-file hashing now applies the existing target/node_modules/dist
exclusion at every depth, while retaining other ignored configuration and the
original entry/byte/depth bounds. Git metadata and fixture snapshots retain
every file by default. `npm run test:smoke-harness` covers both fixes; results
from fresh committed acceptance runs are recorded separately below.

### Strict M3 acceptance result

Both strict suites passed on clean commit
`974ff0e464919055c9566a1b3daf25565a98d55c` after the performance changes were
committed as `839e46a`. Fixture mode passed **68/68** assertions; genuine
OpenRouter / `openai/gpt-4.1` mode passed **61/61**. Each invocation built its
own runtime from the recorded revision with pinned Rust 1.90.0 and ran with
Node 24.19.0. Real mode verified all 16,480 installed Pi tree entries against
a fresh integrity-checked install of the tracked lockfile (Pi 1.3.0).

Coverage includes exact approval, a scoped feature, failing checks followed by
manual repair and fresh independent review, blocking findings with bounded
automatic repair, in-flight review cancellation, hard-kill/restart recovery,
conservative spend reservation and orderly authenticated shutdown. The real
blocking probe produced no fresh repair candidate and correctly paused with
repair closed; it was not counted as a successfully implemented requirement.
Fixture mode additionally exercises malformed review output and re-validation.
Both runs preserved the developer and Luuna checkout audits, drained owned
Windows descendants, and completed their artifact scans with zero credential
leaks or unreadable files. Windows uses checked paths rather than Linux's held
directory handles; this recorded platform distinction remains unchanged.

Reproduction from a clean checkout, with pinned Node first on PATH and an
existing DPAPI-saved provider configuration:

```powershell
node scripts/m3-smoke.mjs --mode fixture --out "$env:USERPROFILE/.luuna/verification/strict-m3-fixture-974ff0e"
.\scripts\with-windows-provider.ps1 -Smoke m3 -Model 'openai/gpt-4.1' -Out "$env:USERPROFILE/.luuna/verification/strict-m3-real-974ff0e"
```

Use new, empty output directories when repeating these commands. Private
`report.json` and `report.md` files are retained in those directories; no real
transcripts or credentials are committed. `npm test` also passed: 24 contract,
6 scope-guard, 8 component-pin, 5 smoke-harness, 221 desktop and 28 API-client
checks. JavaScript syntax, repository hygiene and diff checks passed. The
acceptance results identify the code revision above; the subsequent evidence
documentation commit does not change executable code or harness behavior.

This closes strict Windows M3 acceptance for these scenarios. It does not
establish signed installation, packaged service supervision, other operating
systems or full-v1 completion. The installed optimized app/runtime were not
replaced by the disposable acceptance builds.

## Latest result: merged design system and component workflows

The component work was combined with current `main` and its desktop design
system in [PR 10](https://github.com/brodynelly/luuna/pull/10). The rebuilt
native frontend passed 27 component and 55 lifecycle/presentation checks,
including both colour schemes. Browser checks passed 23 component and 57
lifecycle/presentation assertions, including 760 px layout. Pinned Node 24.19.0
checks exposed and verified a Windows verbatim-path/junction scope-guard fix.
The final runtime passed 185 Rust tests with 10 explicit ignores, formatting
and Clippy, and was restored with existing state and credentials. See
[the complete accounting and artifact identities](MAIN-INTEGRATION-2026-10-21.md).

## Earlier result: component integration and final development upgrade

The final component-enabled runtime was installed and started on October 21,
2026 after the user chose unsigned development and switched Smart App Control
Off in Windows Security. Existing saved history, token, data directory and
encrypted provider bytes were preserved. The normal desktop is connected.

The final runtime SHA-256 is
`99d9521784bc373237ef4d65b3bdd6189f3290faf557fad2946705f39d890256`;
the bundled desktop SHA-256 is
`21ddca8c75b1bb709bcd2886b6362e809b6d8aa6cc048447f94df74ce2591f4f`.
Actual native WebView2 checks passed **27/27 component workflows**, **46/46
lifecycle/recovery checks** and **17/17 automatic startup checks**. Component
CLIs and Git/unittest checks were real; Pi writer/reviewer fixture sessions were
synthetic. See the [final evidence](FOUNDATION-STATUS.md#final-windows-native-verification-and-completed-development-upgrade)
and [component workflow guide](COMPONENT-WORKFLOWS.md). No new genuine-provider
component workflow or signed installer is claimed.

## Earlier result: automatic native startup and connection

Before remote publication, the final Windows tree passed `cargo test --locked
--workspace` (**174 tests**), root Rust formatting and Clippy with warnings denied,
native formatting/Clippy and its one contract test, `npm test`, frontend
typechecking/build, PowerShell/JavaScript syntax and repository hygiene checks.
The first root test invocation hit the running executable's Windows file lock;
the idle service was stopped through the authenticated API, the full suite
passed, and the service was restored with its existing state and credentials.
No new provider requests were made for these publication checks.

The native app now starts or authenticates/reuses the independent Windows
runtime and connects on launch or reload without copying a token (ADR 0011).
`node scripts/windows-native-startup-smoke.mjs` passed **17/17 checks** in the
actual bundled WebView2 app. It proved warm PID reuse, normal WM_CLOSE, cold
startup after explicit shutdown, refusal of a foreign listener before any HTTP
request, automatic retry, reload, concurrent windows using one runtime,
disconnect/reconnect, preserved data/history and unchanged encrypted provider
bytes. Browser local/session storage stayed empty. The test launched from a
different working directory. All test windows closed normally and the runtime
remained healthy.

The final normal executable was then opened without debugging flags and its
actual window reported `Local runtime connected`, with the existing reviewed
workflow history. It was left open. Native binary SHA-256:
`36e00f6e0d12c73163f316efce6f23a9d9e1afc2ea3adfe66a2b3ed67403c843`.
The private report and screenshot are in
`%USERPROFILE%\.luuna\verification\native-startup-846e1ffd`.

The browser fixture regression passed **46/46**, including approval, writer,
candidate/review, shutdown interruption and recovery. Evidence is in
`%USERPROFILE%\.luuna\checks\auto-browser-1c6b3ca0`. The first attempt lacked
Playwright's bundled Chromium; the passing retry used the installed Edge through
`LUUNA_CHROMIUM`. No browser installation was needed. Earlier native startup
attempts are preserved: the first exposed string-error display, the next two
exposed Windows descendants retaining a pipe handle. Native startup now consumes
a bounded JSON line with a reply timeout instead of waiting for runtime-lifetime
EOF. Neither failure was counted as successful startup evidence.

The complete native fixture workflow also passed **46/46** on the same binary,
including wrong-token refusal, baseline, exact approval, writer, candidate
diff/checks, independent review/re-validation, crash recovery, explicit shutdown
and conservative interrupted-review spend. Its report is in
`%USERPROFILE%\.luuna\checks\auto-native-0357fa93`. The harness now waits for
automatic startup to settle and explicitly disconnects its test view before
switching to the isolated fixture runtime. The preceding attempt,
`auto-native-10dc1b93`, passed 44/48: its four failures were unreliable WebView2
CDP Tab/Enter delivery after that switch. Native coverage now exercises the
actual skip-link click/focus target and native form controls; browser coverage
retains the four keyboard assertions. No native keyboard-only claim is made.

Affected-code checks passed: `cargo test --manifest-path
apps/desktop/src-tauri/Cargo.toml --locked` (one native contract test), native
`cargo clippy ... --locked --all-targets -- -D warnings`, native `cargo fmt`,
the locked bundled Tauri build, `npm test` (20 schema, 6 guard, 16 desktop and
22 API-client checks), `npm run typecheck`, PowerShell parsing, JS syntax and
`git diff --check`. Root runtime Rust tests were not repeated for this client
change; their preceding shutdown evidence remains below. No new provider request
was needed for this startup change. Signed installation and Windows service
supervision remain separate work.

## Previous result: shutdown and native desktop

The three prior Windows shutdown failures are resolved by the authenticated
service-stop path in ADR 0010. `windows-shutdown-ui-1` passed 46/46 browser
checks; `windows-native-ui-2` passed 48/48 inside the actual bundled Tauri
WebView2 window. Both exercised shutdown during checks, exit code zero,
interruption with the shutdown reason, restart and fresh validation. The native
test also verified runtime independence after terminating its test client.
Keyboard-only form entry remains browser evidence: native WebView2 CDP input
needed DOM filling for the fixture URL/token. The first native run's input
delivery failure is retained in `windows-native-ui-1`.

`windows-shutdown-m1-real-1` passed all 20 genuine OpenRouter/Pi connectivity
checks, including authenticated clean shutdown. The full final Windows Rust
suite passed 173 tests; a subsequent idle-SSE shutdown regression also passed
with all 12 runtime API tests. The stream now closes on service stop even when
its workflow is idle, preventing it from holding HTTP shutdown open. Formatting,
Clippy with warnings denied, npm tests and TypeScript checks passed. One
pre-existing test needed to reopen the service
after shutdown: rescheduling in the stopped instance now correctly returns 503.

The native build succeeded on a normal retry and the supported Tauri build
command below. No Application Control policy or security setting was changed.
The packaged frontend no longer contains Chromium's rejected IPv6 CSP source.
Normal launch uses no WebView2 remote-debugging flag; the temporary debugging
endpoint is restricted to test-owned WebView2 profiles and ends with the test.

Previous native executable: `apps/desktop/src-tauri/target/debug/luuna-desktop.exe`,
SHA-256 `7e959837b19fdfce7a1f5fd96c3f2cf0812567f4107dfa98a88e544f30e801bd`.
Final runtime SHA-256: `066ffb05758ef2ed263137cfaf4a219bf82167d7562cede3d7ba43ff07b403b5`.
A normal native app and the independent updated runtime were left running on
the prior diagnostic data, with its two reviewed real-provider candidates.

The explicit Windows stop script was exercised: the runtime exited cleanly and
the native window remained alive. Repeated native launches reused the same
client and verified runtime rather than duplicating processes. The launcher
refuses a different data directory while a runtime is live. A separate attempt
to test normal Alt+F4 closure was blocked by detected human input; no normal
window-close result is claimed from that attempt. Credential files and earlier
evidence were preserved. Signed installers, installed Windows service
supervision, arbitrary descendant containment/job objects, the backup/migration
drill and strict clean-revision M3 acceptance remain separate open work.

## Packaged distribution

`scripts/package-windows.ps1` now stages the pinned Missions/Atlas/Beacon
trees with their distribution manifest, Bun 1.4.3 and the terminal client
beside the runtime ([ADR 0024](decisions/0024-portable-component-distribution.md)).
The layout, its verification and the clean-machine procedure are in
[PACKAGING.md](PACKAGING.md). That procedure has not been executed: no
installer carrying components has been built or installed on any Windows host
yet, and no result is recorded here.

## Run locally

From this checkout in PowerShell:

```powershell
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix tools/pi
cargo build --locked -p luuna-runtime
npm run tauri --workspace @luuna/desktop -- build --debug --no-bundle --ci -- --locked
powershell.exe -NoProfile -STA -File scripts/set-windows-provider.ps1
powershell.exe -NoProfile -STA -File scripts/start-windows.ps1 -Native
```

After setup, double-click `Configure Luuna.cmd` to replace the key, or
`Start Luuna.cmd` to open the native development app; `Stop Luuna.cmd` requests
authenticated orderly runtime shutdown without closing the client. A second
native launch reuses the verified service/window; unrecognized occupied ports
are refused. Omitting `-Native` launches the Vite/browser client. During this verification
the launcher was given the successful diagnostic's existing data directory, so
the running client can inspect the two genuinely reviewed fixture workflows.

The first window accepts a masked OpenRouter, OpenAI, or Anthropic API key.
It encrypts the value with Windows DPAPI for the current account in
`%USERPROFILE%\.luuna\credentials\provider.json`. Existing encrypted
LocalAppData records are copied once when the new files are absent; originals
are retained. No plaintext key is saved in
the repository. Saving a key does not call a provider. Same-account processes
can decrypt DPAPI data; this is storage protection, not a sandbox.

The native app starts the runtime independently and connects automatically; no
connection dialog or token entry is needed. You can also open the built
`apps/desktop/src-tauri/target/debug/luuna-desktop.exe` directly from Explorer.
The app depends on this checkout and its built runtime, Node and pinned Pi
dependencies. Explicit Disconnect stays disconnected until you choose Connect
automatically or reopen/reload the app. Browser mode at
`http://127.0.0.1:1420` retains the masked token/Copy dialog and manual form.
The runtime address is `http://127.0.0.1:4242`. Closing either client leaves the
runtime running. Private metadata and encrypted token are in
`%USERPROFILE%\.luuna\credentials\connection.json`; logs are in `.luuna/logs`.
After replacing a provider key, explicitly stop and restart the runtime to load
the new key. A warm app launch preserves the current service configuration.

Runtime data uses `%USERPROFILE%\.luuna\windows`. A Store-packaged host can
redirect LocalAppData into a substantially longer package path. With this
machine's Python 3.11, long candidate paths caused unittest discovery to report
zero tests, or explicit module import to fail. The runtime blocked these
results correctly. Keep runtime worktree paths short; long-path compatibility
across arbitrary tools is not established.

The defaults are OpenRouter `openai/gpt-4.1-mini`, OpenAI `gpt-4.1-mini`, and
Anthropic `claude-sonnet-4-5`. Only the OpenRouter profile was exercised here.
The API accepts per-action provider/model overrides; the others are setup
choices, not verified provider claims.

## Earlier Windows pass, before the shutdown/native fixes

- A genuine Pi 1.3.0/OpenRouter response streamed through the Windows runtime.
  Authentication refusal, replay, cancellation with Pi reaping, invalid-model
  failure, restart interruption, history retention and exclusive data ownership
  passed the M1 smoke. Its orderly-shutdown signal check failed.
- The current-tree real-provider diagnostic passed 16/16 checks on its seventh
  run: actual Python baseline; missing-approval refusal; exact-plan approval;
  a real scoped writer; stale-candidate refusal; required commands; a fresh
  independent reviewer; deliberate failing check; manual repair revision;
  fresh checks/review; and unchanged fixture developer checkout.
- Browser fixture testing exercised import/discovery, baseline, acknowledgment
  before approval, candidate diff/logs, invalid review and re-validation,
  crash/reconnect recovery, reserved spend after interrupted review,
  keyboard controls and accessibility checks. It is synthetic model evidence.
- Root npm tests, frontend type checking and production web build passed.
  Component CLI suites were not rerun and those tools remain unintegrated.

Final checks on the changed working tree: `cargo test --locked --workspace`
passed 172 Windows tests (Unix-only tests are excluded); `cargo clippy --locked
--workspace --all-targets -- -D warnings` and `cargo fmt --all -- --check`
passed. `npm test` passed 20 schema checks, 6 scope-guard tests, 13 desktop tests
and 22 API-client tests; `npm run typecheck` and `npm run build` passed. Hygiene,
JavaScript syntax, PowerShell parsing and `git diff --check` passed. Host tools
were Rust 1.90.0, Node 26.10.0, npm 11.19.1, Python 3.11.9 and Git 2.55.0.windows.5;
Node/npm were the existing newer supported tools, not the recorded Linux pins.

The final browser fixture smoke (`windows-ui-20261021-3`) passed 43/46 checks.
Its only failures were the three orderly-shutdown assertions. Registration,
baseline, exact approval, writer/diff, check logs, fresh review/re-validation,
crash recovery, reserved-spend refusal and keyboard/accessibility checks passed.
The service and client were then launched separately: authenticated history
showed two `reviewed` workflows and the `completed` baseline, the web client
returned HTTP 200, and a visible `Luuna` browser window and connection dialog
were observed. The running service executable was this checkout's
`target\debug\luuna-runtime.exe`, SHA-256
`23b1b136983f01e0f71afd5bb62c796828071b4fc5eaffb71ab17d6cd446d11d`.

Private diagnostic artifacts are under `LocalAppData\Luuna\verification`.
The successful real diagnostic is `windows-workflow-real-20261021-7/report.json`.
It records binary/source identity and the separate short runtime-data directory.
Earlier failed runs are retained. This diagnostic allows the explicitly dirty
working tree and is not a substitute for strict M3 acceptance.

Reproduce a current-tree real-provider diagnostic after saving a key:

```powershell
.\scripts\with-windows-provider.ps1 -Smoke windows-workflow -Out C:\path\to\new-report-directory
```

The diagnostic uses disposable fixture repositories and a bounded approved
budget for each scenario. It makes provider requests and can incur charges.
Secrets are decrypted only into the child process environment and restored
afterward. Do not commit its output or real session artifacts.

## Fixes and open issues

1. Fixed the scope guard's comparison of Rust verbatim Windows paths and Pi's
   ordinary paths. Genuine reviewers previously rejected their own worktree.
   The new Windows test retains junction-escape and read-only enforcement.
2. Scope tests use Windows directory junctions instead of privileged symlink
   creation. No system privilege or security setting was changed.
3. Browser smoke starts Vite through Node, avoiding direct `.cmd` spawning,
   and matches registered Git identity across Windows path virtualization.
4. M3 harness Git configuration uses `NUL` on Windows, rather than Node's
   `\\.\nul`, which Git rejected. The strict harness has not passed on Windows;
   Linux-only descendant containment and clean-revision evidence remain gaps.
5. Shutdown probes now require exit code zero before claiming orderly shutdown.
   Node SIGTERM/SIGINT kills on Windows did not exercise the runtime Ctrl+C
   handler. Native console-control/service supervision remains to be proved.
6. The initial native Tauri build was blocked by Windows Application Control when executing
   a generated `generic-array` build script (OS error 4551). The later normal
   retry and native GUI proof are recorded above. Installer success remains
   unproved; no policy setting was bypassed or changed.
7. The Rust reviewer-timeout test had a host-timing assumption: candidate-stage
   time need not consume eight seconds when writer/startup spent more of the
   aggregate budget. It now checks the actual exhausted-budget repair refusal.
8. Windows executor descendant ownership/job objects, backup/migration drill,
   native service packaging, component integration, TUI, multi-repository work
   and publication remain unverified or unimplemented as previously documented.

The native process checks retain host permissions. A green fixture run does
not establish provider behavior or operating-system containment.
