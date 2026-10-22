# ADR 0018: GitHub publication with an intent ledger, observed-only merges, and the `doctor` diagnostic

Date: 2026-10-21. Status: accepted for the M7 publication slice and the host
diagnostic. Implements R11 (automatic linked pull requests) and R12 (the
developer controls merging) on the candidate guards of ADR 0009, with the
durable intent-and-reconcile pattern of ADR 0014 applied to Git and GitHub
writes. Existing approval, baseline, candidate and review decisions remain in
force; nothing here relaxes them.

## Context

A reviewed candidate (ADR 0009: required checks passed, fresh independent
review passed, exact candidate hash) had no way out of the runtime: there was
no publisher, no PR tracking and no way to tell "CI failed on the PR" from
"not integrated". The roadmap's M7 exit requires linked pull requests created
once, recovery from a timeout after remote success and from partial
publication without duplicates, failing CI reported distinctly from
integration, and no automatic merge path. It also requires a diagnostic that
tells a developer on a fresh host what is missing before they start the
service. Publication needs a credential, which the runtime had no mechanism to
hold or pass to Git without exposing it in arguments, logs or events.

## Decision

1. **GitHub only, by registered identity.** Publication parses `<owner>/<repo>`
   from the repository's confirmed manifest remote: `https://github.com/…`,
   `ssh://git@github.com/…` or `git@github.com:…`, with or without `.git`.
   Any other host or shape is refused with the reason. Before pushing, the
   runtime reads the developer checkout's configured `remote.origin.url`
   (read-only) and refuses unless it redacts to an identity equivalent to the
   registered one. The effective push URL is `git remote get-url --push
   origin`, that is, after the developer's own `url.<base>.insteadOf` /
   `pushInsteadOf` rewrites; those are machine-local transport choices, not a
   change of identity. The push names that URL rather than the remote name, so
   no remote-tracking reference is written into the developer checkout.

2. **Credential mechanism.** `LUUNA_GITHUB_TOKEN` is read once at startup into
   the publication settings; only its presence is ever reported (health,
   `doctor`, logs, `Debug`). Git receives it through `GIT_CONFIG_COUNT` /
   `GIT_CONFIG_KEY_n=http.https://github.com/.extraheader` /
   `GIT_CONFIG_VALUE_n=Authorization: Bearer …`, scoped to the GitHub HTTPS
   origin so a push to any other host never carries it; `credential.helper` is
   cleared and `GIT_TERMINAL_PROMPT=0`/`GIT_ASKPASS=` prevent prompts and
   helpers. The REST API receives it as a bearer header from the runtime's own
   HTTP client (reqwest with rustls and the `ring` provider; no system TLS
   toolchain is required to build). `LUUNA_GITHUB_API_URL` selects the REST
   base (default `https://api.github.com`); only `https://` or a loopback
   `http://` address is accepted, so tests can point it at a fake server.

3. **One publication per run and candidate hash; branches are derived.**
   `POST /api/v1/runs/{id}/publish` with `{expected_hash, idempotency_key}` is
   refused, naming the next allowed step, unless the current candidate is
   `reviewed` with a `passed` verdict, its hash matches, no writer is active
   for the run or for any of its repositories, the ticket source is current
   (the Missions freshness check of ADR 0014) and the confirmed manifest is
   the one the plan was made for. The branch is
   `luuna/<ticket_id>/<first 12 hex of the candidate hash>`; the pull request
   targets the manifest's default branch and its body names the ticket,
   candidate hash, run and evidence summary. Repeating the same key returns
   the existing record without side effects; a different key for the same
   candidate is refused.

4. **Intent ledger before every external write.** Each repository step (`push`,
   `pull_request`, `link`) records an intent under a stable key
   (`<run>:<hash>:<repository>:<step>:<branch>:<commit>`) before the call and
   settles it `succeeded`, `failed` or `uncertain` after. A push first runs
   `git ls-remote`: a branch already at the candidate commit is success
   without a push (timeout after success); a branch at another commit is a
   failure that leaves the remote alone. A pull request is first looked up by
   head (`pulls?head=<owner>:<branch>&state=all`) and reused when it exists;
   a creation that times out is `uncertain`, never retried blindly. Partial
   success leaves the record `failed` with per-repository detail;
   `POST /api/v1/runs/{id}/publication/reconcile` re-runs only steps the
   ledger does not show succeeded, looking at the remote first, so a timeout
   after remote success and a push without a PR both recover without a
   duplicate. With several repositories, every PR body links the others once
   all exist.

