# Local runtime connectivity foundation

The independent runtime is authenticated and loopback-only. It owns repository import, baseline checks, immutable approval, scoped writers, candidate-bound validation, fresh read-only review and bounded repair. The tool-free connectivity demo remains available as a separate profile: those sessions use a private empty cwd/config with repository tools disabled. Writer and reviewer scope guards are runtime policy, not an OS sandbox. Genuine-provider M3 acceptance remains separate from fixture coverage.

Install the supported `@earendil-works/pi-coding-agent@1.3.0` distribution.
The launcher verifies `--version` before each run. Configure these environment
variables locally; keep credentials out of repository files:

| Variable | Purpose |
| --- | --- |
| `LUUNA_API_TOKEN` | Required random token, at least 32 bytes; frontend enters it locally |
| `LUUNA_PI_COMMAND` | Pi executable, default `pi`; may be an absolute Node executable |
| `LUUNA_GIT_COMMAND` | Host `git` used for read-only repository inspection, default `git` |
| `LUUNA_PI_ARGS_JSON` | Optional JSON array of launcher arguments, e.g. absolute `dist/cli.js` path |
| `LUUNA_PI_PROVIDER` / `LUUNA_PI_MODEL` | Optional explicit defaults; UI can supply them per run |
| `LUUNA_PI_<PROVIDER>_API_KEY` | Optional alias for any supported provider key (for example `LUUNA_PI_ANTHROPIC_API_KEY`, `LUUNA_PI_OPENAI_API_KEY`) for hosts that reserve the plain name; it becomes the child's standard variable, takes precedence over a direct key, and is never passed through under the alias name |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | Preserved for provider routing, including lowercase variants and `NODE_USE_ENV_PROXY`; existing TLS trust variables remain enabled |
| `LUUNA_DATA_DIR` | Private durable state directory, default `.luuna` |
| `LUUNA_PORT` | Loopback port, default `4242` |
| `LUUNA_RUN_TIMEOUT_SECONDS` | Positive operation deadline, default `600`; version probe has a separate 15s deadline |

Run `cargo run -p luuna-runtime`. Supply the selected provider's API key through
its standard environment variable, such as `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY`; the runtime never accepts keys through the API. The current
demo inherits only an explicit list of direct provider key variables. OAuth,
cloud platform authentication, user Pi profiles, and model settings files are
not integrated. Missing provider credentials produce a persisted failed run.

`GET /api/v1/health` is public. Its `pi_version` field reports the required
supported version; the CLI is checked when starting a run. Its `build_identity`
field is the content digest of the sources the binary was built from, and
`build_rustc` names the compiler release and commit that built it
(`build_rustc_wrapper` any compiler wrapper Cargo used, or `none`). All other endpoints
require `Authorization: Bearer <token>`:

- `GET /api/v1/runs`: persisted run records.
- `POST /api/v1/runs`: `{ "prompt": "Hello", "provider": "...", "model": "..." }`.
- `GET /api/v1/runs/{id}`: current run state.
- `GET /api/v1/runs/{id}/events?after=0`: durable event replay by sequence.
- `GET /api/v1/runs/{id}/stream?after=0`: SSE replay then live delivery; accepts `Last-Event-ID`.
- `POST /api/v1/runs/{id}/cancel`: request abort; terminal cancellation follows process reaping.
- `GET /api/v1/projects`, `GET /api/v1/projects/{id}`: registered projects, machine-registry
  repositories, the current confirmed manifest and the latest discovery.
- `POST /api/v1/projects`: `{ "id"?: "slug", "name": "...", "repositories": [{ "id": "app", "path": "/abs/root" }] }`
  inspects each repository root read-only (identity, HEAD, branch, dirty state) and registers it.
  Non-repositories, nested paths, bare or unborn repositories are rejected with 422.
- `POST /api/v1/projects/{id}/discover`: re-observes the registered repositories and records a
  proposed manifest with per-recipe evidence, confidence and open questions. It reads manifest
  files only; it never runs a repository script.
- `PUT /api/v1/projects/{id}/manifest`: `{ "expected_revision": n, "manifest": {...} }` confirms
  revision `n+1` after re-checking identity, remote and default branch, and records the exact
  HEAD commit per repository as the base. Stale revisions and changed identities return 409.
