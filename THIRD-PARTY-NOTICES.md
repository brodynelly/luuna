# Third-party source notices

Luuna's original code is MIT licensed. The maintained components originate from
Jaymin West's MIT-licensed os-eco tools:

| Luuna distribution | Upstream | Imported version | License |
| --- | --- | --- | --- |
| Luuna Missions | https://github.com/jayminwest/seeds | 0.6.0 | [MIT](https://github.com/brodynelly/luuna-missions/blob/5832801137dc1189915340c1f6076516b34e21b1/LICENSE) |
| Luuna Atlas | https://github.com/jayminwest/mulch | 0.11.0 | [MIT](https://github.com/brodynelly/luuna-atlas/blob/7c04005c5541e7efdb652d834728602a8dcb4d29/LICENSE) |
| Luuna Beacon | https://github.com/jayminwest/canopy | 0.2.6 | [MIT](https://github.com/brodynelly/luuna-beacon/blob/ae7741fe84df39c59a0081e8f56b13ef567bcce8/LICENSE) |

The upstream copyright notices remain in each component. Renaming a distribution
does not imply upstream endorsement or change the compatible data formats. The
initial import was a source copy; upstream commit history was not included in the
original Luuna commit. Original source remains recoverable from that Git history.

Pi remains an external pinned dependency, not a rewritten or bundled agent engine.
Other dependencies retain their own licenses in their package distributions and
lockfiles. This file records source provenance, not a complete legal dependency audit.

## Design reference

- `docs/design-reference/ledger/` is a byte-for-byte copy of the project owner's Ledger design system (copied 2026-10-22, adopted by ADR 0033). The source contained no license file, so it is treated as the owner's own material and is **not** covered by Luuna's MIT grant.
- It is documentation and reference data only: nothing under it is built, imported, tested or shipped in the desktop app. See `docs/design-reference/README.md`.

## Bundled fonts

- **Söhne** is a commercial typeface by Klim Type Foundry (https://klim.co.nz). Ten hinted TrueType files taken from the sole user's installed copy are bundled in `apps/desktop/src/assets/fonts/soehne/` at the sole user's direction (ADR 0033 font amendment), for personal, non-distributed use on non-Apple platforms. The user accepted the licensing risk.
- Söhne is **not** covered by Luuna's MIT license or any Luuna license grant.
- The `Test Söhne Mono` trial files must never be included.
- The fonts must be removed or properly licensed before any distribution, publication or packaging of the desktop app.
- Apple platforms and fallbacks use the system font stack; SF Pro is not bundled.
