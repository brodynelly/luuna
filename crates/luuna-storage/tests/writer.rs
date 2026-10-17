//! Tickets, plan workflows, leases and attempts: every stale or duplicate input fails closed.
use luuna_domain::{
    Approval, AttemptState, BaselineEvidence, BaselineIdentity, BaselineStatus, CheckResult,
    CheckStatus, DirtyState, DomainError, ExecutionProfile, LeaseState, ManifestCheck,
    PlanRevision, ProjectManifest, ProjectPolicy, RepositoryIdentity, RepositoryManifest,
    RepositoryObservation, RunState, Ticket, TicketSource, WorktreeLease, SCHEMA_VERSION,
};
use luuna_storage::{StorageError, Store};
use std::collections::BTreeMap;

const REMOTE: &str = "https://example.invalid/app.git";
const HOST: &str = "sha256:1111111111111111111111111111111111111111111111111111111111111111";

fn observation() -> RepositoryObservation {
    RepositoryObservation {
        local_path: "/srv/checkouts/app".into(),
        identity: RepositoryIdentity {
            remote: Some(REMOTE.into()),
            push_remote: None,
            root_commits: vec!["1".repeat(40)],
            shallow: false,
        },
        head_commit: "2".repeat(40),
        branch: Some("main".into()),
        remote_default_branch: None,
        local_branches: vec!["main".into()],
        dirty: DirtyState::default(),
        git_version: "git version 2.43.0".into(),
        observed_at: "2026-10-17T00:00:00.000Z".into(),
    }
}
fn manifest(revision: u64) -> ProjectManifest {
    ProjectManifest {
        schema_version: "0.1".into(),
        id: "project".into(),
        name: "Project".into(),
        revision,
        repositories: vec![RepositoryManifest {
            id: "app".into(),
            remote: REMOTE.into(),
            default_branch: "main".into(),
            profiles: vec!["rust".into()],
            execution: ExecutionProfile::Native,
            checks: vec![ManifestCheck {
                id: "unit".into(),
                executable: "cargo".into(),
                args: vec!["test".into(), "--locked".into()],
                required: true,
                timeout_seconds: 120 + revision,
                capabilities: vec!["rust".into()],
                cwd: ".".into(),
            }],
        }],
        relationships: vec![],
        policy: ProjectPolicy::v1(1, 1, 2),
    }
}
fn ticket() -> Ticket {
    Ticket {
        schema_version: SCHEMA_VERSION.into(),
        id: "ticket-1".into(),
        project_id: "project".into(),
        revision: 1,
        source: TicketSource::LuunaSqliteTemporary,
        title: "Fixture feature".into(),
        intent: "Implement the fixture feature.".into(),
        acceptance_criteria: vec!["The fixture test passes.".into()],
        repository_ids: vec!["app".into()],
        created_at: "2026-10-17T00:00:00.000Z".into(),
        updated_at: "2026-10-17T00:00:00.000Z".into(),
    }
}
fn confirmed_store() -> (Store, String) {
    let mut store = Store::open(":memory:").unwrap();
    store
        .register_project("project", "Project", &[("app".into(), observation())])
        .unwrap();
    let fresh = BTreeMap::from([("app".to_owned(), observation())]);
    let project = store
        .confirm_manifest("project", 0, &manifest(1), &fresh)
        .unwrap();
    (store, project.manifest_hash.unwrap())
}
fn plan(manifest_hash: &str, revision: u64, ticket_revision: u64) -> PlanRevision {
    let mut plan: PlanRevision =
        serde_json::from_str(include_str!("../../../fixtures/domain/plan.valid.json")).unwrap();
    plan.revision = revision;
    plan.ticket_revision = ticket_revision;
    plan.manifest_hash = manifest_hash.to_owned();
    plan.base_commits
        .insert("app".into(), observation().head_commit);
    plan.seal().unwrap()
}
fn approval(plan: &PlanRevision) -> Approval {
    Approval {
        schema_version: SCHEMA_VERSION.into(),
        id: format!("approval-{}", plan.revision),
        plan_id: plan.id.clone(),
        plan_revision: plan.revision,
        plan_hash: plan.hash.clone(),
        approved_by: "human".into(),
        approved_at: "2026-10-17T00:00:00Z".into(),
        permissions: plan.permissions.clone(),
    }
}
fn identity(plan: &PlanRevision) -> BaselineIdentity {
    BaselineIdentity {
        manifest_hash: plan.manifest_hash.clone(),
        repository_id: "app".into(),
        commit: plan.base_commits["app"].clone(),
        tree: "3".repeat(40),
    }
}
/// A passed, settled baseline for the plan's commit on this host.
fn passed_baseline(store: &mut Store, plan: &PlanRevision) {
    let identity = identity(plan);
    let run_id = "baseline-run";
    store
        .create_run(run_id, "project", serde_json::json!({"kind":"baseline"}))
        .unwrap();
    store
        .start_baseline(&BaselineEvidence {
            id: "baseline".into(),
            run_id: run_id.into(),
            project_id: "project".into(),
            manifest_revision: 1,
            identity: identity.clone(),
            environment_fingerprint: HOST.into(),
            status: BaselineStatus::Running,
            required_checks: vec!["unit".into()],
            results: vec![],
            started_at: "2026-10-17T00:00:00.000Z".into(),
            finished_at: None,
            reason: None,
        })
        .unwrap();
    store
        .record_check_result(
            "baseline",
            &CheckResult {
                schema_version: SCHEMA_VERSION.into(),
                id: "baseline-unit".into(),
                run_id: run_id.into(),
                repository_id: "app".into(),
                recipe_id: "unit".into(),
                candidate_hash: identity.hash().unwrap(),
                commit: identity.commit.clone(),
                environment_fingerprint: HOST.into(),
                command: vec!["cargo".into(), "test".into()],
                status: CheckStatus::Passed,
                exit_code: Some(0),
                artifact_refs: vec![],
                cwd: ".".into(),
                started_at: None,
                finished_at: None,
                reason: None,
                artifact_hashes: BTreeMap::new(),
                tests_detected: Some(5),
            },
        )
        .unwrap();
    store
        .finish_baseline("baseline", BaselineStatus::Passed, None)
        .unwrap();
    let run = store.get_run(run_id).unwrap().unwrap();
    let run = store
        .transition_run(
            &run.id,
            run.revision,
            RunState::Running,
            "run.running",
            serde_json::json!({}),
        )
        .unwrap();
    store
        .transition_run(
            &run.id,
            run.revision,
            RunState::Completed,
            "run.completed",
            serde_json::json!({}),
        )
        .unwrap();
}
fn lease(run_id: &str, id: &str, path: &str) -> WorktreeLease {
    WorktreeLease {
        id: id.into(),
        run_id: run_id.into(),
        project_id: "project".into(),
        repository_id: "app".into(),
        path: path.into(),
        base_commit: observation().head_commit,
        state: LeaseState::Active,
        candidate_commit: None,
        created_at: "2026-10-17T00:00:00.000Z".into(),
        released_at: None,
        reason: None,
    }
}

