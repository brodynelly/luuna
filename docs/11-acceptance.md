# Acceptance and verification scenarios

## Test strategy

Use deterministic domain tests for state rules, fixture repositories for integration behavior, fake engine events for error paths, and a small number of real Pi/provider smoke tests. Mocks cannot establish real engine compatibility or platform process cleanup.

The Luuna product itself needs its test setup at M0. Do not spend model tokens validating behavior that deterministic code can prove directly.

| ID | Scenario | Expected result |
| --- | --- | --- |
| A01 | Fresh supported Mac installation | Local service, browser, and TUI open; doctor reports dependencies |
| A02 | Fresh supported Windows installation | Same core workflow; paths, shell selection, and child cancellation behave correctly |
| A03 | No NAS or cloud account | Local fixture workflow remains available with configured model credentials |
| A04 | Existing three-repository import | Proposed graph includes evidence; developer can correct it |
| A05 | New project | Approved scaffolding establishes tests before feature work |
| A06 | Missing tests | Feature execution is blocked; prerequisite setup ticket is offered |
| A07 | Empty or skip-only baseline | Required test gate does not pass |
| A08 | Existing failing baseline | Feature blocked; results identify the failing baseline |
| A09 | Unapproved/stale plan | Runtime rejects write-task scheduling |
| A10 | Material scope expansion | New approval required; original permission cannot be reused |
| A11 | Two tasks compete for worktree | Only one writer obtains ownership |
| A12 | Parallel repository tasks | Independent work overlaps; dependencies and machine limits hold |
| A13 | Incompatible API/package/app candidates | Cross-repository integration fails and blocks publication |
| A14 | Code changes after check/review | Affected evidence becomes stale; publication blocked |
| A15 | Independent reviewer | New conversation; no implementation transcript; candidate evidence available |
| A16 | Reviewer finds blocking regression | Repair or pause; no PR yet |
| A17 | Repair budget exhausted | Task pauses with logs, diff, attempts, and recommendation |
| A18 | Missing executable or credential | Immediate setup blocker rather than repeated edits |
| A19 | Browser/TUI disconnect | Service continues; reconnect shows authoritative state |
| A20 | Service killed mid-task | Attempt interrupted; recovery reconciles side effects before rerun |
| A21 | Cancel shell with grandchildren | Owned process tree terminates; artifacts preserved |
| A22 | Publication partially succeeds | Existing PR retained; only missing steps retried |
| A23 | Publication times out after remote success | Reconciliation finds existing PR; no duplicate |
| A24 | PR-created CI fails | Distinct CI failure shown; bounded repair invalidates affected evidence |
| A25 | One of several PRs merged | Coordinated ticket remains unintegrated |
| A26 | Manual edit in task worktree | Writer pauses and candidate evidence is invalidated |
| A27 | Imported repo text requests secret upload | Text cannot override runtime policy or approved scope |
| A28 | Personal memory from another project | Excluded unless intentionally shared user preference |
| A29 | Project export | No credentials, personal memory, or required absolute paths |
| A30 | External Seeds edit during run | Revision conflict detected and reconciled |
| A31 | Required iOS check on incapable host | Explicit blocked capability; no false success |
| A32 | Native and container profiles | Profile recorded; actual access matches advertised behavior |
| A33 | Every client capability | Equivalent browser/TUI action and consistent failure explanation |
| A34 | Automatic PR completion | Required evidence exists; human-controlled merge remains intact |

## Platform matrix

Record OS version, architecture, Git/Pi/runtime versions, shell, container engine if used, toolchain, browser, and terminal. Mac ARM64 and Windows x64 are recommended initial release targets. Treat other architectures as explicit matrix entries before advertising support; this is a release-engineering scope, not a claim that every binary already exists.

Linux is recommended for optional server use (the repository itself has no CI; ADR 0041). Native iOS validation needs the appropriate Apple toolchain and host. Android instrumentation and Flutter integration need their declared device/emulator environment. Missing access to a platform is an unmet release test, not a passed scenario.

## Product-level invariants

No unapproved feature write. No false pass from missing evidence. No duplicate publication. No invisible project-scope expansion. No unlimited repair reset. No multi-writer worktree. No implementation transcript in independent review. No automatic merge.

## Performance and reliability measurement

Measure time to first project map, event delivery latency, log rendering with large output, cancellation delay, task overhead, memory growth, model usage, and recovery success. Establish numerical targets after M1 and revisit with the pilot. Avoid fabricated benchmark claims.

## Release evidence

Produce an acceptance report linking requirement IDs to test artifacts, platform matrix entries, real-engine smoke results, known limitations, migrations, and installer versions. A green unit suite alone does not establish the complete product.
