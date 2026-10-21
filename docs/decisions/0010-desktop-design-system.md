# ADR 0010: one token-based design system for the desktop client

Date: 2026-10-21. Status: accepted.

## Context

The desktop client grew one panel per milestone on a single dark-only stylesheet of hex literals. State badges were coloured by runtime state name, so a `completed` demo session was painted green although the client itself says a completed session is not a validation result. Interrupted work looked like failure. The light half of the declared `color-scheme: dark light` was never designed. Nothing checked contrast, so two text runs sat below WCAG AA. Browser/TUI parity is a full-v1 obligation (R02), so the meaning of each state has to be defined once, not per screen.

## Decision

1. **Presentation follows evidence.** Six tones (success, active, danger, attention, neutral, interrupted) are mapped from the `@luuna/api-client` unions in `apps/desktop/src/design/tone.ts` as exhaustive typed records, so a new runtime state fails the type check until it has a tone. Only passed durable evidence and a live connection are success. Interruption is never danger. The runtime still decides every state, permission, reason and next step; the client only chooses how to show them.
2. **Three channels.** Every state shows its unchanged runtime text, a colour family and a shape mark. Colour is never the only signal.
3. **Tokens only, both schemes.** Literal colours, lengths and durations live in `design/tokens.css`. Dark stays the default; `prefers-color-scheme: light` redefines every colour. Stylesheets are layered (tokens, base, components, screens) and bundled from `'self'`, which the Tauri CSP already allows. No font or stylesheet is fetched.
4. **Enforced, not advised.** `design/design-system.test.ts` runs under `npm test`. It lints every stylesheet, resolves every `var()`, checks scheme parity, computes WCAG contrast for every semantic pair in both schemes, pins screen structure (heading levels, no inline styles, badges through one primitive, dismissible alerts) and pins the tone taxonomy. `scripts/mvp-ui-smoke.mjs` checks the rendered page: contrast against painted backgrounds in both schemes, scheme following, and no horizontal scroll at the 760 px window minimum.

The reference is [docs/DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md).

## Alternatives and consequences

A CSS framework or component library was rejected: it would add dependencies, fetch nothing useful under the CSP, and hide the tone semantics in class soup. A runtime-provided "display tone" field was rejected: tone is presentation, and the runtime already exposes the authoritative state each client maps. A manual light/dark switch was deferred: there is no setting surface yet, and the system scheme is enough for the MVP.

A future TUI or browser client should reuse the same tone table (`tone.ts` and the DESIGN-SYSTEM table) so a state reads the same everywhere. Adding a colour now costs a token in both schemes and a contrast pair. Adding a runtime state costs a tone entry. The smoke's contrast audit exempts disabled controls only, so the design system uses disabled colour tokens instead of opacity.
