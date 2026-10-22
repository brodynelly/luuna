# Performance review — October 21, 2026

## Follow-up: bounded execution and optimized Windows upgrade

The October 21 follow-up implements ADR 0015. The first-pass findings and
measurements below remain historical evidence, not the current list of defects.

| First-pass finding | Follow-up disposition |
| --- | --- |
| Large session history / retained payloads | Indexed keyset run pages; event pages capped at 200 and about 1 MiB; one historical page loaded on demand; bounded live event window and incremental bounded assistant display. Legacy full-history routes remain compatible. |
| SQLite blocking Tokio I/O | Authenticated requests use at most 32 blocking tasks; existing four-run admission also bounds workers. SSE has 16 stream slots and bounded blocking reads. Health/shutdown remain reachable at request capacity. Transaction boundaries and FULL durability are unchanged. |
| Workflow refresh fan-out | Four-way concurrency; settled snapshots reused; explicit refresh, actions, reconnect and component changes invalidate snapshots. Source observations are display snapshots; runtime source/approval checks still run. |
| Noisy checks | 64-slot nonblocking display queue, at most 100 excerpts per stream, bounded version probes. Both artifact streams still drain and retain their capped, hashed evidence. |
| Windows check descendants | Suspended creation, Job Object assignment before execution, kill-on-close ownership. Real child/grandchild assertions now run on Windows; the stalled-consumer test drains 40 MiB of output without unbounded progress or blocked pipes. Executor tests finish in about four seconds. |
| Development-profile installation | Both runtime and desktop built in optimized release mode; the installed checkout-based paths are retained for existing launchers. Installation verification is recorded below. |

### Installed Windows result

The existing checkout-based Windows installation was upgraded after confirming
it had no active work. The previous executables, SQLite database and encrypted
connection/provider records were backed up under
`%USERPROFILE%/.luuna/verification/performance-upgrade-20261021-183141`.
Saved run records, connection token identity, data-directory identity and provider
record bytes were verified unchanged. No plaintext credential was logged.

- Installed runtime: `target/debug/luuna-runtime.exe`, now an optimized release
  binary despite the retained development-launcher path. SHA-256
  `74fb9ad1964675bf7b1bcab5c19c5d3939f32addb86878d68ae8e8c4292441a6`.
- Installed desktop: `apps/desktop/src-tauri/target/debug/luuna-desktop.exe`,
  optimized release binary, SHA-256
  `596df0c08d54d9d1d6280b9b546a013efcf39caa82e90fd0b6c909dc3bef1662`.
- Final runtime content identity:
  `sha256:3924f254ad3d284fd4745b3c0da0a65379205a4642545eddd9d8c9e8ccbf0991`.
  The final rebuild includes additional test source in that digest; production
  behavior is unchanged from the earlier native/provider workflow smokes. The
  final binary separately passed genuine-provider M1 **20/20** and installed
  native startup **17/17**.
- Startup checks: automatic private IPC connection, warm reuse, cold retry,
  foreign-listener refusal, concurrent windows, reload, disconnect, preserved
  history/credentials and runtime survival after all windows close. Evidence:
  `%USERPROFILE%/.luuna/verification/native-startup-61225f0a/report.json`.
- One observed warm launch-to-connected: **3.792 s**. Cold retry plus concurrent
  launch-to-connected: **5.603 s**. These include PowerShell identity checks,
  WebView2 profile creation and test observation; neither is a controlled median
  nor a signed-installer benchmark.
- Finally launched the ordinary installed desktop again. Its actual process
  path/hash matched the upgraded executable; its visible window responded and
  the runtime health endpoint answered. `final-window.json` in the upgrade
  directory records this check. The app is left open, with its independent
  runtime running. A later ordinary debug build can replace these release
  binaries at the development paths; no distribution/update service is implied.

### Follow-up measurements

