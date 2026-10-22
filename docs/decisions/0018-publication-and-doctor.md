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
  branch per repository, linked bodies), but M4 has not produced such a set
  through the runtime, so the linking path has no end-to-end evidence.
- **Signed installers and a host update policy** (M7's portable installation
  half) are untouched by this decision; `doctor` is the diagnostic they will
  ship with.
- **Repair after CI failure** (A24's bounded repair that invalidates affected
  evidence) is reported by `ci.state: failure` but not yet driven into the
  repair workflow; the developer chooses to repair or re-plan.
