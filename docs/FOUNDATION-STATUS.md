# Ground-zero foundation status

Date: October 16, 2026, updated October 17, 2026 with the M1 and M2a closure evidence below. This records checks performed in the Linux cloud checkout, separately from the historical documentation validation report. No remote commit, package publication, signed installer, or GitHub CI result is implied.

## Audit actions

| Audit topic | Result |
| --- | --- |
| Committed sessions and authoring metadata | Archived privately outside the checkout, then removed 103 imported metadata files including 16 Pi sessions. Available reachable history scanned; see [security evidence](SECURITY-AUDIT-2026-10-16.md). Historical commits remain unchanged. |
| Component ownership and names | Maintained MIT distributions: Missions (Seeds), Atlas (Mulch), Beacon (Canopy). Independent package boundaries under `components/`, private until released; compatible storage formats and legacy CLI aliases preserved. The owner explicitly chose to keep everything in `brodynelly/luuna` and defer separation; see ADR 0002. |
| Authoritative specification | Current architecture, five ADRs, root agent/contributor instructions, rewritten README and handoff. Original proposals remain historical. |
| Root infrastructure | MIT license, upstream notices, ignore/editor settings, pinned Rust/Node tools, Cargo/npm/Bun locks, cross-platform Rust and native desktop CI jobs. |
| M0 contracts | Six missing schemas completed. Exact plan hash/revision/permissions, workflow/project binding, immutable storage, invalid transitions, stale approvals and candidate review guards tested. Feature execution fails closed pending real baseline evidence. |
| M1 engine/API | Real pinned Pi process/version/RPC probe; authenticated loopback API; durable run events/replay/SSE; owned cancellation, timeout/reap, malformed/error handling, exclusive state-directory ownership and restart recovery. Genuine provider execution verified on October 17, 2026 through OpenRouter (`openai/gpt-4o-mini`, 19/19 smoke checks); see the M1 closure section. |
| Desktop | Functional React client plus minimal Tauri shell, shared typed API client, run/cancel/reconnect/history. Browser tested against the actual service, including a genuine streamed model response, in-flight cancel and reload/replay on October 17, 2026. Native GUI not launched on this host. |

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

## M1 closure attempt, later on October 16, 2026

A second cloud session attempted the handoff's next assignment, closing genuine M1, on a fresh container at revision `65056e3` plus the changes recorded here. Pinned tools were reproduced and verified: Rust 1.90.0, Node 24.19.0, npm 11.9.0, Bun 1.4.3, Pi 1.3.0, Python 3.13. `scripts/setup-cloud.sh` initially failed because `rustup toolchain install` attempted a self-update against the relocated `CARGO_HOME`; the script now passes `--no-self-update` and completed on the second run.

**Result: M1 is not closed.** No provider credential was present in the environment (checked by variable name only: none of the eight supported `*_API_KEY` names or their `LUUNA_PI_` aliases existed), Pi's own `auth check --provider anthropic` in an isolated config reported `credentials_not_configured`, and `pi --list-models` showed no available models. Every genuine Pi request through the runtime therefore failed closed with Pi's `No API key found for anthropic` prompt rejection. That is failure-path evidence only.

