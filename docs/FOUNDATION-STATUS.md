# Ground-zero foundation status

Date: October 16, 2026. This records checks performed in the Linux cloud checkout, separately from the historical documentation validation report. No remote commit, package publication, signed installer, or GitHub CI result is implied.

## Audit actions

| Audit topic | Result |
| --- | --- |
| Committed sessions and authoring metadata | Archived privately outside the checkout, then removed 103 imported metadata files including 16 Pi sessions. Available reachable history scanned; see [security evidence](SECURITY-AUDIT-2026-10-16.md). Historical commits remain unchanged. |
| Component ownership and names | Maintained MIT distributions: Missions (Seeds), Atlas (Mulch), Beacon (Canopy). Independent package boundaries under `components/`, private until released; compatible storage formats and legacy CLI aliases preserved. The owner explicitly chose to keep everything in `brodynelly/luuna` and defer separation; see ADR 0002. |
| Authoritative specification | Current architecture, five ADRs, root agent/contributor instructions, rewritten README and handoff. Original proposals remain historical. |
| Root infrastructure | MIT license, upstream notices, ignore/editor settings, pinned Rust/Node tools, Cargo/npm/Bun locks, cross-platform Rust and native desktop CI jobs. |
| M0 contracts | Six missing schemas completed. Exact plan hash/revision/permissions, workflow/project binding, immutable storage, invalid transitions, stale approvals and candidate review guards tested. Feature execution fails closed pending real baseline evidence. |
| M1 engine/API | Real pinned Pi process/version/RPC probe; authenticated loopback API; durable run events/replay/SSE; owned cancellation, timeout/reap, malformed/error handling, exclusive state-directory ownership and restart recovery. Successful provider execution remains unverified. |
| Desktop | Functional React client plus minimal Tauri shell, shared typed API client, run/cancel/reconnect/history. Browser tested against actual service. Native GUI not launched on this host. |

## Commands and observed outcomes

| Check | Observed outcome |
| --- | --- |
| `bash scripts/setup-cloud.sh` | Passed: reviewed Pi graph installed from tracked lock, Rust/Bun/npm prerequisites installed, frozen component dependencies and Rust workspace build completed. |
| `cargo fmt --all -- --check` | Passed. |
| `cargo test --locked --workspace` | Passed: 33 tests (10 domain, 8 SQLite storage, 5 engine units, 2 engine supervision, 8 runtime API). No ignored tests. Zero-test binary/doc-test targets are not counted. |
| `cargo clippy --locked --workspace --all-targets -- -D warnings` | Passed. |
| `npm test` | Passed: 18 positive/negative checks across 9 JSON schemas and 10 API-client tests. |
| `npm run typecheck`, `npm run build` | Passed. |
| `npm audit` | Zero reported advisories in the root frontend dependency graph at check time. The separately locked Pi dependency graph also reported zero. This is not a complete dependency security audit. |
| `node scripts/check-hygiene.mjs`, `git diff --check` | Passed. |
| Genuine Pi Rust probe | Passed against `@earendil-works/pi-coding-agent@1.3.0`: version check, `get_state`, `get_available_models`, `abort`, stopped/reaped subprocess. No provider call required. |
| Actual HTTP service | Authentication rejection, actual Pi missing-credential failure, ordered persisted events and cursor replay passed. The updated runtime was stopped/restarted; previous failed/cancelled runs and ordered events survived. |
| Actual Chromium UI/service smoke | Connected with private token, created/cancelled real process attempt, observed durable cancellation, cleared token on disconnect, restored identical unique events on reconnect. A second run displayed the genuine missing-provider-credential failure. No token persisted to browser storage and no page exceptions. Desktop/mobile viewport checks passed. |

Component verification:

| Component | Observed outcome |
| --- | --- |
| Luuna Missions | Typecheck and agent-documentation checks passed; full suite 1,053 passed, zero failed. |
| Luuna Atlas | Typecheck and agent-documentation checks passed; isolated full suite 1,580 passed, zero failed across 84 files. Earlier contention-affected run was interrupted and is not counted as a passing run. |
| Luuna Beacon | Typecheck and agent-documentation checks passed; final isolated full suite 459 passed, zero failed across 36 files after the lock fix. |

All 3,092 component tests passed in the final isolated runs. All three components passed frozen-lock installations and retained upstream license bytes. Component tests use actual temporary files, Git fixtures and CLI subprocesses; they are independent of the synthetic Pi corpus.

The initial Beacon suite exposed a lock-contention defect. Schema validator compilation now occurs before lock acquisition, while config read/mutation/validation/atomic write remain inside the lock. Its existing concurrent-writer test and all 31 config cases passed across full-file and targeted runs. The final isolated full Beacon suite then passed all 459 tests. Earlier contention failures were retained as diagnostic evidence and were not counted as passing.

The final independent audit found that missing required fields in known Pi completion records could permit a false success. The parser now validates pinned protocol completion fields. Regression tests prove malformed completion after prompt acceptance persists a failed run, even if a later record claims settlement. The final engine/runtime tests, full Rust suite, formatting and strict Clippy passed with this correction.

## Limits and next evidence

1. **Provider prerequisite:** no compatible application provider key is present. Real Pi requests were observed to fail for missing credentials. Select a provider/model, add its key privately in environment settings, and apply the required network access, then verify genuine model output streaming, provider errors and cancellation. The running cloud proxy returned CONNECT 403 for both `api.anthropic.com` and `api.openai.com`; those two domains were added to the saved draft without replacing package-manager presets. Saving the draft does not apply it to the running machine. The isolated child preserves configured HTTP(S) proxy/trust settings. On this cloud platform, OpenAI credentials can use `LUUNA_PI_OPENAI_API_KEY`, mapped to Pi's normal `OPENAI_API_KEY`; the platform reserves direct `OPENAI_*` secret targets. No fixture, handshake or missing-key error establishes M1 provider success.
2. **Native/platform prerequisite:** this container lacks WebKitGTK 4.1/GTK and associated native prerequisites. The Tauri project, icons and standalone Cargo lock are present; Mac/Windows jobs are configured but have not run. Native launch, packaging and install compatibility remain unverified.
3. **M2 and later product work:** repository import, baseline execution, approved write worktrees, complete scheduling, independent reviewer execution, ticket/knowledge/prompt adapters, linked PR publication, browser/TUI parity and distributed-service installation are not implemented. The tool-free demo cannot enable those actions.
4. **Distribution:** branded packages remain private and unpublished. Separate GitHub repositories were not created or populated: GitHub API reads work, but the integration denied repository creation. The owner subsequently chose to push everything to the existing `brodynelly/luuna` repository and defer separation. Creating repositories or supplying a creation credential is no longer a prerequisite for this workflow.
5. **Privacy/history:** the preserved archive is outside Git and is potentially private. Earlier commits still contain imported session histories. The bounded signature scan found no likely live credentials; it cannot prove all published or unavailable history is secret-free. No history rewrite or credential rotation occurred.

Cloud `install_script`, `start_skill`, and the two provider network destinations were updated and saved to use the new structure, actual runtime, and tested prerequisites. Configuration persistence does not publish the environment or establish validation in a new task.

The [implementation roadmap](IMPLEMENTATION-ROADMAP.md) turns the remaining requirements into bounded assignments with acceptance evidence and planning ranges. [AI-START-HERE.md](../AI-START-HERE.md) is the entry point for the next coding agent.
