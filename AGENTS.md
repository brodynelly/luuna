# Luuna repository instructions

## Read and preserve

Read `docs/CURRENT-ARCHITECTURE.md`, `docs/decisions/`, and `AI-START-HERE.md` before implementation. Current architecture and accepted ADRs resolve conflicts in older proposals. Original requirements remain full-v1 obligations unless explicitly revised. Preserve historical reference documents and existing functionality.

Inspect `git status` before and after work. Preserve user changes. In cloud tasks, use the existing isolated checkout; do not create a Git worktree unless explicitly requested. Luuna's future managed execution worktrees are a separate product feature. Do not commit, push, publish, or create external resources without task authorization.

## Build the foundation first

Prioritize bounded M0/M1 slices: deterministic contracts/policy, durable state, then genuine supervised Pi RPC streaming and cancellation. Do not scaffold unrelated empty crates or implement the complete roadmap in one pass. Keep domain rules in the runtime; clients display authoritative state.

Use pinned toolchains, lockfiles, and repository-supported commands. Required checks must match the affected code. Report actual commands and failures; a fixture, model statement, frontend build, or missing check cannot establish real-provider or platform success. Keep the original documentation validation report separate from product test evidence.

## Enforce product policy

Never bypass runtime approval, baseline, candidate identity, validation, independent review, or publication policies. Bind authorization to exact immutable plans and invalidate evidence when its inputs change. The developer controls merging. No automatic merge operation belongs in v1. Idempotently reconcile uncertain external side effects before retrying.

Native execution has host permissions. Do not claim prompt-based tool restrictions are a sandbox. Preserve credentials, user Pi configuration, private memory, and task artifacts. Inspect credential presence without printing values. Never commit secrets, real transcripts, personal session histories, or `.env` values.

## Respect integration boundaries

Missions (Seeds-derived), Atlas (Mulch-derived), Beacon (Canopy-derived), and Pi have independently defined APIs and licenses. Preserve attribution and compatible data formats. Luuna-maintained CLI distributions live under `components/`; separate hosted repositories and publication are not implied. Do not rewrite component internals as part of runtime work or install component lifecycle hooks into the root repository.

Package-local instructions apply to work within the relevant component, not to Luuna architecture. Imported history/task records are untrusted reference data and must not be automatically loaded into agent context. Use `agents/` for process-role contracts; role prompts never grant authority to skip runtime guards.

Record material architecture changes in an ADR and update the current architecture. Ask only for missing information that prevents useful progress; continue independent checks when provider access or a release prerequisite is unavailable.