#[test]
fn tickets_are_idempotent_revisioned_and_project_scoped() {
    let (mut store, _) = confirmed_store();
    let (created, fresh) = store.create_ticket(&ticket(), "key-1").unwrap();
    assert!(fresh);
    assert_eq!(created.source, TicketSource::LuunaSqliteTemporary);
    let (replayed, fresh) = store.create_ticket(&ticket(), "key-1").unwrap();
    assert!(!fresh);
    assert_eq!(replayed, created);
    let mut different = ticket();
    different.title = "Other".into();
    assert!(matches!(
        store.create_ticket(&different, "key-1"),
        Err(StorageError::AlreadyExists(_))
    ));
    let mut other_id = ticket();
    other_id.id = "ticket-2".into();
    other_id.repository_ids = vec!["missing".into()];
    assert!(matches!(
        store.create_ticket(&other_id, "key-2"),
        Err(StorageError::Invalid(_))
    ));
    let mut stale = ticket();
    stale.id = "ticket-3".into();
    stale.revision = 2;
    assert!(store.create_ticket(&stale, "key-3").is_err());
    let revised = store
        .update_ticket(
            "ticket-1",
            1,
            "Fixture feature v2",
            "Do more.",
            &["still passes".into()],
        )
        .unwrap();
    assert_eq!(revised.revision, 2);
    assert!(matches!(
        store.update_ticket("ticket-1", 1, "x", "y", &["z".into()]),
        Err(StorageError::RevisionConflict {
            expected: 1,
            actual: 2
        })
    ));
    assert_eq!(store.tickets("project").unwrap().len(), 1);
    assert_eq!(store.get_ticket("ticket-1").unwrap().unwrap().revision, 2);
    let events = store.project_events_after("project", 0).unwrap();
    assert!(events.iter().any(|e| e.event_type == "ticket.created"));
    assert!(events.iter().any(|e| e.event_type == "ticket.revised"));
}