| Check | Observed outcome |
| --- | --- |
| `cargo fmt`, `cargo clippy --locked --workspace --all-targets -- -D warnings` | Passed before and after the changes below. |
| `cargo test --locked --workspace` | Passed: 35 tests (10 domain, 8 storage, 5 engine unit, 2 engine supervision, 10 runtime API). Two runtime API tests are new. |
| `npm test`, `npm run typecheck`, `npm run build`, `node scripts/check-hygiene.mjs`, `git diff --check` | Passed: 18 schema checks, 10 API-client tests, type/build and hygiene. |
| `cargo run --locked -p luuna-engine-pi --example probe` against the installed Pi 1.3.0 | Passed: version, `get_state`, `get_available_models`, `abort`, stopped/reaped. No provider call. |
| `node scripts/m1-smoke.mjs --mode fixture` (new harness, synthetic fixture) | 18/18 checks passed: auth rejection, SSE stream of 12 sequential events closing at terminal, `agent_settled` before `run.completed`, cursor replay identity, in-flight cancellation with the recorded child PID alive before and reaped after, idempotent cancel, provider failure persisted as failed, SIGKILL of the runtime followed by fixture child exit within 1.4 s, restart marking the abandoned attempt `interrupted`, three earlier histories identical by event ID, second runtime refused the owned data directory, SIGTERM orderly shutdown with exit 0. Synthetic: not provider evidence. |
| `node scripts/m1-smoke.mjs --mode real --provider anthropic --model claude-sonnet-4-5` (genuine Pi, no key) | 11/19 checks passed; all 8 failures trace to the missing credential. Pi resolved the model (`anthropic-messages`, `https://api.anthropic.com`), then rejected the prompt. Genuine Pi children exited within 1 ms of the runtime being hard-killed. Restart recovery and ownership checks passed. Runs `1cac2e38…`, `09452b8d…`, `4e43e8ac…`, `0577e5a2…` each persisted 6 events ending in `run.failed`. |
| Chromium browser smoke of the Vite UI (Playwright, not committed) | 11/11 checks passed against a fixture runtime on port 4243 and a genuine Pi runtime on port 4242: connect with token, fixture completion displaying the recorded Pi text, cancel from the UI yielding `run.cancelled` without `run.completed`, reload clearing the in-memory token with empty browser storage, reconnect restoring durable history and identical ordered event replay, and the genuine no-credential run displayed as failed with Pi's reason and no response text. No page exceptions. |
| `cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` | Failed as expected on this headless host: `gdk-3.0` is not in the pkg-config search path (WebKitGTK 4.1 and GTK 3 are absent). Native desktop validation remains unverified and must run on a capable Mac/Windows/Linux-desktop host. |
| Network reachability (names only) | `api.anthropic.com` is reachable directly from this container because the platform lists it in the proxy's bypass set; `api.openai.com` is refused by the agent proxy (HTTP 421). An Anthropic key is therefore the shortest path to M1 on this platform; an OpenAI key additionally needs `api.openai.com` allowed in the environment's network settings. |

Changes made in this attempt, all covered by the checks above:

- `scripts/m1-smoke.mjs`: reproducible M1 smoke harness producing sanitized `report.md`/`report.json` (no token or credential values). Real mode is the intended M1 evidence path once a credential exists; fixture mode validates the harness itself.
- Runtime records a `pi.spawned` event per attempt with the owned child's PID, Pi version and the names of provider credentials forwarded, enabling reap verification after the terminal event. A new test proves the fixture child is alive before cancel and gone before `run.cancelled` persists.
- Provider key aliases are generalized: `LUUNA_PI_<NAME>` maps to each supported `<NAME>` inside the isolated child, with alias precedence and no pass-through of the alias itself. A new test proves alias and direct names reach the child by standard name only and that no values are persisted.
- On Unix the runtime treats `SIGTERM` like Ctrl+C: orderly shutdown stops owned workers and persists interruption. Verified by the harness (exit 0 within about 50 ms when idle).
- `scripts/setup-cloud.sh` uses `rustup ... --no-self-update`.

No repository-writing feature was enabled; the storage guard that blocks `Implementing` without baseline evidence is unchanged. Missions, Atlas and Beacon were not modified and their suites were not rerun (unchanged code; CI runs them).

## M1 closure, October 17, 2026

A third cloud session followed the handoff on a fresh container at revision `52e3ed6`. Pinned tools were reproduced and verified: Rust 1.90.0, Node 24.19.0, npm 11.9.0, Bun 1.4.3, Pi 1.3.0. Baseline checks before any change: `cargo fmt --all -- --check` clean; `cargo clippy --locked --workspace --all-targets -- -D warnings` clean; `cargo test --locked --workspace` 35 passed; `npm test` 18 contract checks across 9 schemas plus 10 client tests; `npm run typecheck` and `npm run build` clean; `node scripts/check-hygiene.mjs` clean; `node scripts/m1-smoke.mjs --mode fixture` 18/18; `git diff --check` clean.

Credential presence was checked by name only: `LUUNA_PI_OPENROUTER_API_KEY` was present (the alias the runtime maps to `OPENROUTER_API_KEY` inside the isolated child), and OpenRouter's key endpoint accepted it. In an empty temporary config directory with only that key mapped, `pi --list-models --provider openrouter` listed 397 models from Pi's bundled catalog, so the runtime's `--offline` launch in a fresh config directory resolves OpenRouter models without a catalog refresh or a seeded `models.json`. The model chosen was `openai/gpt-4o-mini`.

