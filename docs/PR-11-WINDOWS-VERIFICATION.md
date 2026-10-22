# PR 11 Windows review fixes and preservation evidence

Date: October 21, 2026 (America/Chicago). PR: [#11](https://github.com/brodynelly/luuna/pull/11).
The PR remains open and unmerged. **The confirmed review fixes are complete, but strict genuine-provider M3 acceptance remains open: the final run passed 59/61 checks.** The local Rust/frontend, native/browser lifecycle, component and fixture suites passed, with one existing Windows-disabled stress fixture.

This record is Windows product evidence,
separate from the original documentation validation report and historical Linux results.

## Revisions and preservation

Product fixes are in `f9def0900b68404c3b03dd158bc093cde911ae80`.
Acceptance-harness corrections are in `a5ff089` and `631ed21` (the final clean strict-M3 test revision).
The subsequent evidence commit changes documentation only. These commits descend
from the existing audit branch and retain all of main at `24a7e4a`.

- Installed runtime and desktop executable SHA-256 hashes are unchanged. Builds
  and test services used separate output directories, disposable stores and fixtures.
- The live database still matches the pre-test snapshot row-for-row across all
  23 tables, including migration metadata. Its service remains authenticated.
- A SQLite online backup was upgraded in a disposable directory. All 924 existing
  rows across 22 historical tables survived unchanged; schema 9 and the automatic
  pre-migration snapshot were verified. No migration ran against the live store.
- The encrypted provider file is byte-for-byte unchanged. Native warm startup
  refreshed connection metadata through the existing bootstrap; the existing
  runtime and token still authenticate. Connection-file ciphertext is therefore
  not claimed byte-identical.
- Missions, Atlas and Beacon gitlinks and manifest pins are unchanged. Historical
  logs, plans, approval/evidence records, worktrees, requirements and ADRs remain.
  No installation, merge, automatic publication or component-internal change was made.

## Review issues fixed

| Issue | Result and regression evidence |
| --- | --- |
| Deleted Python application module reported as infrastructure | An absent module alone stays an ordinary failure; external classification requires a bounded explicit requirements declaration. Executor tests cover deletion and a declared missing dependency. |
| Relative and absolute SSH paths conflated | Repository keys preserve path scope; domain tests distinguish SCP relative/absolute/URI paths. |
| Concurrent backup overwrites a snapshot | Verified snapshots publish with atomic no-replace hard links; a competing destination wins without being overwritten. Unsupported filesystems fail closed. |
| Historical uppercase artifact names lost | Safe legacy filename fallback preserves API access and digest-checked repair feedback without renaming evidence. |
| Bad metadata/event aborts orphan recovery | Startup reads state columns and decodes individual ownership events independently; malformed ownership grants no termination authority. |
| Baseline ends before its record and leaves polling stuck | Poll state updates after failure-reason loading; native and browser smokes exercise early identity rejection and an enabled retry control. |
| Server permits a new plan during live work | Transactional ticket-wide guard covers all plan IDs, active attempts, leases and candidate checks/review; waiting candidates may still be superseded. |
| Rebind leaves old authorization usable | Identity-changing rebind withdraws current manifest confirmation; approval/execution require reconfirmation. Append-only manifest history remains accessible. |
| Truncated diff says no changes | Client displays truncation, omitted-file information and drift. |
| Approver cannot see cumulative ticket usage | Ticket details display prior workflows, attempts, repairs, time and recorded/reserved cost before plan approval, including unpriced-usage caveats. |
| Identity recovery errors contain placeholders | Errors include concrete project/repository rebind routes; UI smoke verifies the actual route. |
| Restore can leave a partial database swap after process death | Durable restore intent rolls forward before SQLite opens; original database/sidecars remain preserved. Windows tests cover every move boundary and installation-before-finalization. This is process-interruption recovery, not hardware power-loss certification. |
| History paging loses selection and controls | Selection is reconciled with each page; browser test pages between completed and running sessions and checks cancellation controls. |
| Workflow replay accumulates full histories | Each bounded page is reduced and discarded before the next fetch; tests require reduction before subsequent reads and reject replay gaps. |

## Windows verification

Pinned Rust 1.90.0, Node 24.19.0, npm 11.9.0, Bun 1.4.3, Python 3.11,
and the installed Edge/WebView2 were used for project checks. The strict Pi-provenance installer intentionally uses npm bundled beside the pinned Node executable (11.17.0 in this distribution), with empty npm configuration, as required by the repository harness. Native testing ran the explicitly
hashed bundled Tauri executable built with `tauri build --debug --no-bundle`.
A plain debug Cargo build is not treated as bundled-client evidence.

| Check | Result |
| --- | --- |
| Rust workspace, all targets, serial test execution | 338 passed, 12 explicit ignores in the normal invocation |
| Explicit real component integration tests | 8 runtime tests, 1 component CLI test and 1 writer/reviewer source-drift test passed |
| Explicit storage history benchmark | 1 passed; 10,000 runs, indexed first 200 median 2.629 ms in this run |
| Remaining ignored test | 1 existing Windows-disabled large-index fixture requiring paths beyond MAX_PATH or about 90,000 files; not executed |
| Rust formatting and Clippy with warnings denied | Passed |
| Frontend/contracts/harness tests | 248 desktop, 36 API-client, 29 contracts, 10 guard, 8 pin and 7 harness checks passed |
| Type checking, frontend/native build and repository hygiene | Passed |
| M1 fixture / genuine provider | 19/19 synthetic; 20/20 genuine OpenRouter `openai/gpt-4.1` |
| Strict M3 fixture / genuine provider | 69/69 synthetic; final genuine run 59/61 (failed blocking-probe candidate creation; acceptance remains open) |
| MVP lifecycle and presentation | 64/64 browser; 62/62 bundled native WebView2 |
| Actual Missions/Atlas/Beacon UI workflows | 23/23 browser; 27/27 bundled native; real CLIs and checks, synthetic Pi |
| Large-history browser | 10,000 events, 200 visible rows, no idle event-DOM mutations; payload expansion, append/paging, selected-run controls, both themes at minimum width and disconnect passed |
| Copied-data upgrade and live-data preservation | Passed as described above |

Strict M3 checks bind the runtime to clean build inputs and the pinned compiler;
verify the installed Pi tree against a fresh integrity-checked lockfile install;
exercise exact approval, scoped changes, failing checks, independent review,
repair budgets, cancellation, hard-kill recovery and shutdown; preserve both
checkouts; drain the Windows-owned descendants; and scan artifacts for credentials.
The strict fixture run passed all 69 checks with zero leaks or unreadable files.
The final genuine run at `631ed21f12a7a05ff60c8623624c04605e218e20` passed feature, manual repair with fresh checks/review, cancellation, restart, preservation, cleanup and leak-scan checks. Its blocking-review scenario produced no writer change, so Luuna correctly failed that attempt without a candidate; the independent-review/automatic-repair probe was not reached in that invocation. Both the scenario assertion and its prerequisite failed, yielding 59/61. The leak scan found zero credential leaks, unreadable files or incomplete traversal. This is **not** a passing complete genuine-provider M3 run.

## Reproduction and evidence locations

Use pinned Node/npm first on PATH, and an isolated `CARGO_TARGET_DIR`; do not
replace the installed executable while it is running. Commands actually used:

```powershell
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets --locked -- --test-threads=1
cargo test --locked -p luuna-runtime --lib -- --ignored --test-threads=1
cargo test --locked -p luuna-components --test real -- --ignored --test-threads=1
cargo test --locked -p luuna-runtime --test writer -- --ignored --test-threads=1
cargo test --locked -p luuna-storage --test history -- --ignored --nocapture
npm test
npm run typecheck
npm run tauri --workspace @luuna/desktop -- build --debug --no-bundle --ci -- --locked
node scripts/check-hygiene.mjs
node scripts/performance-ui-smoke.mjs --browser '<installed Edge executable>'
node scripts/m1-smoke.mjs --mode fixture --runtime '<isolated runtime>' --out '<new directory>'
.\scripts\with-windows-provider.ps1 -Smoke m1 -Model 'openai/gpt-4.1' -Runtime '<isolated runtime>' -Out '<new directory>'
node scripts/m3-smoke.mjs --mode fixture --out '<new directory>'
.\scripts\with-windows-provider.ps1 -Smoke m3 -Model 'openai/gpt-4.1' -Out '<new directory>'
node scripts/mvp-ui-smoke.mjs --runtime '<isolated runtime>' --out '<new directory>'
node scripts/mvp-ui-smoke.mjs --runtime '<isolated runtime>' --native '<bundled desktop>' --out '<new directory>'
node scripts/m6-ui-smoke.mjs --runtime '<isolated runtime>' --out '<new directory>'
node scripts/m6-ui-smoke.mjs --runtime '<isolated runtime>' --native '<bundled desktop>' --out '<new directory>'
```

Private logs are under `.luuna/verification/pr11-windows` in the developer's home.
JSON/Markdown reports and UI images are in sibling `pr11-*` acceptance directories:
`pr11-m1-fixture`, `pr11-m1-real`, `pr11-m3-fixture-631ed21`,
`pr11-m3-real-631ed21`, `pr11-browser-ui-final`, `pr11-native-ui-final`,
`pr11-browser-components-final2` and `pr11-native-components-final2`.
Real transcripts, credentials, copied personal databases and private reports are
not committed. Only this sanitized evidence summary is tracked.

Earlier failures remain in those private logs. They exposed Windows path spelling,
hidden-file fixture writes and stale harness assumptions: a fixed idle-poll
sleep shorter than the new poll interval; a restart waiting for pipe closure
before reviewer reconciliation; replanning without the supersede checkbox; and matching only the older no-candidate wording rather than checking the failed second attempt.
The final tests exercise the corrected paths. The M3 rerun observed SIGKILL process
exit while stderr was still open, then required the log to drain after the reviewer
exited. Final cleanup/leak gates were retained. The normal parallel Rust attempt
hit timing-sensitive writer waits under concurrent Windows load; the complete
serial suite passed. A rebuild attempted while a disposable test runtime was
running hit Windows' executable lock and was rerun after that service stopped.

Two earlier genuine M3 attempts also recorded model-generated Python syntax errors during manual repair. The first passed 61/62 checks; the second passed 60/62, including the outdated no-change assertion as its other failure. Luuna failed those candidates before review. The reports remain available; No complete genuine-provider M3 invocation passed every check in this session, and the final successful manual repair does not establish that model repairs always succeed.

This establishes the listed Windows scenarios, not universal failure-freedom,
signed installation, newly tested cold bootstrap, Mac/Linux acceptance on these
commits, or full-v1 completion. The native bootstrap code was unchanged and its
prior platform evidence remains historical. No merge was performed.
