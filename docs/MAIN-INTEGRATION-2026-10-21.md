# Main integration and local accounting

Date: October 21, 2026. The owner requested merging all local work into `main`.
Review: [PR 10](https://github.com/brodynelly/luuna/pull/10).

## Preserved work

- All 46 initially modified/new files were captured in commit `f0790da` before resolving any overlaps. The [sanitized accounting and assertions](evidence/main-integration-2026-10-21.json) list every file.
- Remote `main` had advanced thirteen commits to `7308d86`, including PR 9's desktop design system and genuine-provider evidence. Integration commit `e7d15d3` preserves both histories. Runtime guards, source reconciliation and exact context snapshots remain authoritative; the component panel now uses the shared tokens and registered screen rules.
- The already accepted desktop design decision keeps ADR 0013. The component decision is ADR 0014, with its references updated.
- All three component submodules are clean at their existing exact pins. The local `extraction/atlas`, `extraction/beacon` and `extraction/missions` tips are ancestors of their respective component repository HEADs. They remain intact as historical refs, rather than importing standalone repository roots into Luuna.
- There were no stashes or additional worktrees. Ignored `.tools/`, dependencies, desktop generated files, `dist/` and Rust `target/` outputs remain local. Pinned Node/npm validation tools were installed only under ignored `.tools/`. Credentials and personal runtime data were not staged or published.

## Merge verification

`npm test` passed under Node 24.19.0 and npm 11.9.0: 24 contract cases, 6 scope-guard tests, 8 component-pin tests, 220 desktop tests and 25 API-client tests. Typechecking, the production build, repository hygiene and diff checks passed. Final Rust 1.90.0 formatting and Clippy with warnings denied passed; `cargo test --locked --workspace --all-targets` passed **185 tests, zero failed, 10 explicitly ignored** on Windows after the scope-guard fix. The final running runtime hash is `c23b8e64b9d6dd0c1b145f0c1935afa2b3a09fb5fd651173a073d125e36f9c65`.

The combined UI passed 27 native component checks, 23 browser component checks, 55 native lifecycle/presentation checks and 57 browser lifecycle/presentation checks. These used real component CLIs and Git/unittest commands with synthetic Pi sessions. Native lifecycle checks include rendered contrast in both themes; the browser also checked the 760 px minimum width. The native desktop hash was `77f4387cc67febf0c8c6fb817f73a1ed0a56a2db601406e798cb55bbb01cb320`. No new genuine-provider component workflow is claimed.

The app workflow reports used runtime `3cee449015ac59fe6429c3339818490396bbafbd263f24fe3931be39b42e5a2a`. The subsequent pinned Node checks exposed a Windows verbatim-path/junction issue in the existing scope guard. Windows now uses the native realpath implementation before comparison, including missing-tail resolution. The existing canonical/ordinary-path guard regression and an added verbatim missing-tail case pass on Node 24. The final runtime was rebuilt and its Rust suite checked after this fix; the reports above are not relabelled as tests of that later executable.

Two earlier attempts were corrected before accepting evidence: a native build could not replace the open app until the owner closed it; and a browser component reload failed because Vite watched a Cargo-written Windows executable and exited with `EBUSY`. Both the app's Vite configuration and the isolated component harness now exclude `src-tauri` from watching. The browser rerun passed all 23 assertions. The browser lifecycle harness also required the installed Edge executable because its default Playwright browser was absent.

GitHub Actions run `39672767336` refused jobs before runner steps started. Check-run annotations explicitly identified the account payment/spending limit. This is unavailable hosted CI evidence; no successful hosted job or other-platform result is claimed, and no repository check or protection was disabled.

The personal runtime was stopped through its authenticated API only after confirming no active work, then restored with its existing state and credentials after build checks. Native packaging/signing, broader platform acceptance and full-v1 obligations remain separate from this source integration.