**Result: genuine M1 is closed on Linux.** `node scripts/m1-smoke.mjs --mode real --provider openrouter --model openai/gpt-4o-mini` passed **19/19** checks (started 03:49:33 UTC, finished 03:49:40 UTC; runtime port 4247; Pi 1.3.0; platform `linux 6.18.44-fc-v139 x64`). The report was kept outside Git and contains no token or credential values; a search for the key prefix in `report.md`, `report.json`, and the runtime/dev-server logs found nothing.

| Evidence | Observed |
| --- | --- |
| Success run | Run `9c620491-761c-4081-a91d-855800e28bab` recorded 37 durable events with 18 text deltas. `pi.agent_settled` was sequence 35 and `run.completed` sequence 36, so completion followed settlement. Final text: "LUUNA-M1-OK The Moon is Earth's only natural satellite and influences our tides." The persisted model record is provider `openrouter`, id `openai/gpt-4o-mini`, api `openai-completions`, base URL `https://openrouter.ai/api/v1`. Cursor replay reproduced all 37 event identities and the SSE stream closed at the terminal event. |
| Cancellation | Cancel was accepted (202) after `pi.agent_start` on a genuinely in-flight run; the terminal state was `cancelled`, never `completed`. The owned Pi child (pid 8983) was alive before the cancel and reaped before `run.cancelled`. A second cancel on the terminal run returned 200. |
| Provider failure | Model `luuna-no-such-model-0000` produced run `0ab8e6eb-33ad-45b5-8945-06fa91a7ca8e` ending in `run.failed` with reason `400: luuna-no-such-model-0000 is not a valid model ID`, after `pi.agent_settled`, with no partial success. |
| Restart | The runtime was hard-killed while run `7289855a-2d31-4e08-8d1d-f731b8031402` was `running`. The Pi child (pid 9023) exited 1362 ms later and was not orphaned. After restart the attempt was `interrupted`, and the three earlier run histories were identical by event identity. |
| Ownership and shutdown | A second runtime on the same data directory exited 1 with "another Luuna runtime already owns this data directory". SIGTERM produced an orderly exit 0 after 50 ms. |
| Authentication | Missing and wrong tokens returned 401 on protected routes; slash-command prompts were rejected with 400. |

Browser client evidence, Chromium driven by Playwright against the built runtime on port 4242 and `npm run dev` on port 1420 with a fresh random token: the client connected; run `2954ac8d-9577-48a0-b96f-d2e47e965086` with provider `openrouter` and model `openai/gpt-4o-mini` streamed and completed with the text "luuna browser" across 22 events; a second long run `323e5987-3655-4c7e-8d1f-ecf867b755f8` was cancelled from the UI after 309 characters had streamed and ended in `run.cancelled` after 126 events; after a page reload and reconnect, the history listed the cancelled and completed sessions, and selecting the completed run replayed sequences 1–22 in strictly increasing order with the same text. Four screenshots were retained outside Git.

This session changed documentation only; no runtime, engine, client or component code changed. Not established by this run: native desktop launch (unchanged gap, GTK 3 and WebKitGTK 4.1 are absent in the container), Mac/Windows service lifecycle, any provider other than OpenRouter, any model other than `openai/gpt-4o-mini`, and anything beyond the tool-free demo. The storage guard that blocks `Implementing` without baseline evidence is untouched. A completed tool-free session is connectivity evidence, not a validation result or repository-writing readiness.

## M2a closure, October 17, 2026

A fourth cloud session implemented the handoff's next assignment, M2a import and read-only discovery, on a fresh container at revision `7757f56`. Pinned tools verified: Rust 1.90.0, Bun 1.4.3, Pi 1.3.0, git 2.43.0; Node 24.19.0 could not be installed through nvm in this container, so the frontend checks ran on Node 22.22.0 with npm 11.9.0 (the workspace's `engines` floor is 22.12). Baseline before any change: `cargo test --locked --workspace` 35 passed, `npm test` 18 schema checks plus 10 client tests, formatting/Clippy/typecheck/build/hygiene clean.

**Result: M2a is closed on Linux.** Delivered behavior (R04 begins; R07/R08 guards untouched):

