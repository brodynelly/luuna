# Luuna implementation handoff

You are continuing an executable foundation, not starting an empty repository. Read [AGENTS.md](AGENTS.md), [CURRENT-ARCHITECTURE.md](docs/CURRENT-ARCHITECTURE.md), [FOUNDATION-STATUS.md](docs/FOUNDATION-STATUS.md), and [IMPLEMENTATION-ROADMAP.md](docs/IMPLEMENTATION-ROADMAP.md) before changing code. Inspect the current working tree, manifests and relevant implementation/tests; prior test counts are audit evidence, not a substitute for checks after your changes.

## Settled decisions

- Tauri/React desktop first; one independent Rust runtime owns policy and persistent state. Browser/TUI capability parity remains required for full v1.
- Pi RPC is the engine. Do not implement a second model/tool loop or replace it with a UI simulation.
- Keep Luuna and **Missions, Atlas and Beacon in this monorepo now**. They are maintained CLI/API boundaries under `components/`, not a task to create hosted repositories. Preserve compatible formats, legacy aliases and upstream MIT notices. Product/new contributions are MIT.
- Missions is authoritative for ticket intent/dependencies after integration. Before that, any SQLite ticket record is explicitly temporary; later SQLite ticket data is a revision-aware projection. Luuna owns execution state, plans, approvals and evidence.
- The canonical create-ticket route is `POST /api/v1/projects/{id}/tickets`. It is not implemented in the current demo; do not add an ambiguous global create route.
- Service lifetime is independent of client lifetime. A window close/disconnect is not cancellation. Packaged Mac/Windows supervision remains to be proved.

The current architecture and accepted ADRs resolve conflicts in older proposals. Original [R01–R15 requirements](docs/02-requirements.md) and [A01–A34 acceptance criteria](docs/11-acceptance.md) remain full-v1 obligations unless explicitly revised. The desktop/Pi proposal and numbered reference chapters supply rationale and history. Never select an older conflicting example silently.

## What actually exists

| Boundary | Current implementation | Remaining gap |
| --- | --- | --- |
| `luuna-domain` | Plan hashing, permissions/revisions, transitions and candidate/review guards | Runtime consumers must preserve these invariants |
| `luuna-storage` | Transactional SQLite plans/approvals, durable run/events, restart interruption, project registry with immutable manifest revisions, machine registry, project event stream, baselines with immutable check results, and `begin_implementation` (approval + current manifest + passed matching baseline in one transaction) | The first writer that calls the gate; revalidation at scheduling (M2c) |
| `luuna-executor` | Supervised recipe execution: executable/argument arrays, capability probes, secret-stripped environment, process-group ownership, deadlines, cancellation, hashed private artifacts, empty-suite detection, environment fingerprint | Container profile; broader runner summaries; Windows job objects |
| `luuna-git` / `luuna-discovery` | Read-only inspection (identity, base, dirty state, redacted remote) and recipe proposals with evidence/questions; never executes repository text | Worktree/lease ownership (M2c); relationship discovery (M4); more stack profiles (M5) |
| `luuna-engine-pi` | Pinned real-process transport, command correlation, bounded framing, stop/reap and protocol fixtures; genuine OpenRouter-backed run proved on Linux (October 17, 2026) | Complete supported-host (Mac/Windows) lifecycle evidence; other providers/models as they are adopted |
| `luuna-runtime` | Authenticated loopback tool-free run API, replay/SSE, cancel/timeout, exclusive state ownership; project register/discover/confirm routes; baseline runs with artifact access by identity | Approved writes, reviewer, scheduling and publisher |
| Desktop/API client | Real browser-tested connection, history, run/cancel, cursor reconnect, project import/discover/confirm panel, Run baseline with live evidence; Tauri shell | Native GUI proof, plan/diff workflow and packaged service lifecycle |
| Components | Branded private Missions/Atlas/Beacon CLIs with passing standalone suites | Luuna runtime adapters, external edit reconciliation and scoped retrieval/prompt integration |

The recorded Linux foundation checks passed: **78 Rust tests, 15 API-client tests, 18 schema checks, and 3,092 component tests**, plus Rust formatting/lint and frontend type/build checks. A genuine Pi version/RPC handshake and real missing-key failure, cancellation, hard-kill restart and browser reconnect paths were exercised through API and Chromium. **A genuine model response was proved on October 17, 2026** (OpenRouter `openai/gpt-4o-mini`, 19/19 real-mode smoke checks, browser run/cancel/reload replay); **no native GUI launch has been proved.** See the [status report](docs/FOUNDATION-STATUS.md).