- `GET /api/v1/projects/{id}/events?after=0`: durable project stream (`run_id` is
  `project:{id}`); `manifest.confirmed` carries the complete manifest for replay.

- `POST /api/v1/projects/{id}/baselines`: `{ "repository_id": "app", "include_optional": false }`
  starts a baseline run (202) that executes the confirmed required recipes for that
  repository on a clean checkout at its exact HEAD. It is an ordinary run: follow it with
  `/runs/{id}/events` or `/stream`, cancel it with `/runs/{id}/cancel`. A dirty checkout,
  missing executable, incapable host, empty suite or container profile is recorded as
  blocked; failures and deadlines are failed; nothing is ever promoted to passed.
- `GET /api/v1/projects/{id}/baselines`: recorded baselines with their check results,
  bound to manifest hash, commit, tree and environment fingerprint.
- `GET /api/v1/runs/{id}/artifacts/{recipe}.{stdout|stderr}`: the private check log by
  record identity (text, capped at 16 MiB).

- `POST /api/v1/projects/{id}/tickets`: `{ "idempotency_key", "title", "intent", "acceptance_criteria": [...], "repository_ids": [...] }`
  creates the temporary local ticket (201; 200 when the key repeats with the same content,
  409 when it repeats with different content). `GET` lists them; `GET /api/v1/tickets/{id}`
  reads one. This is the only ticket creation route (ADR 0005).
- `POST /api/v1/tickets/{id}/plans`: `{ "task": { "repository_id", "paths": [...], "operations": [...] }, "permissions"?, "budgets"? }`
  records the next immutable plan revision bound by the runtime to the ticket revision, the
  current manifest hash, its recorded base commit and its recipes, and opens the workflow run
  (`plan_ready`). Returns `{ plan, run }`. `GET` lists a ticket's plans; `GET /api/v1/plans/{id}`
  reads the latest revision.
- `POST /api/v1/plans/{id}/approvals`: `{ "plan_revision", "plan_hash", "approved_by" }` approves
  exactly that hash; permissions are copied from the plan. Returns `{ approval, run }` with the
  run `approved`; a stale hash or revision returns 409.
- `POST /api/v1/runs/{id}/implement`: `{ "task_id"?, "provider"?, "model"? }` schedules the
  writer (202) after revalidating the approval, ticket revision, manifest, base commit, passed
  baseline, host fingerprint, repository HEAD, lease exclusivity and attempt budget; any refusal
  is 409/422 with the reason and leaves the run `approved`. The writer runs the pinned Pi inside a
  Luuna-owned detached worktree under the data directory with file tools only and the scope
  guard loaded; in-scope changes become a candidate commit and the run enters `validating`.
- `GET /api/v1/runs/{id}/worktrees`, `GET /api/v1/runs/{id}/attempts`: the run's worktree
  leases (path, base, state, candidate commit) and its attempts.

Repository inspection runs `git` with optional locks disabled and repository-controlled
`core.fsmonitor`/hooks neutralised, so the developer's index and working tree stay
byte-identical. Remote URLs are redacted before storage. Registering or confirming a
project enables no write or plan transition. Feature implementation can be entered only
through the storage gate that checks the durable approval, the current manifest and a
passed, matching baseline per repository in one transaction (see ADR 0007); the first
writer that uses that gate is M2c.

Only one runtime can own a data directory. Startup recovery marks abandoned
active attempts interrupted after obtaining that exclusive ownership. A
Ctrl+C shutdown requests cancellation and waits for supervised cleanup.
At most four demo runs may be active. Prompt acknowledgements and low-level
`agent_end` events do not complete a run: Pi 1.3.0's `agent_settled` is required.
Completion means the connectivity request finished, not a feature passed
validation or a publication was approved.

Each attempt records a `pi.spawned` event with the owned child's PID, the
required Pi version, and the names (never values) of provider credentials the
child received. The terminal `run.*` event is persisted only after that child
has been stopped and reaped, so a PID that is still alive after a terminal event
is a defect. On Unix, `SIGTERM` and Ctrl+C both take the orderly shutdown path.

