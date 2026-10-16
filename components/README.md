# Luuna components

Luuna maintains three MIT-licensed distributions with space-themed identities. Each retains its upstream implementation and data contracts behind a separate integration boundary.

| Component | Responsibility | Primary CLI | Short alias | Origin | Data format |
| --- | --- | --- | --- | --- | --- |
| [Missions](missions/README.md) | Tickets and structured plans | luuna-missions | lm | Seeds 0.6.0 | .seeds/ |
| [Atlas](atlas/README.md) | Expertise and project memory | luuna-atlas | la | Mulch 0.11.0 | .mulch/ |
| [Beacon](beacon/README.md) | Composable prompts and instructions | luuna-beacon | lb | Canopy 0.2.6 | .canopy/ |

[manifest.json](manifest.json) records package names, versions, entrypoints, and compatible data paths for tooling. Packages are private and unpublished. The owner's October 16, 2026 decision keeps all three distributions in `brodynelly/luuna` while product work continues. Separate repositories are deferred; see [ADR 0002](../docs/decisions/0002-supporting-components.md).

The existing automation boundary is CLI execution with structured JSON output (consult each command's help for its output contract). Atlas additionally exports a TypeScript library through src/index.ts and src/api.ts. Missions and Beacon expose executable CLI entrypoints; importing their package main as a service API would execute command-line code and is not a supported integration.

Luuna's runtime will translate domain operations into these interfaces through adapters. Persistent ticket, knowledge, and prompt integration is planned work; this rebrand does not claim that the components are wired into the Luuna runtime yet. The runtime must retain approval, validation, and publication policy ownership. Components must not write directly to Luuna's database or bypass those policies.

Each component has its own frozen Bun lockfile and can be installed and tested from its directory. Install with `bun install --frozen-lockfile --ignore-scripts`, then run `bun run verify`. The root frontend npm workspace does not resolve or publish these Bun distributions. Primary and legacy executable names are package bin mappings; run the documented Bun source entrypoint when working directly from a checkout. Existing legacy integration snippets remain usable through compatibility aliases.

Upstream LICENSE files, authorship, versions, and provenance are retained in every component. Original source and imported authoring records were preserved outside this checkout before removal. Session histories, authoring stores, and upstream automation instructions are not Luuna project state.
