//! Explicit real-CLI tests: no model, provider credential or personal store.
use crate::{integrations::*, AppState, RuntimeConfig};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use luuna_domain::{DirtyState, PromptReference, RepositoryIdentity, RepositoryObservation};
use serde_json::json;

fn setup(root: &std::path::Path) -> AppState {
    let config = RuntimeConfig {
        data_dir: root.join("private"),
        pi_program: "node".into(),
        git_program: "git".into(),
        pi_launcher_args: vec![],
        provider: None,
        model: None,
        token: "synthetic-components-token-at-least-32-bytes".into(),
        max_run_seconds: 10,
    };
    let state = AppState::open(config)
        .unwrap()
        .with_components(luuna_components::Components::discover().unwrap());
    for id in ["context-a", "context-b"] {
        let observation = RepositoryObservation {
            local_path: root.join(id).to_string_lossy().into_owned(),
            identity: RepositoryIdentity {
                remote: Some("https://example.invalid/fixture.git".into()),
                push_remote: None,
                root_commits: vec!["1".repeat(40)],
                shallow: false,
            },
            head_commit: "1".repeat(40),
            branch: Some("main".into()),
            remote_default_branch: None,
            local_branches: vec!["main".into()],
            dirty: DirtyState::default(),
            git_version: "git version 2.43.0".into(),
            observed_at: "2026-10-21T00:00:00Z".into(),
        };
        state
            .store
            .lock()
            .unwrap()
            .register_project(id, id, &[("app".into(), observation)])
            .unwrap();
    }
    state
}
async fn memory(
    state: &AppState,
    project: &str,
    key: &str,
    scope: &str,
    content: &str,
) -> MemoryRecord {
    create_memory(
        State(state.clone()),
        Path(project.into()),
        Json(CreateMemory {
            idempotency_key: key.into(),
            scope: scope.into(),
            content: content.into(),
            provenance: "Explicit synthetic fixture".into(),
        }),
    )
    .await
    .unwrap()
    .0
}
async fn prompt(state: &AppState, key: &str, body: &str, version: Option<u64>) -> RenderedPrompt {
    create_prompt(
        State(state.clone()),
        Path("context-a".into()),
        Json(CreatePrompt {
            idempotency_key: key.into(),
            name: "guidance".into(),
            body: body.into(),
            expected_version: version,
        }),
    )
    .await
    .unwrap()
    .0
}
async fn raw(state: &AppState, component: &str, project: &str, args: &[&str]) -> serde_json::Value {
    state
        .components
        .as_ref()
        .unwrap()
        .call(
            component,
            &workspace(state, project).unwrap(),
            &args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>(),
        )
        .await
        .unwrap()
}
#[tokio::test]
#[ignore = "requires pinned Bun and real component checkouts; run with --ignored"]
async fn components_real_scopes_snapshot_staleness_and_restart() {
    Box::pin(scopes_snapshot_staleness_and_restart()).await;
}
async fn scopes_snapshot_staleness_and_restart() {
    let root = tempfile::tempdir().unwrap();
    let state = setup(root.path());
    let (selected, process) = Box::pin(scope_checks(&state)).await;
    let second = Box::pin(prompt_checks(&state, &selected, &process)).await;
    Box::pin(delete_checks(&state, &selected)).await;
    let config = (*state.config).clone();
    drop(state);
    let restarted = AppState::open(config)
        .unwrap()
        .with_components(luuna_components::Components::discover().unwrap());
    assert!(enabled(&restarted, "context-a").unwrap());
    assert_eq!(
        prompt(&restarted, "p2", "Prompt v2", Some(1)).await.hash,
        second.hash
    );
    assert_eq!(
        memory(
            &restarted,
            "context-a",
            "m3",
            "process",
            "selected process convention"
        )
        .await
        .id,
        process.id
    );
}
// Keep each fixture future small on native Rust's default test-thread stack.
async fn scope_checks(state: &AppState) -> (MemoryRecord, MemoryRecord) {
    assert_eq!(
        create_memory(
            State(state.clone()),
            Path("context-a".into()),
            Json(CreateMemory {
                idempotency_key: "disabled".into(),
                scope: "project".into(),
                content: "x".into(),
                provenance: "fixture".into()
            })
        )
        .await
        .err()
        .unwrap()
        .0,
        StatusCode::CONFLICT
    );
    for id in ["context-a", "context-b"] {
        let _ = enable(State(state.clone()), Path(id.into())).await.unwrap();
    }
    let selected = memory(
        state,
        "context-a",
        "m1",
        "project",
        "selected project memory",
    )
    .await;
    let private = memory(state, "context-a", "m2", "user", "PRIVATE_NOT_SELECTED").await;
    let process = memory(
        state,
        "context-a",
        "m3",
        "process",
        "selected process convention",
    )
    .await;
    let list = list_memory(
        State(state.clone()),
        Path("context-a".into()),
        Query(MemoryQuery {
            include_user: false,
            q: None,
        }),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(list.len(), 2);
    assert!(!list.iter().any(|row| row.id == private.id));
    assert!(list_memory(
        State(state.clone()),
        Path("context-b".into()),
        Query(MemoryQuery {
            include_user: false,
            q: None
        })
    )
    .await
    .unwrap()
    .0
    .is_empty());
    let opted = list_memory(
        State(state.clone()),
        Path("context-b".into()),
        Query(MemoryQuery {
            include_user: true,
            q: None,
        }),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(opted.len(), 1);
    assert_eq!(opted[0].id, private.id);
    assert_eq!(
        memory(
            state,
            "context-a",
            "m1",
            "project",
            "selected project memory"
        )
        .await
        .id,
        selected.id
    );
    let conflict = create_memory(
        State(state.clone()),
        Path("context-a".into()),
        Json(CreateMemory {
            idempotency_key: "m1".into(),
            scope: "project".into(),
            content: "different".into(),
            provenance: "fixture".into(),
        }),
    )
    .await
    .err()
    .unwrap();
    assert_eq!(conflict.0, StatusCode::CONFLICT);
    (selected, process)
}
async fn prompt_checks(
    state: &AppState,
    selected: &MemoryRecord,
    process: &MemoryRecord,
) -> RenderedPrompt {
    let first = prompt(state, "p1", "Prompt v1", None).await;
    assert_eq!(
        prompt(state, "p1", "Prompt v1", None).await.hash,
        first.hash
    );
    let selection = SelectContext {
        memory_ids: vec![selected.id.clone(), process.id.clone()],
        prompt: Some(PromptReference {
            name: first.name.clone(),
            version: first.version,
            hash: first.hash.clone(),
        }),
    };
    let snapshot = resolve_selection(state, "context-a", Some(&selection))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(snapshot.memory[0].content, selected.content);
    assert_eq!(snapshot.prompt.as_ref().unwrap().body, first.body);
    let resources = resolve_approved(state, "context-a", Some(&snapshot))
        .await
        .unwrap()
        .unwrap()
        .to_string();
    assert!(resources.contains("selected project memory"));
    assert!(!resources.contains("PRIVATE_NOT_SELECTED"));
    assert!(resolve_selection(state, "context-b", Some(&selection))
        .await
        .is_err());
    let second = prompt(state, "p2", "Prompt v2", Some(1)).await;
    assert_eq!(second.version, 2);
    assert_eq!(
        resolve_approved(state, "context-a", Some(&snapshot))
            .await
            .err()
            .unwrap()
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        render_prompt(
            State(state.clone()),
            Path(("context-a".into(), "guidance".into())),
            Query(PromptQuery { version: Some(1) })
        )
        .await
        .err()
        .unwrap()
        .0,
        StatusCode::CONFLICT
    );
    second
}
async fn delete_checks(state: &AppState, selected: &MemoryRecord) {
    let selected_context = resolve_selection(
        state,
        "context-a",
        Some(&SelectContext {
            memory_ids: vec![selected.id.clone()],
            prompt: None,
        }),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        delete_memory(
            State(state.clone()),
            Path(("context-a".into(), selected.id.clone())),
            Query(DeleteMemoryQuery {
                expected_hash:
                    "sha256:0000000000000000000000000000000000000000000000000000000000000000".into()
            })
        )
        .await
        .err()
        .unwrap()
        .0,
        StatusCode::CONFLICT
    );
    let _ = delete_memory(
        State(state.clone()),
        Path(("context-a".into(), selected.id.clone())),
        Query(DeleteMemoryQuery {
            expected_hash: selected.hash.clone(),
        }),
    )
    .await
    .unwrap();
    // Repeated DELETE is idempotent even after its mapping is tombstoned.
    let _ = delete_memory(
        State(state.clone()),
        Path(("context-a".into(), selected.id.clone())),
        Query(DeleteMemoryQuery {
            expected_hash: selected.hash.clone(),
        }),
    )
    .await
    .unwrap();
    assert_eq!(
        resolve_approved(state, "context-a", Some(&selected_context))
            .await
            .err()
            .unwrap()
            .0,
        StatusCode::CONFLICT
    );
}
#[tokio::test]
#[ignore = "requires pinned Bun and real component checkouts; run with --ignored"]
async fn components_real_uncertain_memory_and_delete_reconcile_after_restart() {
    let root = tempfile::tempdir().unwrap();
    let state = setup(root.path());
    let _ = enable(State(state.clone()), Path("context-a".into()))
        .await
        .unwrap();
    let payload = json!({"scope":"project","content":"uncertain content","provenance":"Explicit synthetic fixture"});
    let op = state
        .store
        .lock()
        .unwrap()
        .begin_component_operation(
            "context-a",
            "pending",
            "memory.create",
            &payload,
            "mem-reserved",
        )
        .unwrap();
    state
        .store
        .lock()
        .unwrap()
        .mark_component_operation_attempted("context-a", "pending")
        .unwrap();
    let envelope=json!({"id":op.record_id,"scope":"project","content":"uncertain content","provenance":"Explicit synthetic fixture"}).to_string();
    raw(
        &state,
        "atlas",
        "context-a",
        &[
            "record",
            "luuna-project",
            &envelope,
            "--type",
            "convention",
            "--tags",
            "mem-reserved",
        ],
    )
    .await;
    let config = (*state.config).clone();
    drop(state);
    let restarted = AppState::open(config)
        .unwrap()
        .with_components(luuna_components::Components::discover().unwrap());
    let recovered = memory(
        &restarted,
        "context-a",
        "pending",
        "project",
        "uncertain content",
    )
    .await;
    assert_eq!(recovered.id, "mem-reserved");
    let binding = restarted
        .store
        .lock()
        .unwrap()
        .memory_binding("context-a", &recovered.id)
        .unwrap()
        .unwrap();
    // Simulate CLI deletion committed before a local response/tombstone was saved.
    raw(
        &restarted,
        "atlas",
        "context-a",
        &["delete", &binding.domain, &binding.source_id],
    )
    .await;
    let _ = delete_memory(
        State(restarted.clone()),
        Path(("context-a".into(), recovered.id)),
        Query(DeleteMemoryQuery {
            expected_hash: recovered.hash,
        }),
    )
    .await
    .unwrap();
    assert!(list_memory(
        State(restarted.clone()),
        Path("context-a".into()),
        Query(MemoryQuery {
            include_user: false,
            q: None
        })
    )
    .await
    .unwrap()
    .0
    .is_empty());
    // An uncertain missing create cannot be blindly repeated.
    restarted
        .store
        .lock()
        .unwrap()
        .begin_component_operation(
            "context-a",
            "missing",
            "memory.create",
            &payload,
            "mem-missing",
        )
        .unwrap();
    restarted
        .store
        .lock()
        .unwrap()
        .mark_component_operation_attempted("context-a", "missing")
        .unwrap();
    let result = create_memory(
        State(restarted.clone()),
        Path("context-a".into()),
        Json(CreateMemory {
            idempotency_key: "missing".into(),
            scope: "project".into(),
            content: "uncertain content".into(),
            provenance: "Explicit synthetic fixture".into(),
        }),
    )
    .await;
    assert_eq!(result.err().unwrap().0, StatusCode::CONFLICT);
}
#[tokio::test]
#[ignore = "requires pinned Bun and real component checkouts; run with --ignored"]
async fn components_real_duplicate_memory_delivery_refuses_acknowledgement() {
    let root = tempfile::tempdir().unwrap();
    let state = setup(root.path());
    let _ = enable(State(state.clone()), Path("context-a".into()))
        .await
        .unwrap();
    let payload = json!({"scope":"project","content":"uncertain content","provenance":"Explicit synthetic fixture"});
    state
        .store
        .lock()
        .unwrap()
        .begin_component_operation(
            "context-a",
            "duplicate",
            "memory.create",
            &payload,
            "mem-duplicate",
        )
        .unwrap();
    state
        .store
        .lock()
        .unwrap()
        .mark_component_operation_attempted("context-a", "duplicate")
        .unwrap();
    for content in ["uncertain content", "external duplicate"] {
        let envelope=json!({"id":"mem-duplicate","scope":"project","content":content,"provenance":"Explicit synthetic fixture"}).to_string();
        raw(
            &state,
            "atlas",
            "context-a",
            &[
                "record",
                "luuna-project",
                &envelope,
                "--type",
                "convention",
                "--tags",
                "mem-duplicate",
                "--force",
            ],
        )
        .await;
    }
    let error = create_memory(
        State(state.clone()),
        Path("context-a".into()),
        Json(CreateMemory {
            idempotency_key: "duplicate".into(),
            scope: "project".into(),
            content: "uncertain content".into(),
            provenance: "Explicit synthetic fixture".into(),
        }),
    )
    .await
    .err()
    .unwrap();
    assert_eq!(error.0, StatusCode::CONFLICT);
    assert!(error.1.contains("Duplicate Atlas delivery identities"));
    assert!(state
        .store
        .lock()
        .unwrap()
        .memory_binding("context-a", "mem-duplicate")
        .unwrap()
        .is_none());
}

#[tokio::test]
#[ignore = "requires pinned Bun and real component checkouts; run with --ignored"]
async fn components_real_schema_change_invalidates_approval_even_with_same_prompt_body() {
    let root = tempfile::tempdir().unwrap();
    let state = setup(root.path());
    let _ = enable(State(state.clone()), Path("context-a".into()))
        .await
        .unwrap();
    prompt(&state, "schema-prompt", "Required guidance", None).await;
    raw(
        &state,
        "beacon",
        "context-a",
        &[
            "schema",
            "create",
            "--name",
            "approval",
            "--required",
            "guidance",
        ],
    )
    .await;
    raw(
        &state,
        "beacon",
        "context-a",
        &["update", "guidance", "--schema", "approval"],
    )
    .await;
    let rendered = render_prompt(
        State(state.clone()),
        Path(("context-a".into(), "guidance".into())),
        Query(PromptQuery { version: None }),
    )
    .await
    .unwrap()
    .0;
    let context = resolve_selection(
        &state,
        "context-a",
        Some(&SelectContext {
            memory_ids: vec![],
            prompt: Some(PromptReference {
                name: rendered.name.clone(),
                version: rendered.version,
                hash: rendered.hash.clone(),
            }),
        }),
    )
    .await
    .unwrap()
    .unwrap();
    raw(
        &state,
        "beacon",
        "context-a",
        &[
            "schema",
            "rule",
            "add",
            "approval",
            "--section",
            "guidance",
            "--pattern",
            "Required",
            "--message",
            "Requires expected text",
        ],
    )
    .await;
    let updated = render_prompt(
        State(state.clone()),
        Path(("context-a".into(), "guidance".into())),
        Query(PromptQuery { version: None }),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(updated.body, rendered.body);
    assert_ne!(updated.hash, rendered.hash);
    assert_eq!(
        resolve_approved(&state, "context-a", Some(&context))
            .await
            .err()
            .unwrap()
            .0,
        StatusCode::CONFLICT
    );
    raw(
        &state,
        "beacon",
        "context-a",
        &[
            "schema",
            "rule",
            "add",
            "approval",
            "--section",
            "guidance",
            "--pattern",
            "IMPOSSIBLE",
            "--message",
            "Fixture failure",
        ],
    )
    .await;
    assert_eq!(
        render_prompt(
            State(state.clone()),
            Path(("context-a".into(), "guidance".into())),
            Query(PromptQuery { version: None })
        )
        .await
        .err()
        .unwrap()
        .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
#[ignore = "requires pinned Bun and real component checkouts; run with --ignored"]
async fn components_real_uncertain_prompt_reconciles_and_memory_edits_stale_context() {
    let root = tempfile::tempdir().unwrap();
    let state = setup(root.path());
    let _ = enable(State(state.clone()), Path("context-a".into()))
        .await
        .unwrap();
    let request = json!({"name":"guidance","body":"Reserved prompt","expected_version":null});
    let operation = state
        .store
        .lock()
        .unwrap()
        .begin_component_operation(
            "context-a",
            "pending-prompt",
            "prompt.create",
            &request,
            "prompt-reserved",
        )
        .unwrap();
    state
        .store
        .lock()
        .unwrap()
        .mark_component_operation_attempted("context-a", "pending-prompt")
        .unwrap();
    let marker = format!("luuna_request={}", operation.record_id);
    raw(
        &state,
        "beacon",
        "context-a",
        &[
            "create",
            "--name",
            "guidance",
            "--section",
            "guidance=Reserved prompt",
            "--fm",
            &marker,
        ],
    )
    .await;
    let config = (*state.config).clone();
    drop(state);
    let restarted = AppState::open(config)
        .unwrap()
        .with_components(luuna_components::Components::discover().unwrap());
    let recovered = prompt(&restarted, "pending-prompt", "Reserved prompt", None).await;
    assert_eq!(recovered.version, 1);
    assert_eq!(
        list_prompts(State(restarted.clone()), Path("context-a".into()))
            .await
            .unwrap()
            .0
            .len(),
        1
    );
    let original = memory(
        &restarted,
        "context-a",
        "editable",
        "project",
        "Original memory",
    )
    .await;
    let context = resolve_selection(
        &restarted,
        "context-a",
        Some(&SelectContext {
            memory_ids: vec![original.id.clone()],
            prompt: None,
        }),
    )
    .await
    .unwrap()
    .unwrap();
    let binding = restarted
        .store
        .lock()
        .unwrap()
        .memory_binding("context-a", &original.id)
        .unwrap()
        .unwrap();
    let edited=json!({"id":original.id,"scope":"project","content":"Externally edited memory","provenance":"Explicit synthetic fixture"}).to_string();
    raw(
        &restarted,
        "atlas",
        "context-a",
        &[
            "edit",
            &binding.domain,
            &binding.source_id,
            "--content",
            &edited,
        ],
    )
    .await;
    assert_eq!(
        resolve_approved(&restarted, "context-a", Some(&context))
            .await
            .err()
            .unwrap()
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        delete_memory(
            State(restarted.clone()),
            Path(("context-a".into(), original.id)),
            Query(DeleteMemoryQuery {
                expected_hash: original.hash
            })
        )
        .await
        .err()
        .unwrap()
        .0,
        StatusCode::CONFLICT
    );
}
#[tokio::test]
#[ignore = "requires pinned Bun and real component checkouts; run with --ignored"]
async fn components_real_promotion_widens_scope_and_export_keeps_private_memory_home() {
    let root = tempfile::tempdir().unwrap();
    let state = setup(root.path());
    let _ = enable(State(state.clone()), Path("context-a".into()))
        .await
        .unwrap();
    let process = memory(
        &state,
        "context-a",
        "p1",
        "process",
        "process convention worth keeping",
    )
    .await;
    let private = memory(&state, "context-a", "u1", "user", "PRIVATE_USER_ONLY").await;
    let promote = |id: String, key: &str, hash: String, to_scope: &str| {
        let state = state.clone();
        let key = key.to_owned();
        let to_scope = to_scope.to_owned();
        async move {
            promote_memory(
                State(state),
                Path(("context-a".into(), id)),
                Json(PromoteMemory {
                    idempotency_key: key,
                    expected_hash: hash,
                    to_scope,
                }),
            )
            .await
        }
    };
    // Only one widening step at a time, and only from the displayed state.
    assert_eq!(
        promote(process.id.clone(), "skip", process.hash.clone(), "user")
            .await
            .err()
            .unwrap()
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let stale =
        "sha256:0000000000000000000000000000000000000000000000000000000000000000".to_owned();
    assert_eq!(
        promote(process.id.clone(), "stale", stale, "project")
            .await
            .err()
            .unwrap()
            .0,
        StatusCode::CONFLICT
    );
    let first = promote(process.id.clone(), "pr1", process.hash.clone(), "project")
        .await
        .unwrap()
        .0;
    assert_eq!(first["promoted"]["scope"], "project");
    assert_eq!(
        first["promoted"]["content"],
        "process convention worth keeping"
    );
    let provenance = first["promoted"]["provenance"].as_str().unwrap();
    assert!(
        provenance.starts_with(&format!("promoted from process memory {}: ", process.id)),
        "{provenance}"
    );
    assert_eq!(first["from"]["id"], process.id);
    // The same key replays the same answer without a second record.
    let replay = promote(process.id.clone(), "pr1", process.hash.clone(), "project")
        .await
        .unwrap()
        .0;
    assert_eq!(replay, first);
    let listed = list_memory(
        State(state.clone()),
        Path("context-a".into()),
        Query(MemoryQuery {
            include_user: false,
            q: None,
        }),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, first["promoted"]["id"]);
    assert_ne!(listed[0].id, process.id);
    // Project -> user leaves the project list and joins the explicit user view.
    let promoted_id = first["promoted"]["id"].as_str().unwrap().to_owned();
    let promoted_hash = first["promoted"]["hash"].as_str().unwrap().to_owned();
    let second = promote(promoted_id.clone(), "pr2", promoted_hash, "user")
        .await
        .unwrap()
        .0;
    assert_eq!(second["promoted"]["scope"], "user");
    let project_only = list_memory(
        State(state.clone()),
        Path("context-a".into()),
        Query(MemoryQuery {
            include_user: false,
            q: None,
        }),
    )
    .await
    .unwrap()
    .0;
    assert!(project_only.is_empty());
    let with_user = list_memory(
        State(state.clone()),
        Path("context-a".into()),
        Query(MemoryQuery {
            include_user: true,
            q: Some("worth keeping".into()),
        }),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(with_user.len(), 1);
    assert_eq!(with_user[0].id, second["promoted"]["id"]);
    // The export carries project and process memory only, and no path of this host.
    let project_memory = memory(
        &state,
        "context-a",
        "p2",
        "project",
        "exported project convention",
    )
    .await;
    let export = export_project(State(state.clone()), Path("context-a".into()))
        .await
        .unwrap()
        .0;
    let memories = export["memory"].as_array().unwrap();
    assert_eq!(memories.len(), 1);
    assert_eq!(memories[0]["id"], project_memory.id);
    let text = export.to_string();
    assert!(!text.contains("PRIVATE_USER_ONLY"));
    assert!(!text.contains(&private.content));
    assert!(!text.contains(&root.path().to_string_lossy().replace('\\', "\\\\")));
    assert!(export["omitted"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item == "user memory"));
    // Text that would carry a host path is refused rather than exported.
    let ticket = luuna_domain::Ticket {
        schema_version: luuna_domain::SCHEMA_VERSION.into(),
        id: "leaky".into(),
        project_id: "context-a".into(),
        revision: 1,
        source: luuna_domain::TicketSource::LuunaSqliteTemporary,
        title: "Leaky ticket".into(),
        intent: format!("Look in {}", root.path().join("context-a").display()),
        acceptance_criteria: vec!["none".into()],
        repository_ids: vec!["app".into()],
        created_at: "2026-10-21T00:00:00.000Z".into(),
        updated_at: "2026-10-21T00:00:00.000Z".into(),
    };
    state
        .store
        .lock()
        .unwrap()
        .create_ticket(&ticket, "leaky-key")
        .unwrap();
    let refused = export_project(State(state.clone()), Path("context-a".into()))
        .await
        .err()
        .unwrap();
    assert_eq!(refused.0, StatusCode::CONFLICT);
    assert!(refused.1.contains("Export refused"), "{}", refused.1);
}
