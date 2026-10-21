# Component workflows in Luuna

The application uses the pinned public luuna-missions, luuna-atlas and luuna-beacon sources through runtime adapters. See [ADR 0014](decisions/0014-runtime-component-workflows.md) for authority and recovery rules.

## Use the application

1. After a fresh checkout, run `npm ci` and `npm run components:setup`. Build the runtime with `cargo build --locked -p luuna-runtime`, then start or restart that build. The application reports unavailable tools rather than substituting another ticket or memory authority.
2. Open a registered project and select **Enable components**. This explicitly creates private managed component stores and migrates existing tickets while preserving their IDs. Retry the same activation after an interrupted migration. The runtime blocks project mutations while activation is incomplete.
3. Create a ticket in the existing workflow panel. Its source is Missions. After an external CLI edit, refresh its source status and reconcile the displayed expected revision before making a new plan. Old approvals do not transfer to a changed ticket revision.
4. In the component panel, create project/process memory with explicit provenance, search it, and select only the records needed by this task. User memory remains excluded until the user-memory option is enabled and a record is explicitly selected. Delete requires the displayed source hash.
5. Create or preview a Beacon prompt. Updating its name uses the current expected version. Preview and select the current rendered version for the plan.
6. Create a plan. Review the full immutable plan, including selected memory content/provenance and prompt body. Approve its exact hash before implementation. The runtime checks the source again at approval, implementation, repair and validation/review boundaries. A changed or deleted selected resource requires a new plan and approval.

Deleting memory removes its Atlas source from active retrieval and invalidates selected references. Existing immutable plans and private operation history retain their audit snapshots; complete retention/erasure policy remains a full-v1 obligation.

Existing projects stay on the clearly labelled temporary ticket source until activated. No personal component store, imported task history, Pi configuration or unrelated memory is automatically loaded into a worker. The private source workspace is shown in component status; direct CLI work must use that workspace explicitly.

## Current API

All routes are authenticated under `/api/v1`.

| Method and route | Contract |
| --- | --- |
| `GET/POST /projects/{id}/components` | Inspect or explicitly activate/migrate the managed stores. |
| `GET /projects/{id}/memory?include_user=true&q=...` | Search bound records; `include_user` defaults to false. |
| `POST /projects/{id}/memory` | `{idempotency_key, scope, content, provenance}`; scope is project/process/user. |
| `DELETE /projects/{id}/memory/{id}?expected_hash=...` | Optimistic, idempotent deletion; source changes refuse deletion. |
| `GET/POST /projects/{id}/prompts` | List or create/update `{idempotency_key, name, body, expected_version?}`. Missing/zero expected version creates; positive version updates. |
| `GET /projects/{id}/prompts/{name}/render?version=N` | Current-version preview with rendered body and canonical resource hash. Stale versions are refused. |
| `GET /tickets/{id}/source` | Observe source identity/revision and reconciliation need. Ticket GET/list retains the last reconciled projection. |
| `POST /tickets/{id}/reconcile` | `{expected_revision}`; source changes advance the projection and stale old plans. |

Plan creation accepts optional `component_context: {memory_ids: string[], prompt?: {name,version,hash}}`. The resulting plan stores exact approved snapshots as `component_context: {memory: [{id,scope,hash,content,provenance}], prompt: {name,version,hash,body} | null}`. At most sixteen memories and 16,000 encoded bytes of combined resources are accepted. Omitting the optional field preserves older canonical plan hashes.

Operation keys persist across uncertain responses; retries with a different payload are refused. Missing source identity after an attempted create is reported for reconciliation rather than blindly repeated. Prompt source records, inherited sources and configured schemas contribute to the hash; schemas must validate without warnings. External CLI writes cannot be made atomic with a SQLite transaction, so later boundaries recheck source freshness.

## Reproduce focused verification

```
cargo test --locked -p luuna-components --test real -- --ignored --nocapture
cargo test --locked -p luuna-runtime --lib missions_real_ -- --ignored --nocapture
cargo test --locked -p luuna-runtime --lib components_real_ -- --ignored --nocapture
node scripts/m6-ui-smoke.mjs --runtime <fresh-runtime-binary> --browser <chromium-or-edge> --out <new-test-directory>
node scripts/m6-ui-smoke.mjs --native <bundled-desktop-executable> --runtime <fresh-runtime-binary> --runtime-label <build-identity> --out <new-test-directory>
```

The smoke uses disposable Git repositories, private component stores, free loopback ports and its own token. Browser mode uses a test-owned proxy. Windows native mode loads the bundled Tauri frontend in WebView2 and exercises production CORS directly. Native mode first verifies automatic connection to the existing local service, then disconnects and selects the isolated fixture service; it repeats this after reload. It requires a configured local development service but makes no provider calls. It closes only its own test window and verifies that the independent fixture runtime survives before authenticated shutdown. Both modes exercise actual component CLIs and real Git/check commands while using explicitly synthetic Pi writer/reviewer sessions. Fixture screenshots contain synthetic data. See [FOUNDATION-STATUS.md](FOUNDATION-STATUS.md#runtime-component-workflows-october-21-2026) for observed results and remaining platform/provider coverage.

## Current verification and Windows development startup

The [recorded Windows browser run](evidence/component-workflows-2026-10-21.json) passed all 23 assertions with actual pinned component CLIs and synthetic Pi writer/reviewer sessions. The final Rust workspace passed 196 tests, plus separate real-component suites. The final runtime subsequently passed [27 native component workflow checks](evidence/native-component-workflows-2026-10-21.json), [46 bundled native lifecycle/recovery checks](evidence/native-lifecycle-2026-10-21.json) and [17 automatic native startup checks](evidence/native-startup-2026-10-21.json). These exercise the actual Tauri WebView2 frontend; synthetic Pi sessions remain explicitly synthetic.

The earlier Application Control block and rollback are retained in the historical evidence. The user explicitly chose unsigned development and turned Smart App Control Off in Windows Security; the observed policy state changed from 1 to 0. The exact previously blocked final runtime was then installed and started successfully. Its SHA-256 is `99d9521784bc373237ef4d65b3bdd6189f3290faf557fad2946705f39d890256`. All three existing saved runs, the token, data directory and encrypted provider bytes were preserved. Project activation has not been forced in personal data. Signed distribution and broader platform/provider acceptance remain separate requirements.