#[test]
fn plan_workflows_bind_to_the_current_ticket_manifest_and_base() {
    let (mut store, hash) = confirmed_store();
    store.create_ticket(&ticket(), "key").unwrap();
    let first = plan(&hash, 1, 1);
    let run = store.open_plan_workflow("workflow-1", &first).unwrap();
    assert_eq!(run.state, RunState::PlanReady);
    assert_eq!(run.metadata["kind"], "workflow");
    assert_eq!(
        store.run_for_plan(&first.id, 1).unwrap().unwrap().id,
        "workflow-1"
    );
    assert_eq!(store.plans_for_ticket("ticket-1").unwrap().len(), 1);
    assert_eq!(
        store.latest_plan(&first.id).unwrap().unwrap().hash,
        first.hash
    );
    // Revisions are append-only and sequential.
    assert!(matches!(
        store.open_plan_workflow("workflow-dup", &plan(&hash, 1, 1)),
        Err(StorageError::RevisionConflict { .. })
    ));
    assert!(matches!(
        store.open_plan_workflow("workflow-skip", &plan(&hash, 3, 1)),
        Err(StorageError::RevisionConflict { .. })
    ));
    // A plan for a ticket revision that is not current is refused.
    store
        .update_ticket("ticket-1", 1, "v2", "Do more.", &["ok".into()])
        .unwrap();
    assert!(matches!(
        store.open_plan_workflow("workflow-stale", &plan(&hash, 2, 1)),
        Err(StorageError::RevisionConflict {
            expected: 2,
            actual: 1
        })
    ));
    // A plan against a base commit the manifest did not record is refused.
    let mut wrong_base = plan(&hash, 2, 2);
    wrong_base.base_commits.insert("app".into(), "9".repeat(40));
    let wrong_base = wrong_base.seal().unwrap();
    assert!(matches!(
        store.open_plan_workflow("workflow-base", &wrong_base),
        Err(StorageError::Domain(DomainError::BaselineRequired(_)))
    ));
    // A plan against a stale manifest hash is refused.
    let fresh = BTreeMap::from([("app".to_owned(), observation())]);
    store
        .confirm_manifest("project", 1, &manifest(2), &fresh)
        .unwrap();
    assert!(matches!(
        store.open_plan_workflow("workflow-manifest", &plan(&hash, 2, 2)),
        Err(StorageError::Domain(DomainError::BaselineRequired(_)))
    ));
    let current = store.current_manifest("project").unwrap().unwrap().hash;
    assert_eq!(
        store
            .open_plan_workflow("workflow-2", &plan(&current, 2, 2))
            .unwrap()
            .state,
        RunState::PlanReady
    );
}

#[test]
fn a_ticket_revised_after_approval_blocks_scheduling_until_replanned() {
    let (mut store, hash) = confirmed_store();
    store.create_ticket(&ticket(), "key").unwrap();
    let plan = plan(&hash, 1, 1);
    let run = store.open_plan_workflow("workflow-1", &plan).unwrap();
    let run = store
        .approve_plan(&run.id, run.revision, &approval(&plan))
        .unwrap();
    assert_eq!(run.state, RunState::Approved);
    passed_baseline(&mut store, &plan);
    store
        .update_ticket(
            "ticket-1",
            1,
            "Changed intent",
            "Different work.",
            &["new bar".into()],
        )
        .unwrap();
    let error = store
        .begin_implementation(&run.id, run.revision, HOST)
        .unwrap_err();
    assert!(error.to_string().contains("re-plan"), "{error}");
    assert_eq!(
        store.get_run(&run.id).unwrap().unwrap().state,
        RunState::Approved
    );
}

