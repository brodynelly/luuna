# Seeds — V1 Scope

## One-Liner
Git-native issue tracker for AI agent workflows — create, track, and close issues stored as diffable JSONL records with concurrent-safe locking.

## V1 Definition of Done

- [x] Core issue lifecycle works: `create`, `show`, `list`, `update`, `close`
- [x] Filtering works: `list` supports `--status`, `--type`, `--assignee`, `--label`, `--label-any`, `--unlabeled`, `--limit`, `--all`
- [x] `ready` surfaces unblocked work (no open blockers)
- [x] Blocking system works: `block`, `unblock`, `blocked`
- [x] Dependency tracking works: `dep add`, `dep remove`, `dep list`
- [x] Label management works: `label add`, `label remove`, `label list`, `label list-all`
- [x] Template system works: `tpl create`, `tpl step add`, `tpl list`, `tpl show`, `tpl pour`, `tpl status`
- [x] Project diagnostics work: `stats`, `doctor` (with `--fix`), `sync`
- [x] Agent integration: `prime` outputs usable context, `onboard` installs to CLAUDE.md
- [x] Concurrent safety: advisory file locking + atomic writes prevent corruption under multi-agent access
- [x] Worktree detection resolves to main repo `.seeds/` correctly
- [x] `--json` flag produces structured output on all commands (for programmatic consumption by overstory)
- [x] All tests pass (`bun test`) — 235 tests across 18 files
- [x] TypeScript strict mode clean (`bun run typecheck`)
- [x] Linting passes (`bun run lint`) — 35 warn-level `noNonNullAssertion` warnings, all post-check (non-blocking)
- [x] CI pipeline runs lint + typecheck + test on push/PR
- [x] Published to npm as `@os-eco/seeds-cli` at v0.2.5

## Explicitly Out of Scope for V1

- GitHub Issues sync (bidirectional or one-way)
- Web UI or visual board
- Milestone / release tracking
- Time tracking or estimation fields
- Custom fields beyond the fixed schema
- Issue comments or discussion threads
- Notification system
- Search command (full-text search across issues)
- Archive vs. delete semantics
- Multi-repo issue aggregation
- Priority auto-assignment or triage intelligence

## Current State

Seeds is V1-complete. All 21 CLI commands are implemented. 235 tests pass across 18 files. TypeScript strict mode and linting are clean. CI is green. The `--json` output mode is used by overstory for programmatic integration. Published to npm at v0.2.5.

**Completion: 100% of V1 scope implemented.** One minor code quality fix pending before close.

---

## Audit Findings (2026-03-07)

Two parallel audits were conducted: a source code quality audit (`source-scout`) and a test coverage audit (`tests-scout`). Findings are consolidated here.

### Source Code Audit — V1 Readiness Report

**Verdict: V1 Ready.** No blocking issues.

#### Positive Findings

- No `any` types anywhere — strict TypeScript with `noUncheckedIndexedAccess` enforced
- All 235 tests pass across 18 files; TypeScript compilation clean
- Each command has a dedicated file in `src/commands/` (20 command implementations + `completions`)
- All 20 primary commands support `--json` output (`completions` intentionally excluded)
- Version consistency verified: `package.json` (0.2.5) == `src/index.ts` (0.2.5)
- Advisory locking pattern proven and consistent throughout `store.ts`
- No TODO/FIXME/XXX markers in codebase (~7,264 LOC total)
- CI/CD: `ci.yml` enforces lint + typecheck + test on every push/PR; `publish.yml` auto-tags, publishes to npm, creates GitHub releases

#### Issues Identified

| # | Severity | Location | Description |
|---|----------|----------|-------------|
| 1 | **High** (consistency) | `src/index.ts:15` | `process.exit()` used for `--version --json` output; convention requires `process.exitCode = 0; return` |
| 2 | Very Low (style) | `scripts/version-bump.ts` | Utility script uses `process.exit(1)` — optional, non-blocking |
| 3 | Non-blocking | Multiple files | 35 Biome `noNonNullAssertion` warn-level diagnostics; all are post-existence-check and safe |
| 4 | None | Test org | `block.ts` has no dedicated `block.test.ts` — covered in `unblock.test.ts` (17 tests); appropriate |