- 10,000 synthetic runs, nine warmed debug samples: original N+1 median
  361.965 ms, complete single-query history 81.362 ms, first indexed 200-run
  page **1.762 ms**. These are different workloads; the page returns 200 rows,
  while the complete-history measurement returns all 10,000.
- Browser stress: 10,000 events, about 10 MiB, at most 200 displayed rows.
  First-page rendering was 217 ms in one run and 956 ms during concurrent
  builds/tests. The instrumented repeat reconstructed all 10,000 records in
  3.20 s. No controlled median or universal speedup is claimed. Empty polls
  caused zero event-list DOM mutations; historical paging remained stable
  during append, payload expansion, both schemes at 760 px and disconnect.
- Initial assistant reconstruction still traverses history page by page;
  workflow ticket enumeration and legacy API consumers can still request whole
  lists. These are explicit scaling limits, not claims of constant-time loading
  or complete production-load profiling. A durable display projection and
  workflow pagination remain possible later slices.

### Follow-up verification

| Coverage / command | Actual result |
| --- | --- |
| `cargo test --locked --workspace --all-targets --target-dir target/performance-followup -- --test-threads=2` | **191 passed, 0 failed**, 11 explicitly opt-in tests measured separately. Includes bounded database admission/health responsiveness and terminal SSE draining across multiple pages. |
| Storage page tests | Stable ordering/ties, project filter, inserts between pages, forward reconstruction, reverse paging, byte cap and single-oversized-event progress passed. |
| `cargo test --locked -p luuna-components --test real --target-dir target/performance-followup -- --ignored --test-threads=1` | Actual pinned component CLI integration passed. |
| `cargo test --locked -p luuna-runtime --lib --target-dir target/performance-followup -- --ignored --test-threads=1` | All eight real Missions/Atlas/Beacon tests passed, including drift, idempotency, uncertain side effects and restart. |
| `cargo test --locked -p luuna-runtime --test writer --target-dir target/performance-followup -- --ignored --test-threads=1` | Component-source changes during real CLI writer/reviewer boundaries were refused; passed with synthetic Pi. |
| Native component UI | **27/27**, actual pinned CLIs, optimized WebView2, synthetic Pi, activation/reconciliation, explicit resource selection, source drift and replay. |
| `npm test` | 24 contracts, 6 guard, 8 pin checks, 221 desktop and 28 API-client tests passed. |
| `npm run typecheck`; production frontend build; workspace Clippy with `-D warnings`; format and hygiene | Passed after correcting a newly added test fixture's missing envelope fields and adding a dismiss button required by the design-system test. |
| Native Tauri Rust unit test | Passed. Release Tauri build succeeded; toolchain emitted the existing deprecated STATIC_VCRUNTIME warning. |
| Browser MVP | **57/57**, including actual runtime/check commands, restart/shutdown, accessibility, dark/light schemes and minimum width. Synthetic Pi. |
| Optimized native WebView2 MVP | **55/55**, same lifecycle plus native independent-runtime lifetime. Synthetic Pi. |
| Genuine-provider M1 | **20/20**, OpenRouter with `openai/gpt-4.1-mini`, pinned Pi 1.3.0, optimized runtime. Completion, cancellation/reap, failure and restart covered. |
| Genuine writer/repair/reviewer diagnostic | First `gpt-4.1-mini` run 15/16: model repair hardcoded the greeting, tests passed, independent review correctly returned `changes_required`. Evidence retained. Fresh `openai/gpt-4.1` run **16/16**, including exact candidate identity, actual failing check, new repair revision, fresh review and untouched developer checkout. |
| Strict M3 acceptance | **Blocked**, not passed: its clean-recorded-revision gate refuses this uncommitted checkout before execution. No gate was weakened and no commit made to manufacture acceptance. The Windows provider diagnostic is explicitly not strict M3 evidence. |

Two initial test invocations hit Windows linker file locks when another test
process held the same executable; final checks were serialized appropriately.
No product assertion was relaxed for those failures. This is Windows evidence;
macOS/Linux native clients, production-scale p95/p99, and installer/signing
remain unverified here. The original documentation validation is separate.

