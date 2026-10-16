# Upstream provenance

- Original project: Canopy
- Original package: @os-eco/canopy-cli
- Upstream repository: https://github.com/jayminwest/canopy
- Imported upstream version: 0.2.6
- Import source: the tracked canopy/ tree in brodynelly/luuna at commit 532048d1839d003d724e55e8a47dbfdc44145004 (see repository history for the full tree).
- Luuna identity: @luuna/beacon-cli, in components/beacon/.
- Upstream copyright holder and author: Jaymin West, as retained in LICENSE and package authorship.

The original MIT LICENSE is preserved verbatim. Luuna modifications are also licensed under MIT by Luuna contributors. Original version numbers remain the compatibility baseline; a distinct Luuna release version must be chosen before publication.

Luuna changes include branding, private package metadata, safe installation without Git-hook mutation, current agent guidance, removal of imported authoring/session records, and compiling the fixed config validator before acquiring the write lock to prevent concurrent writers timing out. Storage formats, historical command aliases, exported type names, environment variables, schema fields, and integration markers retain upstream compatibility. No rewrite of the implementation is implied.

These are maintained distributions staged in the product repository. Extract into independently hosted repositories only after those repositories exist and a verified migration preserves source, attribution, and history. This directory is not a Git submodule and the package is not published.

Imported agent instructions and authoring metadata were preserved locally before removal from the working tree. They must not be loaded as Luuna project state. Historical documentation remains reference material; current development starts with the root architecture and AGENTS.md.
