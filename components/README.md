# Luuna components

Luuna maintains three MIT-licensed distributions with space-themed identities. Each retains its upstream implementation and record formats behind a separate integration boundary.

| Component | Responsibility | Primary CLI | Short alias | Origin | Data format |
| --- | --- | --- | --- | --- | --- |
| [Luuna Missions](https://github.com/brodynelly/luuna-missions/blob/55cff87ca4f3a067b7659a929c64f99c88884b3d/README.md) | Tickets and structured plans | luuna-missions | lm | Seeds 0.6.0 | .luuna/missions/ |
| [Luuna Atlas](https://github.com/brodynelly/luuna-atlas/blob/1ce87ca1560f1a5cf5ea5c49ae95e37d5ac35742/README.md) | Expertise and project memory | luuna-atlas | la | Mulch 0.11.0 | .luuna/atlas/ |
| [Luuna Beacon](https://github.com/brodynelly/luuna-beacon/blob/1a3c72f7f8fac57392fbaed6994aca6ae1a2f0a5/README.md) | Composable prompts and instructions | luuna-beacon | lb | Canopy 0.2.6 | .luuna/beacon/ |

[manifest.json](manifest.json) records package names, versions, entrypoints, and compatible data paths for tooling. Packages are private and unpublished. Source now lives in the public repositories [Luuna Missions](https://github.com/brodynelly/luuna-missions), [Luuna Atlas](https://github.com/brodynelly/luuna-atlas), and [Luuna Beacon](https://github.com/brodynelly/luuna-beacon). These directories are exact-commit Git submodules. The manifest commit and Git gitlink must agree; see [ADR 0012](../docs/decisions/0012-independent-component-repositories.md).

The existing automation boundary is CLI execution with structured JSON output (consult each command's help for its output contract). Atlas additionally exports a TypeScript library through src/index.ts and src/api.ts. Missions and Beacon expose executable CLI entrypoints; importing their package main as a service API would execute command-line code and is not a supported integration.

Luuna's runtime will translate domain operations into these interfaces through adapters. Persistent ticket, knowledge, and prompt integration is planned work; this rebrand does not claim that the components are wired into the Luuna runtime yet. The runtime must retain approval, validation, and publication policy ownership. Components must not write directly to Luuna's database or bypass those policies.

Run `npm run components:setup` after cloning Luuna (or use `git clone --recurse-submodules`). Run `npm run components:verify` to check pins and `npm run test:components` for real isolated ticket, knowledge and prompt CLI operations. `npm run components:run -- luuna-missions -- --help` invokes a pinned CLI from your current project directory (including npm --prefix use via INIT_CWD), preserving stdin, stdout, stderr and the component exit status; use luuna-atlas or luuna-beacon for the other tools. This developer launcher is not a runtime adapter and grants no Luuna approval.

`npm run components:stage -- --out <dir> --bun <bun executable>` writes the portable layout the Windows installer ships (the installed trees without Git metadata, `components/dist-manifest.json` with each pin's commit and tree digest, and the pinned Bun); the runtime verifies that layout by content instead of by gitlinks, see [ADR 0024](../docs/decisions/0024-portable-component-distribution.md) and [docs/PACKAGING.md](../docs/PACKAGING.md).

Each component has its own frozen Bun lockfile and can be installed and tested from its directory. Install with `bun install --frozen-lockfile --ignore-scripts`, then run `bun run verify`. The root frontend npm workspace does not resolve or publish these Bun distributions. Executable names (`luuna-missions`/`lm`, `luuna-atlas`/`la`, `luuna-beacon`/`lb`) are package bin mappings; run the documented Bun source entrypoint when working directly from a checkout. The upstream aliases (`sd`, `seeds`, `ml`, `mulch`, `cn`) and `SEEDS_*`/`MULCH_*`/`CANOPY_*` variables are removed in favour of `LUUNA_MISSIONS_*`, `LUUNA_ATLAS_*` and `LUUNA_BEACON_*`. Project data lives under `.luuna/` (`.luuna/missions/`, `.luuna/atlas/` with `config.yaml`, `.luuna/beacon/`); the CLIs and the runtime migrate legacy `.seeds/`, `.mulch/` and `.canopy/` stores automatically. See [ADR 0028](../docs/decisions/0028-luuna-project-component-layout.md).

Upstream LICENSE files, authorship, versions, and provenance are retained in every component. Original source and imported authoring records were preserved outside this checkout before removal. Session histories, authoring stores, and upstream automation instructions are not Luuna project state.

## Updating a component

Make and test source changes in its own repository. After its independent CI passes, fetch and check out the reviewed full commit in Luuna's submodule, update the matching commit in manifest.json, and run components:setup, components:verify and test:components. Commit the gitlink and manifest together for review. Setup uses the committed pin, never --remote; dirty checkouts or incompatible CLI contracts fail visibly. No npm registry publication is required. brodynelly owns component CI and release decisions.

Public component access requires no Luuna credential, deploy key, provider token or private task history. Luuna remains private. Extraction itself did not change ticket authority. The later runtime slice now adds explicit private-store activation, Missions migration/reconciliation and selected Atlas/Beacon plan resources; see [ADR 0014](../docs/decisions/0014-runtime-component-workflows.md). Broader M6 parity and supported-platform evidence remain open.
