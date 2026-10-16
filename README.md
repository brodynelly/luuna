# Luuna proposal and implementation reference

Version 0.1 | 15 October 2026 | Design baseline, not implemented software

Luuna is an installable development coordinator for individual developers. It uses Pi agent sessions to plan, implement, test, independently review, and prepare pull requests across related repositories. The developer approves the plan and decides when to merge.

Read docs/01-proposal.md first. LUUNA-COMPLETE-REFERENCE.md combines the documents, diagrams, examples, agent roles, and implementation handoff into one reading copy. The PDF presents the same reference material in a paginated format.

## Reading order

| File | Purpose |
| --- | --- |
| docs/01-proposal.md | Product proposal, scope, decisions, and defaults |
| docs/02-requirements.md | Identified requirements and release boundaries |
| docs/03-architecture.md | Components, repository graph, persistence, execution |
| docs/04-orchestration.md | State machine, approvals, concurrency, integration |
| docs/05-pi-integration.md | Pi boundary, adapters, credentials, session lifecycle |
| docs/06-memory.md | Three memory uses and context construction |
| docs/07-contracts.md | Proposed domain models, API, events, examples |
| docs/08-validation.md | Testing prerequisites, evidence, review, publication |
| docs/09-experience.md | Onboarding, browser/TUI parity, installation |
| docs/10-roadmap.md | Milestones, work packages, exit criteria |
| docs/11-acceptance.md | Release acceptance scenarios |
| docs/12-decisions-risks.md | Architecture decisions, risks, remaining choices |
| docs/13-references.md | Primary sources and how an implementing AI should use them |
| AI-START-HERE.md | Copy-ready implementation handoff |
| agents/ | Process-role contracts for Pi sessions |
| diagrams/ | Editable Mermaid sources |
| schemas/ and examples/ | Proposed validation contracts and illustrative records |

## Status and precedence

User requirements in docs/02-requirements.md are binding for the proposed product. Recommended defaults are identified separately. Architecture choices here are a starting baseline; a material change requires an explicit decision record rather than silent divergence.

Schemas define Luuna's proposed application contracts. They are not Pi, Mulch, Canopy, Seeds, or GitHub protocol definitions. Example command paths, models, repository names, commit markers, and IDs are illustrative. No credentials, production code, binaries, downloaded upstream source trees, or third-party documentation copies are included.

The product is called Luuna. Luuna-ML and luuna-mulch refer to the memory capability. The earlier Luuna-ID ticketing name maps to luuna-seeds in this proposal. Prefixes describe Luuna integration boundaries; they do not imply forks of the referenced upstream tools.

## Scope of this delivery

This package is a complete design and implementation reference. It does not establish that any product feature has been built or tested. See VALIDATION-REPORT.md for checks performed on these documentation artifacts.
# luuna