`node scripts/m1-smoke.mjs --mode real --provider <p> --model <m>` drives a
built runtime binary through the full M1 checklist (authentication, SSE
streaming, settlement before completion, in-flight cancellation with reaping,
provider failure, hard-kill restart interruption, exclusive ownership, orderly
shutdown) and writes a sanitized `report.md`/`report.json`. `--mode fixture`
runs the same checklist against the synthetic fixture and is never provider
evidence.

`cargo test -p luuna-runtime -p luuna-engine-pi` uses the labeled synthetic
Python protocol fixture in `fixtures/pi-rpc`. Python 3 is required for these
subprocess tests. The genuine credential-free RPC probe is documented there.

## Candidate checks, independent review and repair (M3)

After a writer records a candidate, `GET /api/v1/runs/{id}/candidate` returns its exact commit/tree/hash, validation generation, checks, structured review, active state and repair availability. `GET /api/v1/runs/{id}/diff` verifies candidate identity and returns a bounded diff with repository-selected execution drivers disabled.

`POST /api/v1/runs/{id}/validate` accepts `{ "candidate_hash": "sha256:…", "provider": "…", "model": "…", "auto_repair": false }`. Provider/model may use server defaults. Required checks execute in the owned worktree through the supervised executor. A fresh Pi process with read-only tools reviews requirements/code/diff/check records, without the implementation conversation. A valid pass reaches `reviewed`; infrastructure failures, invalid output, stale identities and blocking findings never pass.

`POST /api/v1/runs/{id}/repair` accepts the same candidate hash and optional model settings. The repair gate rechecks current approval, ticket/manifest/base, passed host-matching baseline and all aggregate budgets. Repairs create a fresh candidate revision and require fresh checks/review. The repair writer's prompt quotes the previous candidate's reason, check records, structured review and the last 2 KiB of each failed check's recorded stdout/stderr, at most 16 KiB in total measured after JSON encoding with the last entry cut from the front to fit, from at most 32 artifacts and 64 MiB read per repair on a blocking thread, each opened without following links and labelled from the check result's recorded `truncated_artifacts` when the executor cut it at its 16 MiB cap (with every configured provider credential value of any length and the service token redacted longest-first from the whole artifact before the tail is cut, PEM private-key blocks and bearer/API-token-shaped lines removed best effort, and only when the artifact still matches the digest recorded with the check result), because the writer has no shell and cannot read private artifacts; a repair that only saw an exit code could not act on it. Set `auto_repair: true` on validation to opt into bounded repair cycles for ordinary failed commands or `changes_required` reviews; infrastructure failures stop without automatic edits. The existing cancel endpoint covers the active pipeline, including automatic repairs. Candidate log artifact IDs include `c{revision}-g{generation}-{recipe}.{stdout|stderr}`.

Interrupted checks retain elapsed usage and need a fresh generation. Interrupted model execution reserves unknown spend, so recovery can require a new plan/approval rather than retry with fresh budget. Native host permissions remain unchanged. No publication or merge endpoint is introduced. Real-provider M3 acceptance is recorded separately from deterministic fixture evidence.

`node scripts/m3-smoke.mjs --mode real --provider <p> --model <m>` drives a built runtime binary through the M3 checklist on a disposable fixture repository: register/confirm/baseline with a real `unittest` check, an approved feature → required check → fresh independent reviewer, a seeded failing check → manual repair revision 2 → fresh evidence, a blocking-review probe under bounded `auto_repair`, cancellation while the reviewer is in flight (child reaped), a hard-kill restart during review (interrupted, spend reserved, re-validation refused), developer-checkout integrity and orderly shutdown. It writes a sanitized `report.md`/`report.json` that records credential names only and is scanned for leaked values. `--mode fixture` runs the same checklist against the synthetic fixture and is labeled synthetic; it is never provider evidence. Rebuild the runtime (`cargo build --locked -p luuna-runtime`) from the committed tree: `build.rs` embeds a SHA-256 over every build input, `/health` reports it as `build_identity`, and each run fails unless it equals the digest of the checkout's build inputs and those inputs have no modified or untracked file. On Linux the leak scan and quarantine resolve paths through held directory handles; elsewhere the run records that they are unavailable and refuses recursive cleanup.