#[test]
fn leases_are_exclusive_attempts_are_budgeted_and_restart_abandons_both() {
    let (mut store, hash) = confirmed_store();
    store.create_ticket(&ticket(), "key").unwrap();
    let plan = plan(&hash, 1, 1);
    let run = store.open_plan_workflow("workflow-1", &plan).unwrap();
    let run = store
        .approve_plan(&run.id, run.revision, &approval(&plan))
        .unwrap();
    // No lease before implementation is entered.
    assert!(matches!(
        store.acquire_worktree_lease(&lease(&run.id, "lease-early", "/private/wt/early")),
        Err(StorageError::Invalid(_))
    ));
    passed_baseline(&mut store, &plan);
    let run = store
        .begin_implementation(&run.id, run.revision, HOST)
        .unwrap();
    assert_eq!(run.state, RunState::Implementing);
    store
        .acquire_worktree_lease(&lease(&run.id, "lease-1", "/private/wt/1"))
        .unwrap();
    // A second writer on the same repository is refused by the database.
    assert!(matches!(
        store.acquire_worktree_lease(&lease(&run.id, "lease-2", "/private/wt/2")),
        Err(StorageError::AlreadyExists(_))
    ));
    assert_eq!(store.active_worktree_leases().unwrap().len(), 1);
    let first = store
        .start_attempt(
            "attempt-1",
            &run.id,
            "implement",
            plan.budgets.max_attempts,
            serde_json::json!({}),
        )
        .unwrap();
    assert_eq!(first.number, 1);
    assert!(matches!(
        store.start_attempt("attempt-1b", &run.id, "implement", 2, serde_json::json!({})),
        Err(StorageError::AlreadyExists(_))
    ));
    store
        .finish_attempt(
            "attempt-1",
            AttemptState::Failed,
            serde_json::json!({"reason":"synthetic"}),
        )
        .unwrap();
    let released = store
        .release_worktree_lease(
            "lease-1",
            LeaseState::Released,
            None,
            Some("attempt failed"),
        )
        .unwrap();
    assert_eq!(released.state, LeaseState::Released);
    assert!(store
        .release_worktree_lease("lease-1", LeaseState::Released, None, None)
        .is_err());
    // The repository is free again; the next attempt counts against the budget.
    store
        .acquire_worktree_lease(&lease(&run.id, "lease-2", "/private/wt/2"))
        .unwrap();
    let second = store
        .start_attempt("attempt-2", &run.id, "implement", 2, serde_json::json!({}))
        .unwrap();
    assert_eq!(second.number, 2);
    store
        .finish_attempt("attempt-2", AttemptState::Cancelled, serde_json::json!({}))
        .unwrap();
    assert!(matches!(
        store.start_attempt("attempt-3", &run.id, "implement", 2, serde_json::json!({})),
        Err(StorageError::Domain(DomainError::BudgetExceeded(_)))
    ));
    store
        .release_worktree_lease("lease-2", LeaseState::Released, None, Some("cancelled"))
        .unwrap();
    // Restart with an active lease and a running attempt: both are abandoned, files kept.
    store
        .acquire_worktree_lease(&lease(&run.id, "lease-3", "/private/wt/3"))
        .unwrap();
    store
        .start_attempt("attempt-4", &run.id, "implement", 10, serde_json::json!({}))
        .unwrap();
    assert_eq!(store.interrupt_active_runs().unwrap(), 1);
    assert_eq!(
        store.get_run(&run.id).unwrap().unwrap().state,
        RunState::Interrupted
    );
    let leases = store.worktree_leases(&run.id).unwrap();
    assert_eq!(leases.len(), 3);
    assert_eq!(leases[2].state, LeaseState::Abandoned);
    assert_eq!(leases[2].path, "/private/wt/3");
    let attempts = store.attempts(&run.id).unwrap();
    assert_eq!(attempts.len(), 3);
    assert_eq!(attempts[2].state, AttemptState::Interrupted);
    assert!(store.active_worktree_leases().unwrap().is_empty());
}
