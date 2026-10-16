# Imported tooling privacy and repository hygiene review

Date: October 16, 2026. Baseline: `532048d1839d003d724e55e8a47dbfdc44145004`.

## Result

The imported tool authoring records do not belong in Luuna's active project context. They have been preserved outside the checkout and removed from the working tree during the component migration. No likely live credential was identified by the local signature scan described below. This is a bounded scan result, not proof that the repository's entire published history is secret-free.

The original baseline remains in Git history. Removing files in this change does not remove earlier commits or invalidate any credential. No history rewriting, credential rotation, publishing, or remote deletion was performed.

## Inventory and disposition

The baseline had 642 tracked files. The following 103 files were imported authoring metadata, rather than required application source or published package contents:

| Original component | Paths removed after preservation | Files |
| --- | --- | ---: |
| `seeds/` | `.pi/`, `.seeds/`, `.mulch/`, `.canopy/`, `.claude/`, `.factory/`, `.warren/`, `.gitconfig.burrow` | 47 |
| `mulch/` | `.seeds/`, `.mulch/`, `.canopy/`, `.claude/`, `.factory/`, `.warren/` | 32 |
| `canopy/` | `.seeds/`, `.mulch/`, `.canopy/`, `.claude/`, `.factory/` | 24 |

Seeds included 16 Pi session JSONL files totaling 1,511,947 bytes. Those files held 828 records, including 780 message records and 764 records containing tool-call or tool-result markers. All 16 sessions included working-directory metadata. Their conversation and tool output contents must not be automatically loaded as Luuna agent instructions or product fixtures.

The tracked `seeds/.pi/agent/auth.json` was an empty JSON object. Its sole reachable historical version was also empty. The file was removed with the session metadata because authentication storage should remain local even when initially empty.

The `.seeds/`, `.mulch/`, and `.canopy/` records were the imported tools' own issue stores, expertise stores, and prompts. `.claude/`, `.factory/`, and `.warren/` contained tool-specific automation and agent configuration. `.gitconfig.burrow` contained an upstream author identity and had no source references. These records are historical authoring context, not Luuna's current policies. All three package manifests published only `src/`; the tools' source and tests implement and exercise their storage formats separately. Source files, tests, fixtures, upstream notices, and useful reference documentation were retained through the component migration. Original agent instructions were preserved in the archive before being replaced with current Luuna instructions.

The original source and metadata archive is outside Git at:

`/workspace/luuna-preservation/imported-components-before-luuna-rebrand.tar.gz`

Its SHA-256 is `22aff086b01148dcb5d73031c41c7d96e6d6bf0c2a2e844d7eb2e51a0de8955c`. The archive contains 648 members and is 1,869,773 bytes; an adjacent `manifest.json` records the baseline. Its directory permissions are `0700`, and both archive and manifest permissions are `0600`. Treat this archive as potentially private historical material. It is not a dependency, agent input, or file to republish. This workspace copy is not a guarantee of long-term archival retention.

## Secret scan evidence

A local Python scanner read every unique blob reachable from the available Git refs with `git rev-list --objects --all` and `git cat-file --batch`. It scanned 612 blobs, totaling 14,320,314 bytes, across these four reachable commits:

- `532048d1839d003d724e55e8a47dbfdc44145004`
- `25107b20de1e5d422e80ea4bed9692a1561dc61d`
- `bcf08d732b908b83955203eb9a89355e28d2c1dc`
- `f3c2a17ff2d1ec3eff50921cbb7b41bb37c87715`

Twelve signature categories covered GitHub tokens, AWS access IDs, Slack tokens, Google API keys, Stripe live secrets, model API keys, private key headers, npm tokens, PyPI tokens, JWTs, URLs with credentials, and quoted generic secret assignments. Synthetic positive controls passed for all twelve categories. Matches and output were redacted by construction: only rule, file, line, blob ID, and coarse classification were recorded.

One match occurred in the original `mulch/test/log.test.ts:114`: an example-like credential URL in a test fixture, adjacent to assertions and containing an explicit example marker. No provider-key or private-key signature was found. No session excerpts or candidate credential values were printed or copied into this report.

The local scanner and its redacted machine-readable output were written to `/tmp/luuna-secret-audit.py` and `/tmp/luuna-privacy-scan.json` for this review. These temporary files are not repository dependencies.

## Coverage limits and future handling

- The scan covered currently available reachable refs. It cannot establish the contents of unavailable remote refs, dangling objects, deleted forks, external caches, or prior clones.
- Seven binary blobs were searched for plaintext signatures. Compressed archive contents and PDF streams were not decompressed.
- Signature matching can miss unknown token formats, unquoted secrets, obfuscated values, and encrypted data. No online credential validation was attempted.
- Neither Gitleaks nor TruffleHog was installed. The attempted official GitHub release lookup was blocked by the network proxy with HTTP 403, so this report does not claim a scan by either tool.
- A later dedicated scanner run should supplement this baseline when an approved scanner distribution is available. If a real credential is discovered, revoke or rotate it first; a separate, explicitly coordinated history cleanup may then be appropriate.

Local sessions, authentication files, actual environment files, runtime state, and generated build outputs should remain ignored. Preserve upstream license and copyright notices. Review component changes as source changes; do not automatically import historical prompts, hooks, or personal work records into Luuna's agents.
