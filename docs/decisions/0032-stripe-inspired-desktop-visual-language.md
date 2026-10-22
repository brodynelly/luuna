# ADR 0032: a blurple and navy desktop visual language, bundled fonts, layered depth and a bounded motion budget

Date: 2026-10-22. Status: Accepted. Amends [ADR 0013](0013-desktop-design-system.md) decision 3 (system fonts only, never opacity) and [ADR 0030](0030-desktop-shell-and-tailwind.md) where it touches presentation rules; extends [ADR 0031](0031-client-frame-pacing.md) (token-driven, reduced-motion-aware motion, steady evidence). Amends the rules in [DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md).

## Context

The owner asked for a restyle of the desktop client inspired by Stripe's public product style: a blurple accent, navy text, cool grays, layered shadows, restrained gradients and purposeful motion. The look is inspiration only. Every value below is a tuned approximation and none is a published third-party token; no third-party name, logo or asset appears in code or UI.

Several accepted rules block the restyle:

- ADR 0013 and DESIGN-SYSTEM.md require system fonts only (no `@font-face`).
- The design lint bans `opacity` everywhere, so a fade-in cannot exist.
- DESIGN-SYSTEM.md says text ancestors never get `transform`, which forbids a hover lift or a press scale.
- `tokens.css` has one easing, two durations, no dark-scheme depth, weights 550 and 650 that a bundled face renders as 600 and 700, and no room under the 300-line cap.

## Decisions

1. **Fonts.** Apple platforms keep the system SF Pro stack. Other platforms use bundled Söhne (300 to 700, upright and italic) served from `'self'` with `font-src 'self'`. Nothing is fetched remotely. The detail belongs to item F1 (`design/fonts.css`, the `data-platform` attribute, the CSP, and the licensing notice in `THIRD-PARTY-NOTICES.md`: a commercial Klim face, sole-user exception, remove or license before distribution). Weight tokens are remapped: 550 becomes 500 and 650 becomes 600, because static faces have no 550 or 650.
2. **Colour and depth.** A blurple accent, navy text and cool grays in both schemes with identical role names. New roles: accent active and tint, text heading, border strong, selection, scrollbar and the focus halo. The six tones and their meanings are unchanged; the style-spec names map as warning to attention, critical to danger, info and running to active. The active tone stays cyan-leaning so runtime work never reads as the blurple developer-action colour. Light uses layered, navy-tinted shadows; dark uses lighter surfaces plus an inset highlight. Gradients and the aurora come from tokens only.
3. **Opacity.** This revises "never opacity". Opacity is allowed only inside `@keyframes`, and as an exact 0 or 1 toggle on decorative pseudo-elements, with tokenised durations. It is never used for static dimming, disabled states or state encoding. Disabled stays a colour token. Every entrance ends at full opacity, so the rendered contrast audit measures it.
4. **Transform.** This revises DESIGN-SYSTEM.md on text ancestors. Buttons and cards may lift 1 px on hover (an integer pixel, `--lift-y`) and scale to 0.98 on press (`--duration-press`). Entrances translate or scale only through a one-time keyframe with `backwards` fill. No transform remains on a text-bearing element at rest and there is no `will-change`. A resting transform is allowed only on decorative, text-free elements (marks, indicators, pills, washes) and on the off-screen skip link. Live output (`pre[data-live]`, `ol.events` and their ancestors) never gets transform, opacity, filter or entrance motion (ADR 0031).
5. **The active chip pulse.** A CSS-only `::after` ring on `.state[data-tone="active"]` and on the live connection mark signals that the runtime is working. It never encodes evidence or approval state. It is suppressed under reduced motion and forced colours. The tail caret stays steady: evidence never pulses.
6. **Motion budget and restraint.**
   - Only `transform`, `opacity`, `background-position`, `clip-path` and `stroke-dashoffset` (the check draw) animate.
   - Durations: micro 140, standard 220 and large 340 ms; ambient 24 s or more for decorative drift.
   - Entrances play once per mount, with the stagger capped at 10.
   - Motion conveys state or continuity, never decoration on evidence.
   - Under reduced motion there is no drift, shimmer, count-up or stagger, state changes are instant, and every duration token is 0 (test-enforced).
   - Durations and easings are tokens only (lint).
7. **Platform gating.** WebView2 (evergreen Chromium) and macOS WKWebView differ. Optional features are gated with `@supports`: `view-transition-name`, `transition-behavior: allow-discrete`, `@starting-style` and `backdrop-filter` (with the `-webkit-` prefix for WKWebView). In JS, `document.startViewTransition?.()` has a direct-update fallback. Hover effects are gated by `(hover: hover) and (pointer: fine)`. Every gated feature has a complete, readable static fallback.
8. **Contrast.** Every text pair meets 4.5:1 (marks, edges and focus 3:1) in both schemes, test-enforced. Text over a gradient must meet 4.5:1 against the composited background. Text never sits on the vivid wash. Item Q verifies rendered contrast in both schemes.
9. **Approvals and evidence never animate away.** Plans, approval controls, hashes, checks, verdicts, baselines, publication records and alerts get no exit animation, fade, dim, auto-dismiss or hover-only visibility. Notices stay untimed.

## Alternatives considered

- An animation library: rejected. CSS plus DOM-free controllers suffice, and a library would add a dependency.
- Bundling SF Pro: rejected for licence reasons.
- Keeping system fonts everywhere: rejected by the owner.

## Consequences

- Tokens are split into `tokens.css` (colour, tone, type, layout), `tokens-depth.css` (shape, shadows, gradients) and `tokens-motion.css` (easings, durations, distances, component sizes), plus `fonts.css` from F1. The final stylesheet manifest is pre-registered so parallel items only replace stub content.
- The design lint is revised to enforce decisions 3, 4 and 6 (opacity, keyframe properties, fill modes, filters, `will-change`, duration and easing tokens, reduced-motion coverage derived from the token sheets).
- Unit tests and lint are not rendering evidence. Item Q owns visual verification in real WebViews, both schemes and reduced motion.