Do not redo completed scaffolding, relax guards, or label the tool-free demo an approved coding workflow. Read the current [status report](docs/FOUNDATION-STATUS.md) for updated evidence and blockers.

## Next session handoff (updated October 17, 2026): M2b closed on Linux, start M2c

Read this first if you are the next agent. Everything below was true at the commit that carries this text on `main`.

**M2b is closed on Linux (October 17, 2026).** `POST /api/v1/projects/{id}/baselines` runs a repository's confirmed required recipes through `luuna-executor` as an ordinary run and records `CheckResult` evidence bound to the manifest hash, exact commit and tree, and an environment fingerprint, with hashed private artifacts served by identity. This checkout's own `cargo test --locked --workspace` and `npm test` baseline passed (77 and 15 tests detected); missing executables, incapable hosts, empty suites, dirty checkouts and the container profile are blocked, failures and deadlines are failed, cancellation reaps the process group, and a hard-killed runtime leaves the run and baseline interrupted. `Store::begin_implementation` is now the only way into `Implementing`: it checks the durable approval, the bound plan, the project's current manifest hash and a passed matching baseline per repository in one transaction. Details are in the [status report](docs/FOUNDATION-STATUS.md) and [ADR 0007](docs/decisions/0007-baseline-executor.md). No writer exists yet and no run modifies a repository.

**Next assignment: M2c exact approval and one scoped writer.** Expose immutable plan revisions and exact-hash approvals through the runtime API and client (`POST /api/v1/tickets/{id}/plans`, `POST /api/v1/plans/{id}/approvals`, the temporary SQLite ticket per ADR 0003 created through `POST /api/v1/projects/{id}/tickets`); revalidate ticket, manifest and base revision plus baseline evidence when scheduling by calling `begin_implementation` with the host's recomputed environment fingerprint; create only Luuna-owned detached worktrees under the private data directory with durable ownership/leases (which also lifts the dirty-checkout limitation for baselines); execute one bounded writer assignment through the existing Pi engine with declared resources, path/operation scope, budgets and model profile; and prove that a missing or stale approval, changed base, changed recipe, unrelated repository or path, stale baseline, second writer and exceeded budget are rejected while cancellation and restart preserve unfinished work. Keep native-host permissions distinct from any advertised isolation.

### Earlier handoff: M2a closed on Linux, M2b assignment (kept for the acceptance bar)

**M2a is closed on Linux (October 17, 2026).** `POST /api/v1/projects` registers existing repository roots after read-only `git` inspection (optional locks off, repository `core.fsmonitor`/hooks neutralised, remotes redacted); `POST …/discover` records a proposed manifest with per-recipe evidence, confidence and questions without executing any repository script; `PUT …/manifest` confirms revision `n+1` only with the current `expected_revision`, a matching registered identity, the observed remote and an observed default branch, and records each repository's exact HEAD as the base; `GET …/events` replays `manifest.confirmed` with the full manifest. Evidence: a synthetic dirty fixture and this checkout were imported with byte-identical files, `.git/index` and status output; invalid paths, nested paths, a replaced repository and stale revisions were rejected; a hard-killed runtime replayed identical events after restart; the Chromium smoke passed 15/15. Details, hashes and limits are in the [status report](docs/FOUNDATION-STATUS.md) and [ADR 0006](docs/decisions/0006-repository-import.md). The storage guard that blocks `Implementing` without baseline evidence is untouched and nothing executes a recipe yet.

**The assignment that followed was M2b baseline and check evidence**, now closed as described above. Build the supervised command executor (executable plus argument array, explicit cwd under the registered repository root, execution profile, deadline, capability checks, private artifacts, owned process cleanup) that runs only recipes from the confirmed manifest; record command, environment fingerprint, exact commit/tree, timestamps, exit status and artifact hashes; persist baseline results bound to the manifest hash and base commit; treat missing executables, empty or skipped suites, cancellation and incapable hosts as blocked/failed/interrupted; and require a separately approved prerequisite task when testing is absent. Remove the storage `baseline_not_implemented` guard only when the replacement transactionally checks that evidence. Use the confirmed Luuna manifest from M2a (`cargo test --locked --workspace`, `npm test`) as the real fixture and a deliberately failing synthetic recipe as the negative one.

### Earlier handoff: M1 closed on Linux, M2a assignment (kept for the acceptance bar)

