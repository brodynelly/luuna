# Luuna Missions

Git-native tickets and structured work plans. This is Luuna's maintained MIT-licensed fork of [Seeds](https://github.com/jayminwest/seeds), imported from upstream version **0.6.0**. The Luuna package identity is **@luuna/missions-cli**. It is currently a private workspace distribution; no npm release or separate hosted repository is claimed.

Run from this directory with Bun 1.4.3:

```bash
bun install --frozen-lockfile --ignore-scripts
bun src/index.ts --help
bun run verify
```

The primary executable is `luuna-missions` with `lm` as its short alias. Legacy aliases `sd`, `seeds` remain available when the package is linked or installed, so existing integrations continue to work. Direct source execution uses the command above. Some inherited subcommand output and generated integration snippets retain legacy command names; they resolve through these compatibility aliases.

Existing data stays in .seeds/ and preserves its upstream record types, configuration, markers, and environment variables. Branding does not migrate or rewrite user data. Luuna integrates through the CLI/JSON and library boundary; runtime policy and approvals remain Luuna's responsibility.

Self-upgrade is disabled while the package is private. Update through a reviewed Luuna checkout; never replace this fork with a similarly named registry package. Dependency installs do not change Git hooks.

Read [UPSTREAM.md](UPSTREAM.md) for attribution and provenance, [AGENTS.md](AGENTS.md) for development rules, and [the original README](docs/UPSTREAM-README.md) for inherited command examples. Upstream release/runbook documents are historical references and do not authorize publication.