5. **Observation only; no merge anywhere.** `GET /api/v1/runs/{id}/publication`
   refreshes CI (`check-runs` plus the combined commit status) and merge state
   (`merged`, `merged_at`, `merged_by`) per pull request under bounded
   timeouts. An observation failure leaves `ci.state: unknown` with its
   reason; a failing check is `ci.state: failure` and changes nothing else:
   candidate evidence, the run state and the publication state stay as they
   are. `integrated` is set, once, only when every pull request is observed
   merged on GitHub; the event names that a person merged it. There is no
   merge route, no merge client call and a test asserts both. The developer
   controls merging (R12); an automatic merge is out of v1 by decision, not by
   omission.

6. **Durable events.** `publication.requested`, `publication.pushed` (per
   repository, with `already_on_remote`), `publication.pr_opened` (per
   repository, with `reused_existing`), `publication.failed` (with per-step
   reasons), `publication.reconciled` and `publication.integrated` are run
   events, so a client replays them like every other state change.

7. **`luuna-runtime doctor [--data-dir <dir>] [--json]`.** Reports Git, Python
   and Node versions, the resolved Pi launcher and its `--version` probe (the
   engine's own probe, in a private temporary directory, no model call), the
   data directory's existence and writability, the database's integrity and
   schema version (the `check` inspection), the presence of `LUUNA_API_TOKEN`
   and `LUUNA_GITHUB_TOKEN`, the names of configured provider credentials,
   whether the service port (`LUUNA_PORT`, default 4242) is free or already
   answers `/health` as Luuna, and whether the pinned component toolchain is
   discoverable. Git, Pi and a writable data directory are required; an
   existing database that is damaged or too new also fails the report because
   the service would refuse it. The exit status is 1 in those cases. No value
   of any credential is printed.

## Consequences

- Storage migration 11 adds `publications` (one row per run and candidate
  hash; state and the full record) and `publication_intents` (the ledger).
  Records are rewritten in place as steps settle; the run event stream keeps
  the history.
- Publication runs as a supervised owned worker like a writer: it holds the
  run's active slot, so it is counted against the four-run bound, is signalled
  by shutdown and is never duplicated by a concurrent request.
- The ADR 0014 rule applies to GitHub: an uncertain write is looked up by its
  stable identity (branch name, PR head) before any retry; retries never
  invent new authority and never force-push.
- A developer's `insteadOf` rewrite is honoured for transport; the identity
  check still runs on the configured URL. The fixture tests rely on exactly
  this to publish into a local bare repository under a GitHub-shaped identity.
- Deleting or rewriting the remote branch outside Luuna is not repaired: a
  branch at another commit fails the push step with its reason and the
  developer resolves it.

## What remains

- **Real GitHub evidence.** Every test runs against a local bare repository
  and a fake REST server. A genuine push and pull request with a real token,
  CI observation on a real workflow and a human merge on GitHub are the M7
  exit evidence and have not been produced.
- **Multi-repository candidate sets** are handled by the publisher (one
  branch per repository, linked bodies); the linking path gained synthetic
  end-to-end evidence with the second 2026-10-22 amendment below, real
  GitHub evidence remains outstanding.
- **Signed installers and a host update policy** (M7's portable installation
  half) are untouched by this decision; `doctor` is the diagnostic they will
  ship with.
- **Repair after CI failure** (A24's bounded repair that invalidates affected
  evidence) was reported by `ci.state: failure` but not driven into the
  repair workflow until the second 2026-10-22 amendment below; the developer
  still chooses to repair or re-plan.

## Amendment (2026-10-22): publication revalidates every authoritative input

The October 22 specification audit reproduced two publication-policy
failures against this decision as first implemented: a candidate whose
Luuna-owned worktree had been edited by hand after the review was still
published (its frozen commit was pushed, A14/A26), and a candidate was
published after a newer plan revision had superseded the approval it was
implemented under (A09/E02). Source inspection also showed that publication
checked ticket freshness only through the Missions source check, not the
plan's ticket revision or the approved component context, and that no
deterministic secrets/path policy ran before the push
(docs/08-validation.md "Publication rules"). The decision is amended:

1. **Authorization is the validation/repair gate, reused.** `prepare` calls
   `Store::authorize_workflow`, the read-only form of the transactional
   `current_plan` gate: the durably stored approval must authorize the
   *latest* revision of its plan, and the plan's ticket and manifest
   bindings must hold. A newer plan revision therefore refuses publication
   and reconciliation of the earlier revision's candidate (`409`, naming the
   superseding revision and the next step); the candidate evidence stays as
   it is, valid for the revision it was made for.
2. **Admission after the gate, before any side effect.** `admit` runs for the
   initial publication and for every reconciliation, after the
   transactional gate and before the supervised job is spawned:
   `integrations::verify_plan_sources` (the ticket revision the plan was made
   for and the exact approved memory/prompt snapshots re-resolved from the
   components); every repository's Luuna-owned worktree resolved from its
   lease and verified to hold exactly the frozen candidate HEAD, tree and
   tracked content (`candidates::content_drift`); and the pre-push policy of
   point 3. A missing or unverifiable worktree refuses publication: the
   frozen commit alone is not evidence that nothing changed.
