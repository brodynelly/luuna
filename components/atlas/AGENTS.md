# Luuna Atlas development

Follow the root [AGENTS.md](../../AGENTS.md) and current Luuna architecture. This component is a maintained fork of Mulch, with provenance in `UPSTREAM.md` and the original MIT notice in `LICENSE`.

Use Bun 1.4.3. From this directory:

```bash
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run check:agents
bun test --timeout 30000
bun run verify
```

Source is in `src/`; tests use Bun and real temporary files. Keep strict TypeScript, existing module conventions, advisory locks, atomic writes, JSON output contracts, and secret redaction. Test changes at the appropriate public boundary.

Primary executable: luuna-atlas (la). Legacy commands and .mulch storage remain compatibility contracts. Preserve configuration keys, record schemas, public types, and environment variables unless an explicit migration is designed and tested. Runtime policy and approval enforcement belong in Luuna, not in a rewrite of this component.

Do not load imported dogfooding stores, session histories, or upstream agent skills as Luuna work records. Do not create them as a development ritual. Installations must not alter the root Git hook configuration. Packages remain private; publication, upstream self-upgrades, and extraction to hosted repositories require a separate reviewed release process.

`bun run verify` is the supported component validation surface (type check, instruction check, tests). Inherited check:all and quality-budget scripts remain available for upstream maintenance comparison; they reference standalone upstream CI and are not the Luuna root CI contract.

Do not commit or push unless explicitly requested. Report remaining work without automatically creating issues or synchronizing component state.
