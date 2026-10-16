# ADR 0002: maintained Luuna component distributions in a monorepo

Date: 2026-10-16. Status: accepted for the foundation; hosted repository extraction deferred.

## Context

The repository imported Seeds, Mulch, and Canopy source with original package identities, repository links, and MIT notices. The architecture audit recommends separate maintained repositories, while an upstream-only dependency would reduce maintenance. The owner explicitly chose Luuna-branded distributions integrated through compatible underlying APIs.

Separate repository creation was attempted but the available GitHub integration lacks creation permission. On October 16, 2026, the owner explicitly directed that the current work be pushed to the existing `brodynelly/luuna` repository and that separation be handled later. This is the current delivery decision, not a task waiting for a new creation credential. Deleting source in anticipation of an unverified migration would risk losing a reproducible foundation. Rebranding a package also does not prove it has been published.

## Decision

Keep the application and these independently identified CLI packages together in `brodynelly/luuna`. Continue product implementation here; do not create component repositories or remove these directories as an onboarding prerequisite.

| Component | Source ancestry | Directory | Package | Primary commands |
| --- | --- | --- | --- | --- |
| Luuna Missions | Seeds | `components/missions/` | `@luuna/missions-cli` | `luuna-missions`, `lm` |
| Luuna Atlas | Mulch | `components/atlas/` | `@luuna/atlas-cli` | `luuna-atlas`, `la` |
| Luuna Beacon | Canopy | `components/beacon/` | `@luuna/beacon-cli` | `luuna-beacon`, `lb` |

Preserve compatible underlying APIs and data formats. Legacy commands may remain compatibility aliases. Preserve upstream copyright, MIT licenses, source provenance, and notices. The product and new Luuna contributions use MIT. Names are distribution identities, not permission to rewrite the tools in Rust.

Keep each tool behind a versioned adapter boundary. Do not automatically consume its task databases, personal histories, prompts, or package-local instructions as Luuna policy. Nested installation lifecycle scripts must not change the root repository's Git hooks configuration.

## Later extraction

Separate hosted repositories are deferred. Revisit extraction when the owner chooses to resume it and it improves maintenance; it does not block M0, M1, or subsequent product milestones. Before removal from the monorepo:

1. Verify destination ownership, read/write access, and release responsibility.
2. Preserve source history/provenance and upstream notices; verify the migrated revision.
3. Establish component CI, compatible APIs, pinned consumers, and release credentials.
4. Test installation/integration from the actual destination.
5. Remove duplicated source only after those checks pass and update dependency/setup records.

The local directory layout does not claim separate repositories or registry packages exist. No publication or remote resource creation is implied by this ADR.

## Consequences

The initial repository stays reproducible and changes remain reviewable. Luuna accepts responsibility for testing its branded distributions. Adapter behavior tests remain distinct from component suites. Private authoring histories and stale imported task records are removed from current tracking after review and are not product fixtures; removing them does not erase Git history.