3. **Deterministic pre-push policy (`crates/luuna-runtime/src/policy.rs`).**
   The exact patch between the planned base and the candidate commit of each
   repository (`review_diff`, 16 MiB budget) is scanned without any model or
   network: changed paths are re-checked against the approved task scope with
   the writer's own `check_scope`; credential stores by name (`.env` and
   `.env.*` except documented placeholders, key material extensions, SSH and
   cloud credential files and directories) are refused; added lines are
   refused when they carry a private key block, a known credential prefix
   (GitHub, GitLab, Slack, Anthropic, Stripe, npm, Google, AWS), a signed
   JSON web token, a password inside a URL, a credential-shaped literal
   assigned to a secret-named key, or a credential value this runtime was
   configured with. A file whose patch exceeds the scan budget is refused as
   unscanned. Findings name the repository, path, rule and line, never the
   matched text; the refusal is `422` and the reviewed evidence is kept.
4. **Drift after review invalidates the candidate.** When the worktree no
   longer holds the frozen candidate, `Store::invalidate_reviewed_candidate`
   marks the candidate failed with content drift (never re-validated in
   place), moves the run from `reviewed` to `failed` (a structural transition
   the domain now admits solely for post-review invalidation) and records
   `candidate.invalidated`; the worktree is kept for inspection and the next
   step is a repair revision in a fresh worktree or the next plan revision.
   Nothing is pushed.
5. **Durable refusals.** Every admission refusal is a `publication.refused`
   run event with `kind` (`source_changed`, `worktree_unverifiable`,
   `candidate_drift`, `policy`), the candidate hash and the reason (and the
   findings for `policy`). Refusals of the synchronous gate (pending or
   failed candidate, stale hash, superseded revision) remain responses only,
   as before. Because a reviewed workflow can still change (publication,
   invalidation), its event stream no longer closes at `reviewed`.
6. **Idempotent replay is unchanged.** A repeated idempotency key returns the
   existing record before any gate, and reconciliation of a complete record
   returns it unchanged; only a publication that still has steps to perform
   is re-admitted.

Tests (`crates/luuna-runtime/tests/publication.rs`, eleven scenarios): a
newer plan revision refuses publication and reconciliation of the earlier
candidate (the pushed branch of a partial publication is left alone, no pull
request is retried); a manual edit in the owned worktree after the review
refuses publication and reconciliation, invalidates the candidate with the
drift marked and pushes nothing; a candidate carrying a GitHub-shaped token
and a `.env` file (`write_secret` synthetic writer scenario) passes its check
and review and is refused by the policy with findings that never contain the
values. The ticket-revision case of `verify_plan_sources` is exercised through
the ticket editing route (ADR 0026) rather than here.

## Amendment (2026-10-22, second): CI-driven bounded repair and linked-set evidence