- `luuna-domain`: `ProjectManifest` validation and `luuna-json-v1` hash (every field hashed, including check recipes and policy), `RepositoryIdentity`/`RepositoryObservation`/`DirtyState` and `Discovery` contracts. Shell interpreters need an explicit `shell` capability; absolute executables, `..` working directories, remotes carrying credentials, invalid branch names and non-v1 policies are rejected.
- `luuna-git` (new): read-only inspection through the host `git` with `GIT_OPTIONAL_LOCKS=0`, `-c core.fsmonitor=false -c core.hooksPath=/dev/null`, bounded output and timeouts; records redacted remote, sorted root commits, shallow flag, HEAD, branch, origin default branch, local branches and porcelain-v2 dirty counts. A test sets `core.fsmonitor` to a marker-creating command in the repository and proves it does not run.
- `luuna-discovery` (new): proposes recipes from `Cargo.toml`/`Cargo.lock`, `package.json` plus lockfile (npm/pnpm/yarn/bun), `go.mod`, `pyproject.toml`/`setup.py`/`requirements.txt`, `pubspec.yaml`, Gradle files and Xcode projects, each with evidence, observed/inferred confidence and questions (dirty checkout, missing remote, detached HEAD, unrecognised stack, no usable test script). A test embeds a marker-creating `scripts.test` and proves discovery never executes it.
- `luuna-storage`: migration 2 adds `projects`, immutable `manifest_revisions` (update/delete triggers), the machine registry `repositories`, `discoveries` and `project_events`. `confirm_manifest` checks the expected revision, revision `n+1`, equal repository sets, registered-identity match, observed remote and observed default branch in one transaction and records base commits.
- `luuna-runtime`: `POST/GET /api/v1/projects`, `GET /api/v1/projects/{id}`, `POST .../discover`, `PUT .../manifest`, `GET .../events`; `LUUNA_GIT_COMMAND`; API errors now carry deterministic runtime reasons for 409/422.
- `@luuna/api-client`: project types and methods, `confirmedManifest` replay fold, 409/422 reasons surfaced only when short and printable. Desktop: Projects panel (register, observe, discover, edit and confirm the manifest, event record).
- `schemas/project.schema.json`: optional `cwd` per check. ADR 0006 records the decisions.