Private evidence is outside the repository under the user's `.luuna/verification`
folder (provider tests and upgrade) and the Windows temporary directory (smokes
and test logs). No credentials or real session transcripts are committed.

---


This review covers the implemented React client, shared API client, Windows Tauri
bootstrap, Rust runtime/storage, Pi transport, check executor, Git/discovery and
the Luuna component adapters. It does not certify maximum possible performance,
full-v1 functionality, macOS/Linux rendering, or provider response latency.
Component internals remain independently maintained submodules.

## Changes made

1. **History queries:** `Store::runs` and `Store::projects` now fetch their rows in
   one SELECT instead of listing IDs and preparing/executing one SELECT per ID.
   Shared row decoding preserves ordering, every field, and JSON error handling.
   No schema, transaction, durability, approval or candidate policy changed.
2. **Session replay:** a per-subscription `EventReplay` validates only incoming
   records, retains identity indexes, rejects conflicting/gapped pages atomically,
   and returns the same snapshot for empty/overlapping pages. Existing records
   keep their object identity. New pages still copy the snapshot's array; this is
   not a constant-memory transcript store.
3. **Workflow replay:** each workflow retains just its event cursor and latest
   reason. Subsequent refreshes request only events after that cursor instead of
   the entire transcript. Cursors commit together after successful validation and
   reset on project/client changes. Ticket sources and candidate permissions are
   still refreshed from the runtime; no freshness or authorization cache was added.
4. **Rendering:** the session event view renders at most 200 rows, with earlier,
   later and latest controls. Browsing an earlier page holds its position while
   events arrive. All events remain accessible. Closed payloads are formatted
   only when opened; error disclosures retain their initial open state. Memoized
   rows, transcript extraction and the project panel avoid unrelated work during
   typing, empty event polls and history refreshes.

These are implementation optimizations within the accepted architecture, not a
new authority, API protocol, storage format or lifecycle decision.

## Measurements

Windows, Rust 1.90.0 debug profile; synthetic disposable data only. Timing values
are local observations, not CI thresholds or end-to-end provider speedups.

| Workload | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Retrieve 10,000 saved runs, median of nine warmed samples | 1,180.364 ms | 164.052 ms | 7.20× faster; 10,001 SELECTs reduced to one. Compares the original lookup algorithm with the new implementation in the same benchmark. |
| Merge 10,000 events in 100 pages, then 100 empty polls; median of nine warmed samples | 172.345 ms | 2.160 ms | 79.79× faster for replay bookkeeping; does not include network, rendering or provider work. |
| Render a 10,000-event, roughly 10 MiB synthetic history in Edge 155 | 3,604 ms | 1,111 ms | Individual observations before/after adding paging, both already using lazy payloads. Concurrent host load varied; not a controlled median or comparison with untouched main. |
| Event DOM rows for that history | 10,000 | 200 | Remaining events are available through paging. |
| Event DOM mutations during idle polling, after load | Not measured | 0 | Verified over 3.1 seconds while polling continued. |

Workflow transcript bandwidth now scales with newly appended events per refresh,
instead of the total accumulated transcript on every refresh. No numeric network
speedup is claimed. The production JS bundle grew from 256.19 kB / 77.83 kB gzip
to 258.45 kB / 78.42 kB gzip; these changes optimize ongoing work, not bundle size.

Reproduce with:

```powershell
node scripts/performance-replay.mjs
cargo test --locked -p luuna-storage --test history --target-dir target/performance-review -- --include-ignored --nocapture
node scripts/performance-ui-smoke.mjs --browser 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
```

The UI benchmark intercepts every request to its synthetic endpoint. It never
uses personal history or calls a provider. It checks cursor continuation, zero
idle event mutations, lazy payload open/close, history paging and disconnect.
The storage test checks all fields/order against individual reads, restart
preservation, and refusal of malformed persisted JSON.