The October 22 specification audit (finding 5) held two further gaps against
this decision: A24's "PR-created CI fails → distinct CI failure shown;
bounded repair invalidates affected evidence" was reported by `ci.state:
failure` but never driven into the repair workflow ("What remains"), and
the linked multi-repository publication path (A22/A25, the M7 exit) had no
end-to-end evidence. The decision is amended:

1. **`POST /api/v1/runs/{id}/publication/repair`** with `{candidate_hash,
   provider, model}` (the shape of `POST …/repair`) is the bounded repair
   after CI failed on a published candidate. Its gate, in this order and
   before anything changes: no work may be active for the run; the run's
   latest publication must exist, be complete and `pr_open` (a `failed`
   record is reconciled first, an `integrated` one has nothing to repair, a
   superseded one is refused naming the repaired candidate); the hash must
   be that publication's; the CI observation is refreshed through the same
   bounded `observe` as `GET …/publication`, so a stale view never triggers
   a repair, and must be `failure` on at least one repository (an `unknown`,
   `pending` or `success` observation is refused naming each repository's
   state, its reason and the next step); and
   `Store::can_repair_after_ci_failure` applies the authorization, binding
   and budget half of the ordinary repair gate (`repair_budget_gate`, shared
   with `POST …/repair`: the current approved plan, ticket and manifest, the
   ADR 0017 multi-repository limitation with its re-planning reason,
   `max_task_repairs`, and attempt, time and cost headroom) while the
   candidate is still `reviewed`, so a repair the budgets would refuse never
   costs the candidate its review. A CI repair counts as a task repair.
2. **Effect.** The reviewed candidate is invalidated with
   `invalidate_reviewed_candidate(…, content_drift: false)` and a reason that
   names, per failing repository, the pull request and the failing checks by
   name and conclusion (`ci-unit failure`), never GitHub log content; the
   run moves `reviewed -> failed` and `candidate.invalidated` is recorded as
   in the first amendment. The publication record gains
   `superseded_by_repair: true`, `superseded_reason` and `superseded_at`;
   its `publication_state` stays as observed (the enum is unchanged) and the
   pull request stays open: Luuna never closes or merges it. Then
   `publication.repair_requested` is recorded with the candidate hash, the
   candidate's new status and a `ci_failure` summary (repository, pull
   request, commit, every observed check, the failed checks), and the
   existing repair path (`writer::repair_after_ci_failure`, the same
   `schedule_writer` as `POST …/repair`) creates the next candidate revision
   in a fresh worktree; the attempt's provenance is `trigger: ci_repair`.
   The repair writer's evidence envelope carries a `ci_failure` section
   beside the previous checks, output and review: it is data inside the
   marker-delimited block, redacted and bounded with the rest. If the writer
   path refuses after the invalidation (a moved HEAD, a lost baseline), the
   refusal says so and names `POST /repair` as the next step; the
   invalidation stands, since CI did fail on the reviewed candidate.
3. **The next publication supersedes the first.** The repaired candidate is
   validated and reviewed afresh and published under its own record (one
   record per run and hash, as before) on its own branch; its pull request
   body carries a `## Supersedes` section naming the earlier pull request by
   number and URL, the earlier candidate hash and branch, and the recorded
   reason. `Store::publications(run_id)` lists a run's publications for this;
   `GET …/publication` keeps returning the newest record.
4. **Linked-set bodies state dependencies and merge order.** With several
   repositories every pull request body names the others by URL (as before)
   and adds `## Dependencies and merge order`: the set's repositories in
   producer-before-consumer order derived from the candidate set's
   `<consumer>:<producer>` bindings (`publication::merge_order`), each
   consumer with the exact producer commit it was bound to, the current pull
   request marked, and the statement that the pull requests are not merged
   atomically and that a partial merge leaving the rest obsolete calls for
   re-planning (docs/08-validation.md "Publication rules").
5. **Clients.** `runs.publication.repair` in the capability catalog, the
   `repairPublication` client method (returning the superseded record plus
   the run now implementing), the TUI command `publication-repair` and a
   desktop control shown only when the publication for the displayed
   candidate is open and reports a CI failure; the desktop marks a
   superseded publication.

Tests. `crates/luuna-runtime/tests/publication.rs` (twelve scenarios) adds
the CI repair against the shared fake GitHub
(`tests/support/mod.rs`, pull requests numbered per repository, failures,
check runs and merges switchable per repository): the repair is refused while
CI is unknown, pending or passing and for a stale hash with nothing
invalidated; a failing `ci-unit` check admits it, the candidate is `failed`
with `content_drift: false` and a reason naming the check, the run is
`failed`, `candidate.invalidated`, `publication.repair_requested` and
`candidate.repair_started` follow in that order, the attempt is `ci_repair`,
the synthetic `ci_repair` writer (fixtures/pi-rpc/mock_pi.py) repairs only
when its prompt carries the `ci_failure` evidence and the check's name, the
new revision validates and reviews, the first record reads superseded and is
refused a second repair, publishing the new hash opens pull request 2 on a
new branch whose body names pull request 1 as superseded while branch and
pull request 1 are left alone, `max_task_repairs` refuses a further CI repair
before anything is invalidated, and no merge-, close- or delete-like request
is ever sent. `crates/luuna-runtime/tests/publication_multirepo.rs` (five
scenarios) drives the three-repository fixture of `multirepo.rs` under
GitHub-shaped identities with per-repository bare remotes: a reviewed set
publishes three branches at the exact commits and three pull requests (one
`POST` each) whose bodies, after linking, name the other two and the
`api`, `shared`, `consumer` order with the bindings; a creation failure on
the second repository in publication order leaves the first open, the third
attempted and opened and linking withheld, and `reconcile` completes the set
with exactly one more creation, no second push and linked bodies; one
repository merged keeps `pr_open` with that repository's `merge.merged` and
no `publication.integrated`, all merged is `integrated` once; a newer plan
revision refuses reconciliation of the partial set with the pushed branches
left alone; a manual edit in one repository's worktree refuses the set
naming that repository, invalidates the candidate and pushes to no remote.
The developer checkouts are byte identical throughout.

What remains unchanged from "What remains": real GitHub evidence (a genuine
push, pull request, CI run and human merge) has still not been produced;
repair of a multi-repository set, CI-failed or not, is still re-planning.
