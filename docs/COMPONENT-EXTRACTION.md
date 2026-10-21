# Independent component repository evidence

October 21, 2026. Luuna source baseline: `fd42d59c5f608b9120d9cdc2e2354b66f945a5ed`. Decision: [ADR 0011](decisions/0011-independent-component-repositories.md).

The owner explicitly authorized three public component repositories. Luuna remains private. This migration does not publish npm packages or change runtime ticket authority.

| Component | Destination and immutable consumer pin | Independent full verification |
| --- | --- | --- |
| Missions | [brodynelly/missions](https://github.com/brodynelly/missions), `b9166821144fd373328930f4a44856448e8de77b` | [CI passed](https://github.com/brodynelly/missions/actions/runs/39655004223) |
| Atlas | [brodynelly/atlas](https://github.com/brodynelly/atlas), `18fc7e2c526d3f7a0ac4c2850573c21ca5964819` | [CI passed](https://github.com/brodynelly/atlas/actions/runs/39655044656) |
| Beacon | [brodynelly/beacon](https://github.com/brodynelly/beacon), `0330712a76fec338498d4b683a4d8ec9474f77d0` | [CI passed](https://github.com/brodynelly/beacon/actions/runs/39655069583) |

## Preservation and destination verification

- Extracted component-scoped maintained history with `git subtree split` and checked the baseline Git tree against the original `HEAD:components/<name>` tree before changing standalone metadata. Both maintained commits are present in each destination. Earlier pre-branding import provenance remains in UPSTREAM.md and Luuna's retained history.
- Compared Git object identities for each `src` tree, `bun.lock` and `LICENSE` against the source baseline: all identical. Runtime/data implementation, JSON formats, aliases, source versions and dependency graphs did not change.
- Scanned every extracted commit for tracked authoring/session stores, real environment files and recognizable credential patterns before the authorized public push. Only the component history was pushed, with no original Luuna refs. This is a bounded repository hygiene check, not a universal secret-detection claim.
- Verified the authenticated owner, destination visibility, push access and remote `main` SHA. Each destination is public and owned by brodynelly, who owns CI and release decisions. Registry packages remain private, self-upgrade remains disabled, and public consumption needs no release secret or deploy key.
- Cloned actual GitHub destinations, installed frozen Bun dependencies without scripts and exercised their real source entrypoints through Luuna's consumer launcher. Conversion removes tracked source duplication only after this destination verification.

## Commands and observed evidence

Tooling: Bun 1.4.3. Windows local consumer checks used Node 26.10.0, allowed by the repository's Node minimum; GitHub Actions pins Node 24.19.0. Component verification runs on Linux with Bun 1.4.3 and Node 24.19.0 in each destination CI.

| Check | Observed result |
| --- | --- |
| Independent destination CI: `bun install --frozen-lockfile --ignore-scripts`, `bun run verify` | All three passed; includes typecheck, instruction validation and complete inherited suites |
| Windows destination typecheck and instruction checks | Passed for all three repositories |
| `node scripts/components.mjs setup` in the isolated Luuna consumer checkout | Passed; exact remote source pins, frozen installs, no change to root hooks |
| `node scripts/components.mjs verify` | All three manifest/gitlink/checkout identities and CLI contracts passed |
| `node scripts/components-smoke.mjs` on Windows | 12/12 genuine CLI operations passed: Missions init/create/show/list, Atlas init/add/record/search, Beacon init/create/render/list; only temporary test stores used |
| `node --test scripts/components.test.mjs` on Windows | 5/5 passed, including missing checkout, changed pin, moved checkout, dirty tree, wrong URL, incompatible alias and missing dependencies |
| Root schema fixture command | 20/20 passed |
| `npm run typecheck`, `npm run build` on Windows | Passed |
| `node scripts/check-hygiene.mjs`, `git diff --check` | Passed |
| Root `npm test` on Windows from unchanged baseline guard source | Stopped at all five pre-existing scope-guard fixtures because Windows denied directory symlink creation with `EPERM`; this is not a passing full test run. Existing native-platform work is preserved separately, not imported into the extraction branch |

Luuna's CI runs the consumer setup, verification and real CLI smoke on Linux, macOS and Windows. Platform results must be read from the migration PR's actual check runs; workflow configuration alone is not passing evidence.

## Setup, updates and rollback

Run `npm run components:setup` after a fresh Luuna clone. Plain `git clone --recurse-submodules` retrieves source but still needs frozen dependency installation. `npm run components:run -- missions -- --help` invokes the approved pinned source; atlas and beacon follow the same interface. The root npm workspace remains separate from these Bun packages.

To update, review the component's own change and CI, fetch/check out its exact commit in the submodule, update the manifest commit, and commit both manifest and gitlink in the Luuna PR. Setup never uses a floating branch or silently overwrites local changes. Reverting the extraction commit restores Luuna's original tracked component trees; no original monorepo history is rewritten. Local source rollback copies remain outside tracking during migration.

Full M6 runtime ticket reconciliation, scoped memory retrieval and explicit prompt resources remain planned. The migration preserves the existing CLI/library boundary and verifies real consumption; it does not claim those runtime adapters now exist. No provider or native desktop result is inferred from CLI tests.