## Findings from the first pass (follow-up disposition below)

| Priority | Finding and evidence | Next bounded improvement |
| --- | --- | --- |
| High at large history sizes | `/runs`, event replay and several project lists still return all matching records. The browser retains the selected run's full event payloads, although its DOM is bounded. `App.tsx` refreshes all runs every two seconds, including when idle. | Add explicit cursor pagination/project filters to runtime/API contracts, fetch historical event pages on demand, and exercise reconnect without dropping events. Do not silently truncate history. |
| High under concurrent load | The service performs synchronous SQLite work behind one `std::sync::Mutex<Store>` inside async handlers and worker event paths. FULL synchronous commits preserve evidence but can occupy Tokio workers during disk stalls. | Measure request p95/p99 during high-rate worker output, then consider a bounded database worker or carefully scoped blocking jobs. Preserve atomic state/event transactions, admission draining and shutdown ordering. No weakened durability setting is justified. |
| Medium with many tickets/workflows | `Workflows::load` still loads plans and source state per ticket, and leases/candidate state per workflow. Missions source reads invoke pinned native CLIs; each call verifies source/toolchain identity. The selected workflow is also observed by the session panel. | Introduce a bounded project-summary read or shared client refresh coordinator; batch compatible source observations without caching away drift checks. Measure CLI startup separately from source verification. |
| Medium under noisy checks | The executor sends progress into an unbounded channel. The baseline relay limits persisted display events, but capture can keep allocating/sending updates after that limit. Artifact files themselves are capped at 16 MiB per stream and continue draining. | Bound/coalesce display progress, explicitly preserve start/final evidence, and stress cancellation against a fast producer and slow consumer. Blocking pipe drainage on a saturated UI queue would be a regression. |
| Medium for native teardown | Windows executor descendant cleanup remains weaker than the component runner's Job Object ownership, as already recorded in ADR 0007. The native executor test process took about 61 seconds despite passing individual deadlines, consistent with descendant-held pipe cleanup costs. | Add verified Windows descendant ownership/cleanup as its own lifecycle slice; prove child/grandchild exit and prompt shutdown. Do not confuse direct-child cancellation with tree ownership. |
| Lower priority without measurements | Windows cold startup invokes a fixed PowerShell bootstrap and performs identity/authentication checks. Tauri already runs that blocking work off the async worker. The developer build is not a release-profile performance measurement. | Measure cold/warm packaged startup and process memory before considering bootstrap or release-profile tuning. Keep duplicate-start reconciliation and token boundaries. |

Pi framing (1 MiB), Git output (8 MiB), manifest inspection (1 MiB), component
I/O/deadlines and check artifact bounds were reviewed. Those existing bounds are
valuable; removing validation, source identity checks, hashes or durable writes
to make benchmarks faster would weaken the application. No such change was made.

## Verification and limits

Product evidence here is separate from the original documentation validation
report. The following checks ran on this Windows host:

