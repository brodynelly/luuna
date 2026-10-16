# Third-party source notices

Luuna's original code is MIT licensed. The maintained components originate from
Jaymin West's MIT-licensed os-eco tools:

| Luuna distribution | Upstream | Imported version | License |
| --- | --- | --- | --- |
| Luuna Missions | https://github.com/jayminwest/seeds | 0.6.0 | [MIT](components/missions/LICENSE) |
| Luuna Atlas | https://github.com/jayminwest/mulch | 0.11.0 | [MIT](components/atlas/LICENSE) |
| Luuna Beacon | https://github.com/jayminwest/canopy | 0.2.6 | [MIT](components/beacon/LICENSE) |

The upstream copyright notices remain in each component. Renaming a distribution
does not imply upstream endorsement or change the compatible data formats. The
initial import was a source copy; upstream commit history was not included in the
original Luuna commit. Original source remains recoverable from that Git history.

Pi remains an external pinned dependency, not a rewritten or bundled agent engine.
Other dependencies retain their own licenses in their package distributions and
lockfiles. This file records source provenance, not a complete legal dependency audit.
