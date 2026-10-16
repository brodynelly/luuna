# Luuna Beacon

Prompt composition and versioned agent instructions. This is Luuna's maintained MIT-licensed fork of [Canopy](https://github.com/jayminwest/canopy), imported from upstream version **0.2.6**. The Luuna package identity is **@luuna/beacon-cli**. It is currently a private workspace distribution; no npm release or separate hosted repository is claimed.

Run from this directory with Bun 1.4.3:

```bash
bun install --frozen-lockfile --ignore-scripts
bun src/index.ts --help
bun run verify
```

The primary executable is `luuna-beacon` with `lb` as its short alias. Legacy aliases `cn` remain available when the package is linked or installed, so existing integrations continue to work. Direct source execution uses the command above. Some inherited subcommand output and generated integration snippets retain legacy command names; they resolve through these compatibility aliases.

Existing data stays in .canopy/ and preserves its upstream record types, configuration, markers, and environment variables. Branding does not migrate or rewrite user data. Luuna integrates through the CLI/JSON and library boundary; runtime policy and approvals remain Luuna's responsibility.

Self-upgrade is disabled while the package is private. Update through a reviewed Luuna checkout; never replace this fork with a similarly named registry package. Dependency installs do not change Git hooks.

Read [UPSTREAM.md](UPSTREAM.md) for attribution and provenance, [AGENTS.md](AGENTS.md) for development rules, and [the original README](docs/UPSTREAM-README.md) for inherited command examples. Upstream release/runbook documents are historical references and do not authorize publication.