**Action required before final close:** Fix issue #1 (`src/index.ts:15` — `process.exit()` → `process.exitCode = 0; return`).

---

### Test Coverage Audit — V1 Readiness Report

**Verdict: Functional V1 complete; test gap exists but does not block operation.**

#### Coverage Summary

| Status | Commands |
|--------|----------|
| Tested (11/21) | completions, create, dep, doctor, init, label, onboard, prime, sync, tpl, unblock |
| Untested (10/21) | block, blocked, close, list, migrate, ready, show, stats, update, upgrade |

#### Untested Commands — Priority Assessment

**CRITICAL** (most complex logic, highest regression risk):
- `close` — cascading unblock of dependent issues (lines 71–83 of close.ts); close reason, timestamps, multi-issue
- `update` — 10+ flags: `--status`, `--type`, `--priority`, `--title`, `--assignee`, `--description`, `--add-label`, `--remove-label`, `--set-labels`; mutations must not affect other issues
- `list` — filtering logic: `--status`, `--type`, `--assignee`, `--label`, `--label-any`, `--unlabeled`, `--all`, `--limit`; combined AND logic

**HIGH** (core workflow):
- `ready` — blocker resolution: only open issues, filters by closed blockers, multiple-blockers-all-must-close
- `block` — bidirectional `blocks`/`blockedBy` update; duplicate idempotency; non-existent issue errors

**MEDIUM**:
- `show` — non-existent issue error, JSON output format, full detail rendering
- `blocked` — list all blocked issues, multiple blockers, empty-list message

**LOW** (secondary commands):
- `stats`, `migrate`, `upgrade`

#### Edge Cases Missing from Tested Commands

- `create.test.ts`: invalid types/priorities should be rejected; boundary values (P0, P5); `--description`/`--assignee` flags not tested
- `dep.test.ts`: circular deps (A→B, B→A), self-dependency (A→A), cascading remove
- `label.test.ts`: case normalization verification, empty label handling
- `store.test.ts`: corrupted JSONL lines, lock contention under concurrent writes, lock timeout, large files

#### Test Strengths

1. Real I/O pattern throughout: `mkdtemp` + actual CLI invocation (`Bun.spawn`)
2. JSON mode tested alongside text mode on most commands
3. Bidirectional state updates verified (e.g. `block`/`blocks` fields in unblock.test.ts)
4. Idempotency tested (duplicate label adds, duplicate unblocks)
5. Helper pattern (`run()`/`runJson()`) reduces boilerplate consistently

---

## Open Questions (Resolved)

| Question | Resolution |
|----------|-----------|
| Should `seeds-5960` (labels support) be closed? | Labels are fully implemented and shipped in v0.2.5. Issue can be closed. |
| Is `migrate-from-beads` still needed? | Yes, 100% still needed for V1. |
| Does the test gap block V1? | No — the 10 untested commands are implemented and working. Test gap is a quality debt item, not a functional blocker. Tests should be added post-v1 or as part of a follow-up sprint. |

## Post-V1 Backlog (Test Debt)

These items emerged from the test audit. Not blocking V1 release, but should be addressed in a follow-up:

1. `close.test.ts` — cascading unblock, multi-issue close, timestamps
2. `update.test.ts` — all 10+ fields, validation, mutation isolation
3. `list.test.ts` — all filter combinations, AND logic, `--all`, `--limit`
4. `ready.test.ts` — blocker resolution, multiple-blocker logic
5. `block.test.ts` — bidirectional updates, idempotency, error cases
6. `show.test.ts` — error handling, JSON output
7. `blocked.test.ts` — query state, empty list
8. `store.test.ts` expansion — lock contention, corrupted JSONL, large files
9. `stats.test.ts`, `migrate.test.ts`, `upgrade.test.ts` — lower priority