| Command / coverage | Result |
| --- | --- |
| `npm test` | Passed: 24 contract cases, 6 scope-guard tests, 8 component-pin tests, 221 desktop tests, 27 API-client tests. |
| `npm run typecheck`; `npm run build` | Passed. Final production JS: 258.45 kB, 78.42 kB gzip. |
| `cargo fmt --all -- --check` | Passed. |
| `cargo test --locked --workspace --all-targets --target-dir target/performance-review -- --test-threads=2` | Final run passed, exit 0, zero failures. Explicitly ignored provider/component/platform prerequisites and the manual benchmark remain separate from normal workspace coverage. The real-component native smoke and manual benchmark are recorded below. |
| `cargo clippy --locked --workspace --all-targets --target-dir target/performance-review -- -D warnings` | Passed; storage Clippy rerun after its test correction also passed. |
| `cargo test --locked -p luuna-storage --all-targets --target-dir target/performance-review -- --test-threads=2` | Passed: 34 tests; manual benchmark intentionally ignored in the normal run and passed separately. |
| `node scripts/performance-replay.mjs` | Original/incremental output equality verified; timing above. |
| `node scripts/performance-ui-smoke.mjs --browser <Edge>` | Passed: 10,000 events, 200 rendered rows, payload open/close, earlier/later/latest paging, cursor continuation, fixed historical position during an appended event, 760 px width in both schemes, idle DOM and disconnect. Final repeat rendered in 1,077 ms. |
| `$env:LUUNA_CHROMIUM = <Edge>`; `node scripts/mvp-ui-smoke.mjs --runtime target/performance-review/debug/luuna-runtime.exe` | 57/57 passed: browser workflows, real checks, synthetic Pi, restart/shutdown, accessibility, contrast in both schemes and 760 px width. |
| Set `CARGO_TARGET_DIR` to absolute `target/performance-review-native`; `npm run tauri --workspace @luuna/desktop -- build --debug --no-bundle` | Passed. Separate executable; existing personal app not replaced. Existing STATIC_VCRUNTIME deprecation warning remains. |
| `node scripts/mvp-ui-smoke.mjs --native target/performance-review-native/debug/luuna-desktop.exe --runtime target/performance-review/debug/luuna-runtime.exe` | 55/55 passed in actual bundled WebView2, including independent runtime lifetime. Native harness skips the browser-only 760 px resize check. Reviewed the resulting workflow screenshot. |
| `node scripts/m6-ui-smoke.mjs --native target/performance-review-native/debug/luuna-desktop.exe --runtime target/performance-review/debug/luuna-runtime.exe --runtime-label performance-review` | 27/27 passed: actual pinned Missions/Atlas/Beacon, private-memory selection, lost-response retries, source drift/reconciliation, approval/implementation refusals, real candidate checks, synthetic writer/reviewer, reload and normal window closure. |
| `node scripts/check-hygiene.mjs`; `git diff --check`; `node --check` on both added benchmark scripts | Passed. |

Native client tested: SHA-256
`e0a6d945bee49d0f59ce0a1b46aa2bf258a4f7869b0f33e30785f46ee298ef8e`.
Runtime used by the smokes: SHA-256
`1bc6bba46c7963c295b54dd9bad0b491404192a59ba6209c95a7aad72dca3f1c`.

The native smoke verifies the bundled application, not only a Vite build. It
does not establish macOS/Linux GUI performance, a signed installation or a
release-profile memory/CPU baseline. Automatic connection was observed in the
component smoke; the separate full cold-start/foreign-listener suite was not
rerun because bootstrap code did not change.

The initial default-target Rust command could not replace the running personal
`target/debug/luuna-runtime.exe` (Windows error 5). Verification uses a separate
target directory; the personal executable and state were not upgraded. The first
full parallel test attempt later missed the five-second wait for the second
`pi.agent_start` in the repair-cancellation fixture while builds ran concurrently.
The same test passed alone and in the next full run. That run exposed a separate
storage-test assumption: two fast stages were assumed to always cost exactly one
rounded second each. A stage finishing within the same persisted millisecond
legitimately costs zero, yielding 31 rather than the hardcoded 32 seconds. The
regression test now checks exact added charges and cross-revision accumulation
relative to the recorded stage time. Production budget accounting is unchanged.
Final results are recorded separately rather than hiding either initial failure.

The first browser smoke attempted Playwright's absent default Chromium because
that harness uses `LUUNA_CHROMIUM`, not a `--browser` option. Using the existing
Edge executable through the supported environment variable resolved this.
An attempted workspace rebuild while the disposable native component smoke held
its runtime executable also hit Windows error 5; this was a test-artifact lock,
not a service failure. It did not interrupt the smoke or the personal service.

No commit, push, installer publication, personal service upgrade, or real-provider
execution is part of this review. Native smokes use disposable runtime state and
synthetic Pi; real check commands still run. Provider latency/cost, sustained
production load, native memory profiling and other operating systems need their
own evidence before any broader performance guarantee.
