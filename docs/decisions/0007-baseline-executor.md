# ADR 0007: supervised check execution and baseline-bound implementation gate

Date: 2026-10-17. Status: accepted.

## Context

M2a records confirmed check recipes but executes nothing, and the storage layer rejected `Implementing` with a placeholder guard. R08 requires a usable testing setup and a passing baseline before feature work, and the validation chapter requires evidence that binds to recorded commits, environments and artifacts rather than to a model's claim.

## Decision

1. **A recipe is an executable plus an argument array.** `luuna-executor` resolves the executable on `PATH` or as a repository-relative file under the registered root, verifies declared host capabilities against installed tools, runs in an explicit directory that must stay inside the root, applies the recipe's deadline, and owns the whole process group (Unix) so cancellation and timeouts reap descendants. The child receives the runtime's environment minus Luuna configuration, `GIT_*` variables and anything credential-shaped. Native execution keeps host permissions; the container profile is recorded as blocked until an isolation mechanism exists.
2. **Every outcome is deterministic runtime evidence.** Exit 0 is `passed` only when no recognised test runner reported an empty suite; any non-zero exit, deadline or signal is `failed`; a missing executable, incapable host, dirty checkout, container profile or empty suite is `blocked`; cancellation and runtime restart are `cancelled` and `interrupted`. Output streams into bounded private artifacts whose SHA-256 digests are part of the record, and only short excerpts enter the event stream.
3. **A baseline is a run.** It uses the shared run lifecycle, durable events, replay, SSE, cancellation and restart interruption. It binds to a `BaselineIdentity` (manifest hash, repository, exact HEAD commit and tree) whose hash is each result's `candidate_hash`, and to an environment fingerprint derived from the resolved executables and their versions. A checkout with uncommitted changes is not an exact commit, so its baseline is blocked rather than measured; Luuna-owned worktrees (M2c) will remove that limitation.
4. **Implementation is entered only through `begin_implementation`.** Inside one write transaction it re-reads the durable approval, the bound plan, the project's current confirmed manifest and the latest baseline for every repository in the plan, and requires each baseline to be passed, bound to the plan's manifest hash and base commit, and recorded with the same environment fingerprint. The placeholder guard is gone; a direct `Implementing` transition remains rejected.
5. **Artifacts are addressed by record identity.** `GET /api/v1/runs/{id}/artifacts/{recipe}.{stdout|stderr}` serves the private log for a run the caller is authorised to see; no request names a filesystem path.

## Consequences

`POST /api/v1/projects/{id}/baselines` and `GET /api/v1/projects/{id}/baselines` implement the baseline part of R08. Required recipes decide the verdict; optional recipes run on request and are recorded without affecting it. Empty-suite detection covers cargo, go, pytest and vitest/jest summaries and is a floor, not proof that a suite is meaningful. The first approved writer, worktree ownership and revalidation at scheduling time remain M2c.