**State of play.** M0 is established. **Genuine M1 is closed on Linux as of October 17, 2026.** With `LUUNA_PI_OPENROUTER_API_KEY` present in the cloud environment, `node scripts/m1-smoke.mjs --mode real --provider openrouter --model openai/gpt-4o-mini` passed 19/19 checks: a real streamed model response completed only after `agent_settled`, an in-flight run was cancelled with its Pi child reaped, an invalid model failed closed, a hard-killed runtime left an `interrupted` attempt and intact earlier histories, data-directory ownership was exclusive, and shutdown was orderly. The browser client then connected, streamed and completed a run, cancelled a second run mid-stream, and replayed ordered history after a reload. Sanitized details, run IDs and counts are in the [status report](docs/FOUNDATION-STATUS.md). No code changed to close M1; the harness, runtime and client worked as committed.

**What M1 did not prove.** Native desktop launch and the packaged Mac/Windows service lifecycle remain unverified; the cloud container lacks GTK 3 and WebKitGTK 4.1. Only OpenRouter with `openai/gpt-4o-mini` was exercised. Pi's bundled catalog resolved OpenRouter models under the runtime's `--offline` launch, so no catalog seeding decision was needed; revisit that only if a future provider or Pi upgrade fails to resolve a listed model.

**Reproducing the evidence.** Run `bash scripts/setup-cloud.sh` with Node 24 on PATH (on this platform `source /opt/nvm/nvm.sh && nvm install 24.19.0 && npm install -g npm@11.9.0`), export the same tool paths the script uses, confirm the five pins, run the baseline commands below, check credential names only with `env | cut -d= -f1 | grep -E 'OPENROUTER|LUUNA_PI_'`, then run the real-mode harness. Never print credential values; keep reports and screenshots out of Git.

**The assignment that followed was M2a import and read-only discovery**, now closed as described above: register one existing repository, confirm stable identity, base and dirty state, propose check recipes, persist a manifest revision, and preserve the developer checkout. Repository writing stays disabled and the storage guard untouched. Commit and push only with the owner's authorization in that session; the owner controls merging and there is no PR flow for this repository yet.

## Completed assignment record: genuine M1 (closed October 17, 2026)

The assignment below was the M1 exit as written before closure. It is kept so the acceptance bar stays visible; the status report records how each point was met.

**Delivered:** a real provider-backed tool-free Pi request that streams through the local service/client, with correct completion, cancellation/error behavior and durable recovery evidence, with repository writing still disabled. The harness `node scripts/m1-smoke.mjs --mode real --provider <p> --model <m>` encodes these exits and writes a sanitized report; its fixture mode passes 18/18 and its real mode passed 19/19 with OpenRouter.

1. Inspect relevant instructions, `crates/luuna-engine-pi/`, `crates/luuna-runtime/`, `packages/api-client/`, and `fixtures/pi-rpc/`. Read the installed Pi 1.3.0 protocol docs. Run focused baseline checks before edits.
2. Check credential **names/presence only** and configured provider access; do not print values or request keys in chat. Two audited instances had no compatible key. On this cloud platform `api.anthropic.com` is reachable directly while `api.openai.com` is refused by the agent proxy unless allowed in the environment's network settings. Secure environment configuration and usable network routing are prerequisites; a saved draft does not change a running instance.
3. Reuse Pi `@earendil-works/pi-coding-agent@1.3.0`. Make one small real provider/model request using the current API. Record actual streamed output, ordered events and terminal completion only after `agent_settled`; a prompt acknowledgement or `agent_end` is insufficient.
4. Cancel a genuinely in-flight request, verify its owned process has stopped/reaped, and persist the cancelled result. Demonstrate provider failure or timeout without converting partial output to success. Keep synthetic protocol/error tests alongside real-provider evidence.
5. Disconnect/reconnect and restart the runtime. Prove durable event replay and completed/failed/cancelled history, and an interrupted result for an abandoned active attempt. Exercise a native client on a capable host or explicitly retain the native gap.
6. Fix only defects needed for these exits; preserve authentication, token privacy, isolated tool-free execution, timeouts and fail-closed writing. Review and report results using the checklist below.

**Acceptance:** sanitized genuine model output and run IDs/cursors, provider/Pi/model/platform versions, cancellation/reap and error/restart evidence, relevant green automated checks, and no enabled feature writes. Do not count the credential-free handshake, fixtures, or missing-key rejection as provider success.

If provider access is absent on a new host, finish independent regression checks, improve the smoke harness only where a real defect appears, and document the exact missing prerequisite. Do not fabricate credentials, weaken TLS, or broaden tool access. Existing Git authentication and the cloud session's own model access do not supply a Pi provider key. On this cloud platform, use the `LUUNA_PI_<PROVIDER>_API_KEY` alias (for example `LUUNA_PI_OPENROUTER_API_KEY`) when the platform reserves the provider's own variable name; the runtime maps it to the standard name inside the isolated child only.