| Check | Observed outcome |
| --- | --- |
| `cargo fmt --all -- --check`, `cargo clippy --locked --workspace --all-targets -- -D warnings` | Passed. |
| `cargo test --locked --workspace` | Passed: 54 tests (13 domain, 3 discovery, 5 engine unit, 2 engine supervision, 3 git unit, 3 git inspection, 1 runtime unit, 10 runtime API, 3 runtime projects, 8 storage persistence, 3 storage projects). The runtime project tests import a synthetic dirty repository and this real checkout, snapshot every byte (including `.git/index`) before and after, and assert equality. |
| `npm test`, `npm run typecheck`, `npm run build`, `node scripts/check-hygiene.mjs`, `git diff --check` | Passed: 18 schema checks and 13 client tests; type/build/hygiene clean (Node 22.22.0). |
| `cargo generate-lockfile --offline` | Added only the three new workspace members and `chrono`/`tempfile` edges for the runtime; no dependency versions changed. |
| Built runtime, HTTP evidence (port 4251, fresh data directory) | Synthetic fixture (dirty: 1 unstaged, 1 untracked, remote configured with a fake credential) registered 201 with the remote redacted to `https://example.invalid/fixture.git`; discovery proposed `cargo test --locked` (required, observed) and `cargo clippy …` (optional, inferred) with a `dirty-checkout` question; confirmation 200 at revision 1, hash `sha256:c0be2d50…`, base `46c6a7df…`. This checkout registered 201 (remote `https://github.com/brodynelly/luuna`, root `f3c2a17f…`, HEAD `7757f566…` detached, 12 unstaged and 8 untracked paths from this session's work); discovery proposed `cargo test --locked --workspace`, `cargo clippy …`, `npm test`, `npm run typecheck`, `npm run build` with questions `dirty-checkout` and `default-branch` (`main` assumed from local branches); confirmation 200 at revision 1, hash `sha256:0c3c2c01…`, base `7757f566…`. A repeated confirmation with `expected_revision` 0 returned 409 `revision conflict: expected 0, current 1`; a non-repository directory returned 422 `not a Git repository`; the unauthenticated list returned 401. |
| Hard-kill restart and replay | After `SIGKILL` and restart on the same data directory, `GET /projects/fixture/events` was byte-identical to the pre-kill response (sequences 1–4: `project.registered`, `repository.registered`, `discovery.proposed`, `manifest.confirmed`), and the Luuna project reported the same revision, hash and base; the replayed `manifest.confirmed` payload carried the five confirmed recipes. |
| Byte identity | SHA-256 of the synthetic README, untracked file and `.git/index`, plus this checkout's `.git/index` and `git --no-optional-locks status --porcelain=v2 -z` output, were identical before and after registration, discovery, confirmation and restart. The fake credential appears only in the fixture's own `.git/config`, never in Luuna output, logs or SQLite; the API token appears in no log or database. |
| Chromium smoke of the Vite UI (Playwright, not committed) | 15/15 checks: connect, empty Projects state, register with redacted remote and dirty counts, discover showing the required `cargo test --locked` recipe and the dirty-checkout question, draft equals the proposal, confirm displays revision 1 and `manifest r1`, a stale re-confirm shows the runtime's revision-conflict reason, reload leaves browser storage empty, reconnect restores the confirmed map, the event record replays four ordered events, no page exceptions. Four screenshots kept outside Git. |
| Not run | Component suites (Missions, Atlas, Beacon unchanged); native desktop check (unchanged GTK/WebKitGTK gap). |
| GitHub CI on the pull request | The first Windows Rust job failed in a discovery unit test whose fixture interpolated a backslash path into raw JSON; the fixture now serializes through `serde_json`. The same pass removed two Windows-only hazards found by review: `luuna-git` strips the `\\?\` verbatim prefix that `canonicalize` adds on Windows before passing paths to `git -C` or recording them, and the identity-mismatch test switches to an orphan branch instead of deleting read-only Git objects. Mac and Linux results are recorded on the pull request. |

Not established: any command execution, baseline evidence, writer worktree or plan transition. The storage guard that blocks `Implementing` without baseline evidence is unchanged, and a confirmed manifest is an input to M2b, not proof that its recipes run or pass. Discovery recognises single repositories; relationships remain empty until M4. Multi-root-commit repositories record all roots; shallow clones rely on the remote for identity.

## Limits and next evidence

The provider prerequisite that blocked M1 is resolved for the cloud environment: `LUUNA_PI_OPENROUTER_API_KEY` is present and the genuine run above succeeded. Other providers still need their own `LUUNA_PI_<NAME>_API_KEY` (or plain name) and reachable network; `api.openai.com` remains refused by the agent proxy unless allowed in the environment's network settings. The remaining limits are:

1. **Provider prerequisite history:** no compatible provider key was present on October 16, 2026 (re-verified by name in a fresh container), which blocked the first closure attempt. On October 17 the owner added `LUUNA_PI_OPENROUTER_API_KEY` and the genuine run succeeded. To reproduce on another host or provider, set the credential under `LUUNA_PI_<NAME>_API_KEY` (the runtime maps it to the standard name inside the isolated child; use the plain name on hosts that do not reserve it), build the runtime, and run `node scripts/m1-smoke.mjs --mode real --provider <provider> --model <model>`. No fixture, handshake, missing-key error, or Luuna-side test establishes provider success; only the real-mode report does.
2. **Native/platform prerequisite:** this container lacks WebKitGTK 4.1/GTK and associated native prerequisites. The Tauri project, icons and standalone Cargo lock are present; Mac/Windows jobs are configured but have not run. Native launch, packaging and install compatibility remain unverified.
3. **M2b and later product work:** repository import and discovery exist (M2a, above); baseline execution, approved write worktrees, complete scheduling, independent reviewer execution, ticket/knowledge/prompt adapters, linked PR publication, browser/TUI parity and distributed-service installation are not implemented. The tool-free demo and a confirmed manifest cannot enable those actions.
4. **Distribution:** branded packages remain private and unpublished. Separate GitHub repositories were not created or populated: GitHub API reads work, but the integration denied repository creation. The owner subsequently chose to push everything to the existing `brodynelly/luuna` repository and defer separation. Creating repositories or supplying a creation credential is no longer a prerequisite for this workflow.
5. **Privacy/history:** the preserved archive is outside Git and is potentially private. Earlier commits still contain imported session histories. The bounded signature scan found no likely live credentials; it cannot prove all published or unavailable history is secret-free. No history rewrite or credential rotation occurred.

Cloud `install_script`, `start_skill`, and the two provider network destinations were updated and saved to use the new structure, actual runtime, and tested prerequisites. Configuration persistence does not publish the environment or establish validation in a new task.

The [implementation roadmap](IMPLEMENTATION-ROADMAP.md) turns the remaining requirements into bounded assignments with acceptance evidence and planning ranges. [AI-START-HERE.md](../AI-START-HERE.md) is the entry point for the next coding agent.
