# Luuna components

Luuna maintains three MIT-licensed distributions with space-themed identities. Each retains its upstream implementation and data contracts behind a separate integration boundary.

| Component | Responsibility | Primary CLI | Short alias | Origin | Data format |
| --- | --- | --- | --- | --- | --- |
| [Missions](missions/README.md) | Tickets and structured plans | luuna-missions | lm | Seeds 0.6.0 | .seeds/ |
| [Atlas](atlas/README.md) | Expertise and project memory | luuna-atlas | la | Mulch 0.11.0 | .mulch/ |
| [Beacon](beacon/README.md) | Composable prompts and instructions | luuna-beacon | lb | Canopy 0.2.6 | .canopy/ |

[manifest.json](manifest.json) records package names, versions, entrypoints, and compatible data paths for tooling. Packages are private and unpublished. Source now lives in the public repositories [Missions](https://github.com/brodynelly/missions), [Atlas](https://github.com/brodynelly/atlas), and [Beacon](https://github.com/brodynelly/beacon). These directories are exact-commit Git submodules. The manifest commit and Git gitlink must agree; see [ADR 0011](../docs/decisions/0011-independent-component-repositories.md).

The existing automation boundary is CLI execution with structured JSON output (consult each command's help for its output contract). Atlas additionally exports a TypeScript library through src/index.ts and src/api.ts. Missions and Beacon expose executable CLI entrypoints; importing their package main as a service API would execute command-line code and is not a supported integration.

Luuna's runtime will translate domain operations into these interfaces through adapters. Persistent ticket, knowledge, and prompt integration is planned work; this rebrand does not claim that the components are wired into the Luuna runtime yet. The runtime must retain approval, validation, and publication policy ownership. Components must not write directly to Luuna's database or bypass those policies.

Run `npm run components:setup` after cloning Luuna (or use `git clone --recurse-submodules`). Run `npm run components:verify` to check pins and `npm run test:components` for real isolated ticket, knowledge and prompt CLI operations. `npm run components:run -- missions -- --help` invokes a pinned CLI from your current project directory; use atlas or beacon for the other tools. This developer launcher is not a runtime adapter and grants no Luuna approval.

Each component has its own frozen Bun lockfile and can be installed and tested from its directory. Install with `bun install --frozen-lockfile --ignore-scripts`, then run `bun run verify`. The root frontend npm workspace does not resolve or publish these Bun distributions. Primary and legacy executable names are package bin mappings; run the documented Bun source entrypoint when working directly from a checkout. Existing legacy integration snippets remain usable through compatibility aliases.

Upstream LICENSE files, authorship, versions, and provenance are retained in every component. Original source and imported authoring records were preserved outside this checkout before removal. Session histories, authoring stores, and upstream automation instructions are not Luuna project state.

## Updating a component

Make and test source changes in its own repository. After its independent CI passes, fetch and check out the reviewed full commit in Luuna's submodule, update the matching commit in manifest.json, and run components:setup, components:verify and test:components. Commit the gitlink and manifest together for review. Setup uses the committed pin, never --remote; dirty checkouts or incompatible CLI contracts fail visibly. No npm registry publication is required. brodynelly owns component CI and release decisions.

Public component access requires no Luuna credential, deploy key, provider token or private task history. Luuna remains private. Full Missions ticket reconciliation, Atlas scoped retrieval and Beacon-to-Pi resources remain M6 work; the existing temporary ticket authority is unchanged by extraction.