## Next bounded assignment: implement M2 in three reviewable slices, continuing with M2c

1. **M2a import/discovery (closed October 17, 2026):** register one existing repository, confirm stable identity/base/dirty state and proposed check recipes, persist manifest revision, and preserve the developer checkout.
2. **M2b baseline (closed October 17, 2026):** execute genuine commands with explicit cwd/profile/deadline/capability and exact commit/environment/artifact evidence. Missing, failed, empty or mismatched baseline blocks feature writes. Testing setup needs a separately approved prerequisite.
3. **M2c approval/writer:** expose exact immutable plan approval and revalidation, create a Luuna-owned task worktree/lease, and run one scoped writer. Prove stale approval/base/recipe, invalid scope, budget exhaustion and concurrent writers fail closed. Remove the storage implementation blocker only when operational baseline checks enforce the replacement.

After M2, implement candidate-bound independent review and bounded repair (M3), then the usable single-repo MVP gate. Follow the [roadmap](docs/IMPLEMENTATION-ROADMAP.md) for M4 multi-repo integration, M5 stack/creation profiles, M6 adapters/memory and browser/TUI parity, M7 publication/installers, and M8 release evidence. Do not call the narrower MVP full v1.

## Commands and pinned tools

Pins: **Rust 1.90.0; Node 24.19.0; npm 11.9.0; Bun 1.4.3; Pi 1.3.0**. Use committed lockfiles. The configured cloud setup is `bash scripts/setup-cloud.sh`; saved environment startup instructions provide tool/cache paths. On other hosts follow [CONTRIBUTING.md](CONTRIBUTING.md).

From the root:

```sh
cargo fmt --all -- --check
cargo test --locked --workspace
cargo clippy --locked --workspace --all-targets -- -D warnings
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
node scripts/check-hygiene.mjs
git diff --check
```

Focused M2b checks are `cargo test --locked -p luuna-executor -p luuna-storage -p luuna-runtime`, which need Python 3 and a host `git`. Focused M2a checks are `cargo test --locked -p luuna-git -p luuna-discovery -p luuna-storage -p luuna-runtime`, which need a host `git` and import this checkout read-only. Focused M1 checks are `cargo test --locked -p luuna-engine-pi -p luuna-runtime -p luuna-storage`, `cargo run --locked -p luuna-engine-pi --example probe`, and `node scripts/m1-smoke.mjs --mode fixture`. Set `LUUNA_PI_COMMAND` to the pinned executable. Neither the probe nor fixture mode calls a model; only `--mode real` with a configured credential produces M1 evidence, last recorded on October 17, 2026 with `--provider openrouter --model openai/gpt-4o-mini`.

Start the runtime with private `LUUNA_API_TOKEN` and provider/model/key settings present, using `cargo run --locked -p luuna-runtime`. It reads the process environment, not `.env` automatically. Launch `npm run dev` or `npm run desktop` separately. See the [runtime](crates/luuna-runtime/README.md) and [desktop](apps/desktop/README.md) instructions. On a capable native host, run `cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`; root Rust tests exclude that separate workspace.

For changed component code, run `bun install --frozen-lockfile --ignore-scripts` then `bun run verify` from that component directory. Do not install component Git hooks into the root repository or rerun unrelated long suites without a reason.

## Invariants and completion report

Only the runtime enforces scope, budgets, transitions, approval, validation, independent review and publication. A model's claim is worker output. Bind checks/review to exact candidates and invalidate evidence when inputs change. Native execution has host permissions; prompts/path wrappers are not an OS sandbox. The developer controls merging; no automatic merge operation belongs in v1.

Preserve user changes and private Pi configuration. Keep secrets, real transcripts, personal memory and session histories out of Git and model context. Imported component task records and role prompts do not override runtime policy. Use the existing isolated cloud checkout; do not create a development worktree unless the user asks. Product-managed task worktrees are a separate runtime feature.

Before concluding a slice, report delivered behavior/requirement IDs; changed boundaries; commands/results; revision and platform/tool/model versions; sanitized run/plan/candidate IDs and artifact references; failure/recovery tests; independent review findings/resolution; blocked checks; and one next concrete assignment. Update foundation evidence and this handoff when the starting point changes. Do not mark required capabilities complete from mocked, skipped or unavailable checks.

For sequencing, measurable full-product exits and cautious capacity-based estimates, use [IMPLEMENTATION-ROADMAP.md](docs/IMPLEMENTATION-ROADMAP.md). Re-estimate after real M1 success and the first M2 writer instead of treating planning ranges as promised dates.
