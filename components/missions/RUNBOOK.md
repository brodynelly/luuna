# Seeds Operations Runbook

This runbook covers seeds' operational procedures only:

1. Cutting a release of `@os-eco/seeds-cli` to npm.
2. Triaging a failed publish.
3. Rolling back a bad release.

For day-to-day development conventions see `AGENTS.md`; for the design
record see `SPEC.md`. This is a procedural document — read it as
"run X; if Y, then Z", not as Q&A.

## Pre-flight (do once per machine)

- `bun --version` ≥ the `engines.bun` floor in `package.json` (≥ 1.0).
- `gh auth status` → authenticated, with `repo` + `workflow` scopes.
- `git remote -v` shows the canonical origin
  (`github.com/jayminwest/seeds`).
- `npm whoami` → `jayminwest`, with 2FA enabled, if you ever need a
  manual publish.
- Local tree on `main`, fully up to date, `git status` clean.

Normal releases are fully automated by `.github/workflows/publish.yml`.
You should not invoke `npm publish` by hand for a routine release.

## 1. Release procedure

Cut releases from `main` only. Never tag a feature branch.

### 1.1 Decide the version

Follow [SemVer](https://semver.org):

- **MAJOR** — backward-incompatible change to the `sd` CLI surface or
  the JSONL schema (field removed/renamed, command removed).
- **MINOR** — new command, new optional flag, additive schema field.
- **PATCH** — bug fix, doc-only change, internal refactor, dependency
  bump that doesn't change the surface.

While seeds is pre-1.0, breaking changes go in MINOR and additive
changes go in PATCH.

### 1.2 Bump the version in both sources of truth

Seeds' version lives in **two** files, kept in sync and asserted equal
by the publish workflow:

- `package.json` — the `"version"` field.
- `src/version.ts` — `export const VERSION = "X.Y.Z"`.

Drive both from one command:

```bash
bun run version:bump patch        # or: minor | major
git diff package.json src/version.ts   # confirm only the version moved
```

`bun run version:bump` runs `scripts/version-bump.ts`, which rewrites
both files. Do not edit only one — a mismatch fails the release job.

### 1.3 Update the changelog

`CHANGELOG.md` must gain a new top entry under a
`## [X.Y.Z] — YYYY-MM-DD` heading. The publish workflow extracts this
section verbatim for the GitHub release body, so the heading format
matters. Group under Keep-a-Changelog headings (Added / Changed /
Fixed / Removed / Security) and link each line to its `seeds-XXXX`,
`mx-XXXX`, or `#NNN` tracker.

### 1.4 Final gate check

```bash
bun run lint
bun run typecheck
bun test
bun run check:agents
bun run check:size
bun run check:debt
bun run check:coverage
```

All must exit 0. If any fails, **stop** — fix locally and re-run before
proceeding.

### 1.5 Commit and push to main

```bash
git add package.json src/version.ts CHANGELOG.md
git commit -m "release: seeds X.Y.Z"
git push origin main
```

Pushing triggers `.github/workflows/publish.yml`, which:

1. Re-runs lint / typecheck / test in CI.
2. Compares `package.json` `"version"` to the version published on npm.
   If they match it short-circuits to a no-op; otherwise it proceeds.
3. Asserts `package.json` and `src/version.ts` agree on `X.Y.Z`.
4. Publishes `@os-eco/seeds-cli@X.Y.Z` with `--access public`.
5. Tags `vX.Y.Z` and pushes the tag.
6. Creates a GitHub release using the matching `CHANGELOG.md` section.

Watch it run:

```bash
gh run watch
```

### 1.6 Post-release sanity

```bash
git pull --tags
gh release view vX.Y.Z            # release page renders
npm view @os-eco/seeds-cli version   # reports X.Y.Z
```

Smoke-install in a clean dir:

```bash
mkdir /tmp/seeds-smoke && cd /tmp/seeds-smoke
bun install @os-eco/seeds-cli
bunx sd --version                 # prints X.Y.Z
bunx sd --help                    # lists subcommands
```

## 2. Triage a failing publish

When `.github/workflows/publish.yml` exits non-zero, read the log
first, then apply the matching fix.

```bash
gh run list --workflow=publish.yml --limit 5
gh run view <run-id> --log-failed
```

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Version mismatch! package.json=... src/version.ts=...` | The two version sources diverged. | Re-run `bun run version:bump` or hand-sync the two files; push a fix commit. |
| `Version X.Y.Z already published, skipping.` | npm already has this version. | Not an error — the workflow no-ops. Bump if you meant to ship. |
| `npm publish ... 403` | `NPM_TOKEN` secret missing/expired (token rotation). | Repo → Settings → Secrets → update `NPM_TOKEN`; re-run the workflow. |
| `npm publish ... E409` | Version published from a different commit. | Bump to the next patch; do **not** unpublish a live version. |
| `gh release create ... already exists` | Tag `vX.Y.Z` exists from an earlier incomplete run. | Delete the orphan release in the GitHub UI, then re-run. |
| `gh release create ... rate limit` | GitHub release-API rate limit hit. | Wait for the window to reset (check `gh api rate_limit`), then re-run the release step. |
| Empty release body | `CHANGELOG.md` heading didn't match `## [X.Y.Z]`. | Fix the heading format; the workflow extracts that exact section. |
| `tsc` / `biome` / `bun test` fail in CI only | Local greens diverged (env/OS/race). | Reproduce locally; do **not** force-push to `main`. |

Re-run after the fix commit lands on `main`:

```bash
gh workflow run publish.yml --ref main
```

If the workflow only triggers on push, push a no-op commit instead:

```bash
git commit --allow-empty -m "release: retry publish"
git push origin main
```

If the publish half-succeeded (npm published but the GitHub release or
tag is missing), **do not unpublish**. Recover the missing half by hand
(`gh release create vX.Y.Z`, or `git tag vX.Y.Z <sha> && git push origin
vX.Y.Z`) and note the deviation in a `seeds-XXXX` tracker.

## 3. Rollback

A rollback never means unpublishing — npm versions and git tags are
immutable. Rollback means shipping a corrective version.

### 3.1 Decide severity

- **Critical** (data loss, store corruption, total CLI breakage): cut a
  reverting patch within 30 minutes.
- **High** (regression on a common path like `sd ready` or `sd close`):
  cut a patch within the day.
- **Medium / Low**: fix forward on the next planned release.

### 3.2 Revert the offending commit

```bash
git checkout main
git pull
git log --oneline -10
git revert <bad-sha>              # new commit, preserves history
```

The revert goes into the work for `X.Y.(Z+1)`. Resolve any conflicts
from intervening commits.

### 3.3 Restore the version files and re-publish

Confirm `src/version.ts` and `package.json` both reflect the new
`X.Y.(Z+1)` after the revert (a revert of a release commit may roll the
version backward — bump it forward again with `bun run version:bump
patch` if so). Then follow §1.2–§1.5 to ship the follow-up. In
`CHANGELOG.md`, name the rollback explicitly:

```markdown
## [X.Y.(Z+1)] — YYYY-MM-DD

### Fixed
- Reverted <one-line bad-commit summary> from X.Y.Z which caused
  <symptom>. Tracking in seeds-XXXX / #NNN.
```

### 3.4 Deprecate the bad version

Within 72h, an accidental publish can be removed with `npm unpublish`;
after that npm forbids unpublish, so deprecate instead. Prefer
deprecation either way — `unpublish` breaks reproducible installs:

```bash
npm deprecate @os-eco/seeds-cli@X.Y.Z \
  "Critical bug; install X.Y.(Z+1) or later. See CHANGELOG.md."
```

### 3.5 Communicate

- Add a banner to the `vX.Y.Z` GitHub release notes pointing at the
  fixed version.
- Update the `seeds-XXXX` tracker with root cause + remediation links.
- If a downstream consumer (warren, overstory) pinned the bad version,
  open an issue there recommending the upgrade.

## Appendix — Common commands

```bash
git tag --sort=-creatordate | head -5
gh release list --limit 5
gh run list --workflow=publish.yml --limit 5
gh run view <run-id> --log-failed
gh run rerun <run-id> --failed
npm view @os-eco/seeds-cli versions --json
npm view @os-eco/seeds-cli dist-tags
```
