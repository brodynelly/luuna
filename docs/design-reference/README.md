# Design reference: Ledger

- Source: `C:\Users\localhost\Downloads\ledger-design-system_1\ledger-design-system`, copied on 2026-10-22 into `ledger/`.
- This is the project owner's design system, adopted by [ADR 0033](../decisions/0033-ledger-design-system.md).
- The source contained no license file. Treat it as the owner's own material. It is not covered by Luuna's MIT grant (see `THIRD-PARTY-NOTICES.md`).
- It is imported reference data, not product code. Nothing under `ledger/` is built, imported, tested or loaded into agent context, and none of its scripts (`ledger.js`, `ledger.mjs`, the example HTML) may be executed.
- `ledger/LEDGER-RULES.md` is the source `CLAUDE.md`, renamed so no agent tool loads it automatically. The vendored README's "copy CLAUDE.md into your repo root" does not apply here.
- `ledger/tokens/tokens.json` is the token source of truth. `apps/desktop/src/design/design-system.test.ts` reads it and proves the desktop token sheets match it exactly.
- Luuna's own rules live in ADR 0033 and `docs/DESIGN-SYSTEM.md`. Vendored files are byte-for-byte copies and are not edited.
