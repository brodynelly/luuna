//! Tickets, plan workflows, leases and attempts: every stale or duplicate input fails closed.
use luuna_domain::{
    Approval, AttemptState, BaselineEvidence, BaselineIdentity, BaselineStatus, CandidateSet,
    CandidateStatus, CheckResult, CheckStatus, DirtyState, DomainError, ExecutionProfile, Finding,
    LeaseState, ManifestCheck, PlanRevision, ProjectManifest, ProjectPolicy, RepositoryIdentity,
    RepositoryManifest, RepositoryObservation, ReviewResult, ReviewVerdict, RunState, Severity,
    Ticket, TicketSource, WorktreeLease, SCHEMA_VERSION,
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
    confirmed_store_at(":memory:")
}
fn confirmed_store_at(path: impl AsRef<std::path::Path>) -> (Store, String) {
    let mut store = Store::open(path).unwrap();
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

#[test]
fn missions_delivery_survives_restart_and_preserves_legacy_identity() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.sqlite3");
    let (mut store, _) = confirmed_store_at(&path);
    let original = ticket();
    store.create_ticket(&original, "original-request").unwrap();
    let reservation = store.reserve_missions_delivery(&original.id).unwrap();
    assert!(reservation.source_id.is_none());
    assert!(!reservation.delivery_started);
    store.begin_missions_delivery(&original.id).unwrap();
    drop(store);
    let mut store = Store::open(&path).unwrap();
    assert!(
        store
            .missions_binding(&original.id)
            .unwrap()
            .unwrap()
            .delivery_started
    );
    assert_eq!(
        store
            .missions_binding(&original.id)
            .unwrap()
            .unwrap()
            .original,
        original
    );
    let bound = store
        .complete_missions_delivery(&original.id, 1, "project-abc1", &"a".repeat(64))
        .unwrap();
    assert_eq!(bound.id, original.id);
    assert_eq!(bound.revision, original.revision);
    assert_eq!(bound.created_at, original.created_at);
    assert_eq!(bound.source, TicketSource::Missions);
    assert!(matches!(
        store.update_ticket(
            &bound.id,
            1,
            "wrong authority",
            "intent",
            &["criterion".into()]
        ),
        Err(StorageError::Invalid(_))
    ));
    assert_eq!(
        store
            .complete_missions_delivery(&bound.id, 1, "project-abc1", &"a".repeat(64))
            .unwrap(),
        bound
    );
    assert!(store
        .complete_missions_delivery(&bound.id, 1, "project-other", &"a".repeat(64))
        .is_err());
}

#[test]
fn missions_reconciliation_invalidates_old_plans_and_keeps_delivery_idempotency() {
    let (mut store, manifest_hash) = confirmed_store();
    let original = ticket();
    store.create_ticket(&original, "stable-request").unwrap();
    store.reserve_missions_delivery(&original.id).unwrap();
    let mut projected = store
        .complete_missions_delivery(&original.id, 1, "project-abc1", &"a".repeat(64))
        .unwrap();
    let old_plan = plan(&manifest_hash, 1, 1);
    projected.title = "Changed outside Luuna".into();
    let reconciled = store
        .reconcile_missions_ticket(&projected, 1, "project-abc1", &"b".repeat(64))
        .unwrap();
    assert_eq!(reconciled.revision, 2);
    assert_eq!(reconciled.source, TicketSource::Missions);
    assert!(matches!(
        store.open_plan_workflow("stale", &old_plan),
        Err(StorageError::RevisionConflict { .. })
    ));
    assert!(matches!(
        store.reconcile_missions_ticket(&projected, 1, "project-abc1", &"c".repeat(64)),
        Err(StorageError::RevisionConflict { .. })
    ));
    let (replayed, created) = store.create_ticket(&original, "stable-request").unwrap();
    assert!(!created);
    assert_eq!(replayed, reconciled);
    let unchanged = store
        .reconcile_missions_ticket(&reconciled, 2, "project-abc1", &"b".repeat(64))
        .unwrap();
    assert_eq!(unchanged.revision, 2);
    let mut widened = reconciled;
    widened.repository_ids.push("unregistered".into());
    assert!(matches!(
        store.reconcile_missions_ticket(&widened, 2, "project-abc1", &"c".repeat(64)),
        Err(StorageError::Invalid(_))
    ));
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
                truncated_artifacts: Vec::new(),
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
    let recovered_usage = store.workflow_usage(&run.id).unwrap();
    assert!(recovered_usage.elapsed_seconds >= plan.budgets.timeout_seconds);
    assert!(recovered_usage.cost_usd_micros >= plan.budgets.cost_usd_micros);
    assert!(store.active_worktree_leases().unwrap().is_empty());
}

#[test]
fn ticket_retries_at_quota_replay_but_new_deliveries_are_refused() {
    let (mut store, _) = confirmed_store();
    for index in 0..1000 {
        let mut input = ticket();
        input.id = format!("ticket-{index}");
        assert!(
            store
                .create_ticket(&input, &format!("key-{index}"))
                .unwrap()
                .1
        );
    }
    let mut input = ticket();
    input.id = "new-delivery".into();
    let (replayed, created) = store.create_ticket(&input, "key-999").unwrap();
    assert!(!created);
    assert_eq!(replayed.id, "ticket-999");
    assert!(matches!(
        store.create_ticket(&input, "new-key"),
        Err(StorageError::Invalid(_))
    ));
    input.title = "different intent".into();
    assert!(matches!(
        store.create_ticket(&input, "key-999"),
        Err(StorageError::AlreadyExists(_))
    ));
}

fn candidate_fixture() -> (Store, PlanRevision, CandidateSet) {
    candidate_fixture_at(":memory:", 2)
}
fn candidate_fixture_at(
    path: impl AsRef<std::path::Path>,
    max_attempts: u32,
) -> (Store, PlanRevision, CandidateSet) {
    let (mut store, hash) = confirmed_store_at(path);
    store.create_ticket(&ticket(), "key").unwrap();
    let mut plan = plan(&hash, 1, 1);
    plan.budgets.max_attempts = max_attempts;
    let plan = plan.seal().unwrap();
    let run = store.open_plan_workflow("workflow-1", &plan).unwrap();
    let run = store
        .approve_plan(&run.id, run.revision, &approval(&plan))
        .unwrap();
    passed_baseline(&mut store, &plan);
    let run = store
        .begin_implementation(&run.id, run.revision, HOST)
        .unwrap();
    store
        .start_attempt("writer-1", &run.id, "implement", 2, serde_json::json!({}))
        .unwrap();
    store
        .finish_attempt(
            "writer-1",
            AttemptState::Completed,
            serde_json::json!({"usage":{"elapsed_seconds":10,"cost_usd_micros":100}}),
        )
        .unwrap();
    let mut candidate = CandidateSet {
        schema_version: SCHEMA_VERSION.into(),
        id: "candidate-1".into(),
        revision: 1,
        plan_hash: plan.hash.clone(),
        repository_commits: BTreeMap::from([("app".into(), "c".repeat(40))]),
        dependency_bindings: BTreeMap::new(),
        hash: String::new(),
    };
    candidate.hash = candidate.computed_hash().unwrap();
    store
        .record_candidate(
            &run.id,
            run.revision,
            &candidate,
            &BTreeMap::from([("app".into(), "d".repeat(40))]),
            "writer-1",
        )
        .unwrap();
    (store, plan, candidate)
}

fn candidate_check(candidate: &CandidateSet, status: CheckStatus) -> CheckResult {
    CheckResult {
        schema_version: SCHEMA_VERSION.into(),
        id: "candidate-unit".into(),
        run_id: "workflow-1".into(),
        repository_id: "app".into(),
        recipe_id: "unit".into(),
        candidate_hash: candidate.hash.clone(),
        commit: candidate.repository_commits["app"].clone(),
        environment_fingerprint: HOST.into(),
        command: vec!["cargo".into(), "test".into(), "--locked".into()],
        status,
        exit_code: if status == CheckStatus::Passed {
            Some(0)
        } else {
            Some(1)
        },
        artifact_refs: vec!["artifact:workflow-1:unit:stdout".into()],
        cwd: ".".into(),
        started_at: None,
        finished_at: None,
        reason: None,
        artifact_hashes: BTreeMap::new(),
        tests_detected: Some(5),
        truncated_artifacts: Vec::new(),
    }
}

fn begin_validation(store: &mut Store, candidate: &CandidateSet) {
    let run = store.get_run("workflow-1").unwrap().unwrap();
    store
        .begin_candidate_validation(&run.id, run.revision, &candidate.hash)
        .unwrap();
}

fn finish_validation(store: &mut Store, candidate: &CandidateSet) {
    let run = store.get_run("workflow-1").unwrap().unwrap();
    store
        .finish_candidate_validation(&run.id, run.revision, &candidate.hash)
        .unwrap();
}

fn review(candidate: &CandidateSet) -> ReviewResult {
    ReviewResult {
        schema_version: SCHEMA_VERSION.into(),
        id: "review-1".into(),
        candidate_hash: candidate.hash.clone(),
        reviewer_session: "independent-reviewer".into(),
        findings: vec![],
        verdict: ReviewVerdict::Passed,
        evidence: vec!["artifact:workflow-1:review".into()],
    }
}

#[test]
fn candidate_gates_reject_stale_checks_forged_recipes_and_review_bypasses() {
    let (mut store, _, candidate) = candidate_fixture();
    let run = store.get_run("workflow-1").unwrap().unwrap();
    for state in [RunState::Reviewing, RunState::Reviewed] {
        assert!(store
            .transition_run(
                &run.id,
                run.revision,
                state,
                "forged",
                serde_json::json!({})
            )
            .is_err());
    }
    let result = candidate_check(&candidate, CheckStatus::Passed);
    assert!(store
        .record_candidate_check(&run.id, &candidate.hash, &result)
        .is_err());
    begin_validation(&mut store, &candidate);
    let run = store.get_run(&run.id).unwrap().unwrap();
    assert!(store
        .begin_candidate_validation(&run.id, run.revision, &candidate.hash)
        .is_err());
    for mutation in ["hash", "commit", "command", "cwd", "run", "recipe"] {
        let mut wrong = result.clone();
        match mutation {
            "hash" => wrong.candidate_hash = format!("sha256:{}", "f".repeat(64)),
            "commit" => wrong.commit = "e".repeat(40),
            "command" => wrong.command.push("--ignored".into()),
            "cwd" => wrong.cwd = "elsewhere".into(),
            "run" => wrong.run_id = "other".into(),
            _ => wrong.recipe_id = "other".into(),
        }
        assert!(
            store
                .record_candidate_check(&run.id, &candidate.hash, &wrong)
                .is_err(),
            "{mutation}"
        );
    }
    store
        .record_candidate_check(&run.id, &candidate.hash, &result)
        .unwrap();
    assert!(store
        .record_candidate_check(&run.id, &candidate.hash, &result)
        .is_err());
    finish_validation(&mut store, &candidate);
    let run = store.get_run(&run.id).unwrap().unwrap();
    assert_eq!(run.state, RunState::Reviewing);
    let mut same = review(&candidate);
    same.reviewer_session = "writer-1".into();
    assert!(store
        .finish_candidate_review(&run.id, run.revision, &candidate.hash, &same)
        .is_err());
    let mut blocking = review(&candidate);
    blocking.findings.push(Finding {
        severity: Severity::Blocking,
        path: "src/main.rs".into(),
        line: 1,
        explanation: "seeded regression".into(),
        evidence: vec!["failing case".into()],
    });
    assert!(store
        .finish_candidate_review(&run.id, run.revision, &candidate.hash, &blocking)
        .is_err());
    let mut stale = review(&candidate);
    stale.candidate_hash = format!("sha256:{}", "a".repeat(64));
    assert!(store
        .finish_candidate_review(&run.id, run.revision, &candidate.hash, &stale)
        .is_err());
    store
        .finish_candidate_review(&run.id, run.revision, &candidate.hash, &review(&candidate))
        .unwrap();
    assert_eq!(
        store.get_run(&run.id).unwrap().unwrap().state,
        RunState::Reviewed
    );
    assert_eq!(
        store.current_candidate(&run.id).unwrap().unwrap().review,
        Some(review(&candidate))
    );
}

#[test]
fn a_review_that_would_end_past_the_budget_pauses_instead_of_being_recorded() {
    let (mut store, plan, candidate) = candidate_fixture();
    begin_validation(&mut store, &candidate);
    let run = store.get_run("workflow-1").unwrap().unwrap();
    store
        .record_candidate_check(
            &run.id,
            &candidate.hash,
            &candidate_check(&candidate, CheckStatus::Passed),
        )
        .unwrap();
    // Validation leaves one approved second for the review.
    let used = store.workflow_usage("workflow-1").unwrap().elapsed_seconds;
    store
        .charge_candidate_usage(
            "workflow-1",
            &candidate.hash,
            plan.budgets.timeout_seconds - 1 - used,
            0,
        )
        .unwrap();
    finish_validation(&mut store, &candidate);
    assert_eq!(
        store.get_run("workflow-1").unwrap().unwrap().state,
        RunState::Reviewing
    );
    // The review then takes longer than that second, and the worker has not
    // charged it yet when the verdict is recorded.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    let run = store.get_run("workflow-1").unwrap().unwrap();
    let settled = store
        .finish_candidate_review(&run.id, run.revision, &candidate.hash, &review(&candidate))
        .unwrap();
    assert_eq!(settled.status, CandidateStatus::Paused);
    assert!(settled.review.is_none());
    assert_eq!(
        store.get_run("workflow-1").unwrap().unwrap().state,
        RunState::Paused
    );
    assert!(
        store.workflow_usage("workflow-1").unwrap().elapsed_seconds > plan.budgets.timeout_seconds
    );
}

#[test]
fn failed_missing_or_blocked_candidate_checks_never_reach_review() {
    for status in [Some(CheckStatus::Failed), Some(CheckStatus::Blocked), None] {
        let (mut store, _, candidate) = candidate_fixture();
        begin_validation(&mut store, &candidate);
        if let Some(status) = status {
            store
                .record_candidate_check(
                    "workflow-1",
                    &candidate.hash,
                    &candidate_check(&candidate, status),
                )
                .unwrap();
        }
        finish_validation(&mut store, &candidate);
        let expected = if status == Some(CheckStatus::Blocked) {
            RunState::TestingBlocked
        } else {
            RunState::Failed
        };
        assert_eq!(
            store.get_run("workflow-1").unwrap().unwrap().state,
            expected
        );
        assert!(store
            .current_candidate("workflow-1")
            .unwrap()
            .unwrap()
            .reason
            .is_some());
        assert!(store
            .can_candidate_repair("workflow-1", &candidate.hash)
            .is_ok());
    }
}

#[test]
fn repair_revisions_invalidate_checks_and_reviews_without_resetting_usage() {
    let (mut store, plan, candidate) = candidate_fixture();
    begin_validation(&mut store, &candidate);
    store
        .record_candidate_check(
            "workflow-1",
            &candidate.hash,
            &candidate_check(&candidate, CheckStatus::Passed),
        )
        .unwrap();
    finish_validation(&mut store, &candidate);
    let run = store.get_run("workflow-1").unwrap().unwrap();
    let mut rejected = review(&candidate);
    rejected.verdict = ReviewVerdict::ChangesRequired;
    store
        .finish_candidate_review(&run.id, run.revision, &candidate.hash, &rejected)
        .unwrap();
    let usage = store
        .charge_candidate_usage(&run.id, &candidate.hash, 20, 200)
        .unwrap();
    // 10 s writer + 20 s charged + the validation and review stages, each
    // finalized with at least its live time rounded up to a whole second.
    assert_eq!(usage.elapsed_seconds, 32);
    assert_eq!(usage.cost_usd_micros, 300);
    let run = store.get_run(&run.id).unwrap().unwrap();
    let run = store
        .begin_candidate_repair(&run.id, run.revision, &candidate.hash, HOST)
        .unwrap();
    store
        .start_attempt(
            "writer-2",
            &run.id,
            "implement",
            plan.budgets.max_attempts,
            serde_json::json!({}),
        )
        .unwrap();
    store
        .finish_attempt(
            "writer-2",
            AttemptState::Completed,
            serde_json::json!({"usage":{"elapsed_seconds":4,"cost_usd_micros":40}}),
        )
        .unwrap();
    let mut revised = candidate.clone();
    revised.revision += 1;
    revised
        .repository_commits
        .insert("app".into(), "e".repeat(40));
    revised.hash = revised.computed_hash().unwrap();
    store
        .record_candidate(
            &run.id,
            run.revision,
            &revised,
            &BTreeMap::from([("app".into(), "f".repeat(40))]),
            "writer-2",
        )
        .unwrap();
    let current = store.current_candidate(&run.id).unwrap().unwrap();
    assert!(current.results.is_empty());
    assert!(current.review.is_none());
    assert!(store
        .record_candidate_check(
            &run.id,
            &candidate.hash,
            &candidate_check(&candidate, CheckStatus::Passed)
        )
        .is_err());
    let usage = store.workflow_usage(&run.id).unwrap();
    assert_eq!(usage.attempts, 2);
    // 32 s from the first revision plus the 4 s repair attempt.
    assert_eq!(usage.elapsed_seconds, 36);
    begin_validation(&mut store, &revised);
    finish_validation(&mut store, &revised);
    assert!(matches!(
        store.can_candidate_repair(&run.id, &revised.hash),
        Err(StorageError::Domain(DomainError::BudgetExceeded(_)))
    ));
    let failed = store.get_run(&run.id).unwrap().unwrap();
    assert!(store
        .begin_implementation(&run.id, failed.revision, HOST)
        .is_err());
    assert_eq!(store.candidates(&run.id).unwrap().len(), 2);
}

#[test]
fn restart_keeps_consumed_budgets_and_retries_with_fresh_evidence_generation() {
    let (mut store, _, candidate) = candidate_fixture();
    begin_validation(&mut store, &candidate);
    store
        .record_candidate_check(
            "workflow-1",
            &candidate.hash,
            &candidate_check(&candidate, CheckStatus::Passed),
        )
        .unwrap();
    store
        .charge_candidate_usage("workflow-1", &candidate.hash, 12, 130)
        .unwrap();
    store.interrupt_active_runs().unwrap();
    let interrupted = store.current_candidate("workflow-1").unwrap().unwrap();
    assert_eq!(interrupted.status, CandidateStatus::Interrupted);
    begin_validation(&mut store, &candidate);
    let resumed = store.current_candidate("workflow-1").unwrap().unwrap();
    assert_eq!(resumed.validation_generation, 2);
    assert!(resumed.results.is_empty());
    let mut fresh = candidate_check(&candidate, CheckStatus::Passed);
    fresh.id = "fresh-unit".into();
    store
        .record_candidate_check("workflow-1", &candidate.hash, &fresh)
        .unwrap();
    finish_validation(&mut store, &candidate);
    // The finalized validation stage charges its live time rounded up (1 s).
    assert_eq!(
        store.workflow_usage("workflow-1").unwrap().elapsed_seconds,
        23
    );
    store.interrupt_active_runs().unwrap();
    assert_eq!(
        store
            .current_candidate("workflow-1")
            .unwrap()
            .unwrap()
            .status,
        CandidateStatus::Interrupted
    );
    let interrupted = store.get_run("workflow-1").unwrap().unwrap();
    assert!(matches!(
        store.begin_candidate_validation(&interrupted.id, interrupted.revision, &candidate.hash),
        Err(StorageError::Domain(DomainError::BudgetExceeded(_)))
    ));
}

#[test]
fn changed_ticket_prevents_validation_and_review_and_exhaustion_is_durable() {
    let (mut changed, _, pending) = candidate_fixture();
    changed
        .update_ticket(
            "ticket-1",
            1,
            "changed",
            "Different intent",
            &["different".into()],
        )
        .unwrap();
    let pending_run = changed.get_run("workflow-1").unwrap().unwrap();
    assert!(changed
        .begin_candidate_validation(&pending_run.id, pending_run.revision, &pending.hash)
        .is_err());
    let (mut store, _, candidate) = candidate_fixture();
    begin_validation(&mut store, &candidate);
    store
        .record_candidate_check(
            "workflow-1",
            &candidate.hash,
            &candidate_check(&candidate, CheckStatus::Passed),
        )
        .unwrap();
    finish_validation(&mut store, &candidate);
    store
        .update_ticket(
            "ticket-1",
            1,
            "revised",
            "New intent",
            &["new criterion".into()],
        )
        .unwrap();
    let run = store.get_run("workflow-1").unwrap().unwrap();
    assert!(store
        .finish_candidate_review(&run.id, run.revision, &candidate.hash, &review(&candidate))
        .is_err());
    let usage = store
        .charge_candidate_usage(&run.id, &candidate.hash, 500, 1_000_000)
        .unwrap();
    // 10 s writer + 500 s charged + the finalized validation stage's live
    // time rounded up (1 s).
    assert_eq!(usage.elapsed_seconds, 511);
    assert_eq!(
        store.get_run(&run.id).unwrap().unwrap().state,
        RunState::Paused
    );
    assert!(store
        .can_candidate_repair(&run.id, &candidate.hash)
        .is_err());
    assert!(store
        .current_candidate(&run.id)
        .unwrap()
        .unwrap()
        .reason
        .unwrap()
        .contains("budget exceeded"));
}

#[test]
fn restart_conservatively_accounts_for_uncharged_stage_time_and_unknown_review_cost() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("state.sqlite");
    let (mut store, plan, candidate) = candidate_fixture_at(&path, 2);
    begin_validation(&mut store, &candidate);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute("UPDATE candidates SET payload=json_set(payload,'$.stage_started_at','2000-01-01T00:00:00.000Z') WHERE hash=?1",[&candidate.hash]).unwrap();
    drop(connection);
    drop(store);
    let mut store = Store::open(&path).unwrap();
    store.interrupt_active_runs().unwrap();
    let usage = store.workflow_usage("workflow-1").unwrap();
    assert!(usage.elapsed_seconds >= plan.budgets.timeout_seconds);
    let run = store.get_run("workflow-1").unwrap().unwrap();
    assert!(store
        .begin_candidate_validation(&run.id, run.revision, &candidate.hash)
        .is_err());
    store.interrupt_active_runs().unwrap();
    assert_eq!(store.workflow_usage(&run.id).unwrap(), usage);

    let (mut store, plan, candidate) = candidate_fixture();
    begin_validation(&mut store, &candidate);
    store
        .record_candidate_check(
            "workflow-1",
            &candidate.hash,
            &candidate_check(&candidate, CheckStatus::Passed),
        )
        .unwrap();
    finish_validation(&mut store, &candidate);
    store.interrupt_active_runs().unwrap();
    let usage = store.workflow_usage("workflow-1").unwrap();
    assert_eq!(usage.cost_usd_micros, plan.budgets.cost_usd_micros);
    store.interrupt_active_runs().unwrap();
    assert_eq!(store.workflow_usage("workflow-1").unwrap(), usage);
}

#[test]
fn project_repair_limit_and_changed_host_block_repairs_independently_of_attempt_budget() {
    let (mut store, _, candidate) = candidate_fixture_at(":memory:", 10);
    begin_validation(&mut store, &candidate);
    finish_validation(&mut store, &candidate);
    let run = store.get_run("workflow-1").unwrap().unwrap();
    assert!(store
        .begin_candidate_repair(&run.id, run.revision, &candidate.hash, "different-host")
        .is_err());
    for index in 0..2 {
        let run = store.get_run("workflow-1").unwrap().unwrap();
        let run = store
            .begin_candidate_repair(&run.id, run.revision, &candidate.hash, HOST)
            .unwrap();
        let id = format!("repair-{index}");
        store
            .start_attempt(&id, &run.id, "implement", 10, serde_json::json!({}))
            .unwrap();
        store
            .finish_attempt(&id, AttemptState::Failed, serde_json::json!({}))
            .unwrap();
        store
            .transition_run(
                &run.id,
                run.revision,
                RunState::Failed,
                "run.failed",
                serde_json::json!({"reason":"synthetic writer failure"}),
            )
            .unwrap();
    }
    let error = store
        .can_candidate_repair("workflow-1", &candidate.hash)
        .unwrap_err();
    assert!(error.to_string().contains("max_task_repairs"));
    assert_eq!(store.workflow_usage("workflow-1").unwrap().attempts, 3);
}

#[test]
fn checks_at_exact_budget_limit_pause_before_starting_independent_review() {
    let (mut store, plan, candidate) = candidate_fixture();
    begin_validation(&mut store, &candidate);
    store
        .record_candidate_check(
            "workflow-1",
            &candidate.hash,
            &candidate_check(&candidate, CheckStatus::Passed),
        )
        .unwrap();
    store
        .charge_candidate_usage(
            "workflow-1",
            &candidate.hash,
            plan.budgets.timeout_seconds - 10,
            0,
        )
        .unwrap();
    finish_validation(&mut store, &candidate);
    assert_eq!(
        store.get_run("workflow-1").unwrap().unwrap().state,
        RunState::Paused
    );
    let evidence = store.current_candidate("workflow-1").unwrap().unwrap();
    assert_eq!(evidence.status, CandidateStatus::Paused);
    assert!(evidence.review.is_none());
    assert!(store
        .can_candidate_repair("workflow-1", &candidate.hash)
        .is_err());
}

#[test]
fn exhausted_repairs_pause_failed_candidates_and_refresh_an_existing_pause_reason() {
    for status in [CheckStatus::Failed, CheckStatus::Blocked] {
        let (mut store, plan, candidate) = candidate_fixture();
        begin_validation(&mut store, &candidate);
        store
            .record_candidate_check(
                "workflow-1",
                &candidate.hash,
                &candidate_check(&candidate, status),
            )
            .unwrap();
        finish_validation(&mut store, &candidate);
        store
            .charge_candidate_usage(
                "workflow-1",
                &candidate.hash,
                plan.budgets.timeout_seconds,
                0,
            )
            .unwrap();
        assert!(store
            .can_candidate_repair("workflow-1", &candidate.hash)
            .is_err());
        let run = store.get_run("workflow-1").unwrap().unwrap();
        store
            .fail_candidate_stage(
                &run.id,
                run.revision,
                &candidate.hash,
                RunState::Paused,
                "automatic repairs stopped: time budget exhausted; re-plan required",
            )
            .unwrap();
        let paused = store.get_run(&run.id).unwrap().unwrap();
        assert_eq!(paused.state, RunState::Paused);
        assert_eq!(paused.revision, run.revision + 1);
        store
            .fail_candidate_stage(
                &paused.id,
                paused.revision,
                &candidate.hash,
                RunState::Paused,
                "automatic repairs stopped: the approved repair limit was reached",
            )
            .unwrap();
        let updated = store.get_run(&run.id).unwrap().unwrap();
        assert_eq!(updated.revision, paused.revision + 1);
        let evidence = store.current_candidate(&run.id).unwrap().unwrap();
        assert_eq!(evidence.status, CandidateStatus::Paused);
        assert!(evidence.reason.unwrap().contains("repair limit"));
        let last = store.events_after(&run.id, 0).unwrap().pop().unwrap();
        assert_eq!(last.event_type, "candidate.stage_failed");
        assert_eq!(last.payload["state"], "paused");
        assert!(last.payload["reason"]
            .as_str()
            .unwrap()
            .contains("repair limit"));
        assert!(store
            .transition_run(
                &run.id,
                updated.revision,
                RunState::Reviewed,
                "forged",
                serde_json::json!({})
            )
            .is_err());
    }
}

#[test]
fn a_failed_review_with_passed_checks_gets_a_fresh_generation_not_a_new_revision() {
    let (mut store, plan, candidate) = candidate_fixture_at(":memory:", 1);
    begin_validation(&mut store, &candidate);
    store
        .record_candidate_check(
            "workflow-1",
            &candidate.hash,
            &candidate_check(&candidate, CheckStatus::Passed),
        )
        .unwrap();
    finish_validation(&mut store, &candidate);
    let reviewing = store.get_run("workflow-1").unwrap().unwrap();
    assert_eq!(reviewing.state, RunState::Reviewing);
    // Re-validation is not a way to abandon an active review.
    assert!(store
        .can_candidate_revalidate("workflow-1", &candidate.hash)
        .is_err());
    store
        .fail_candidate_stage(
            &reviewing.id,
            reviewing.revision,
            &candidate.hash,
            RunState::Failed,
            "invalid structured reviewer response: expected value",
        )
        .unwrap();
    let failed = store.get_run("workflow-1").unwrap().unwrap();
    assert_eq!(failed.state, RunState::Failed);
    let usage_before = store.workflow_usage("workflow-1").unwrap();
    // The single writer attempt is spent, so repair is closed; the fresh
    // generation is the only recovery and it costs no attempt.
    assert!(store
        .can_candidate_repair("workflow-1", &candidate.hash)
        .is_err());
    store
        .can_candidate_revalidate("workflow-1", &candidate.hash)
        .unwrap();
    assert!(store
        .can_candidate_revalidate("workflow-1", &format!("sha256:{}", "0".repeat(64)))
        .is_err());
    let resumed = store
        .begin_candidate_validation(&failed.id, failed.revision, &candidate.hash)
        .unwrap();
    assert_eq!(resumed.validation_generation, 2);
    assert_eq!(resumed.candidate.revision, 1);
    assert_eq!(resumed.candidate.hash, candidate.hash);
    assert_eq!(resumed.status, CandidateStatus::Validating);
    assert!(resumed.results.is_empty() && resumed.review.is_none());
    assert!(resumed.reason.is_none());
    let run = store.get_run("workflow-1").unwrap().unwrap();
    assert_eq!(run.state, RunState::Validating);
    assert_eq!(run.revision, failed.revision + 1);
    let started = store.events_after(&run.id, 0).unwrap().pop().unwrap();
    assert_eq!(started.event_type, "candidate.validation_started");
    assert_eq!(started.payload["generation"], 2);
    assert_eq!(started.payload["revalidation"], true);
    let usage = store.workflow_usage("workflow-1").unwrap();
    assert_eq!(usage.attempts, usage_before.attempts);
    assert!(usage.elapsed_seconds >= usage_before.elapsed_seconds);
    assert_eq!(usage.cost_usd_micros, usage_before.cost_usd_micros);
    // Generation 1's passed check does not carry over: the gate needs fresh evidence.
    let run = store.get_run("workflow-1").unwrap().unwrap();
    let premature = store.finish_candidate_validation(&run.id, run.revision, &candidate.hash);
    assert!(premature.is_ok());
    let starved = store.current_candidate("workflow-1").unwrap().unwrap();
    assert_eq!(starved.status, CandidateStatus::Failed);
    assert!(starved
        .reason
        .unwrap()
        .contains("lacks required command evidence"));
    assert!(store
        .can_candidate_revalidate("workflow-1", &candidate.hash)
        .is_err());
    let _ = plan;
}

#[test]
fn only_an_unreviewed_candidate_with_passed_checks_can_be_revalidated_in_place() {
    // A failed required check needs repair, never a fresh generation.
    let (mut store, _, candidate) = candidate_fixture();
    begin_validation(&mut store, &candidate);
    store
        .record_candidate_check(
            "workflow-1",
            &candidate.hash,
            &candidate_check(&candidate, CheckStatus::Failed),
        )
        .unwrap();
    finish_validation(&mut store, &candidate);
    assert_eq!(
        store.get_run("workflow-1").unwrap().unwrap().state,
        RunState::Failed
    );
    let error = store
        .can_candidate_revalidate("workflow-1", &candidate.hash)
        .unwrap_err();
    assert!(error.to_string().contains("repair"), "{error}");
    let failed = store.get_run("workflow-1").unwrap().unwrap();
    assert!(store
        .begin_candidate_validation(&failed.id, failed.revision, &candidate.hash)
        .is_err());
    assert!(store
        .can_candidate_repair("workflow-1", &candidate.hash)
        .is_ok());

    // A recorded verdict, even a failing one, is review evidence; the paused
    // candidate repairs or re-plans.
    let (mut store, _, candidate) = candidate_fixture();
    begin_validation(&mut store, &candidate);
    store
        .record_candidate_check(
            "workflow-1",
            &candidate.hash,
            &candidate_check(&candidate, CheckStatus::Passed),
        )
        .unwrap();
    finish_validation(&mut store, &candidate);
    let run = store.get_run("workflow-1").unwrap().unwrap();
    let mut verdict = review(&candidate);
    verdict.verdict = ReviewVerdict::ChangesRequired;
    verdict.findings = vec![Finding {
        severity: Severity::Blocking,
        path: "src/main.rs".into(),
        line: 1,
        explanation: "seeded".into(),
        evidence: vec!["seen".into()],
    }];
    store
        .finish_candidate_review(&run.id, run.revision, &candidate.hash, &verdict)
        .unwrap();
    let paused = store.get_run("workflow-1").unwrap().unwrap();
    assert_eq!(paused.state, RunState::Paused);
    assert!(store
        .can_candidate_revalidate("workflow-1", &candidate.hash)
        .is_err());
    assert!(store
        .begin_candidate_validation(&paused.id, paused.revision, &candidate.hash)
        .is_err());

    // Reserved unreported reviewer spend closes the gate: no new budget.
    let (mut store, plan, candidate) = candidate_fixture();
    begin_validation(&mut store, &candidate);
    store
        .record_candidate_check(
            "workflow-1",
            &candidate.hash,
            &candidate_check(&candidate, CheckStatus::Passed),
        )
        .unwrap();
    finish_validation(&mut store, &candidate);
    let run = store.get_run("workflow-1").unwrap().unwrap();
    store
        .fail_candidate_stage(
            &run.id,
            run.revision,
            &candidate.hash,
            RunState::Failed,
            "reviewer stopped before reporting its final usage, so the remaining approved cost budget is reserved",
        )
        .unwrap();
    let usage = store.workflow_usage("workflow-1").unwrap();
    store
        .charge_candidate_usage(
            "workflow-1",
            &candidate.hash,
            0,
            plan.budgets.cost_usd_micros - usage.cost_usd_micros - 1,
        )
        .unwrap();
    store
        .can_candidate_revalidate("workflow-1", &candidate.hash)
        .unwrap();
    store
        .charge_candidate_usage("workflow-1", &candidate.hash, 0, 1)
        .unwrap();
    let error = store
        .can_candidate_revalidate("workflow-1", &candidate.hash)
        .unwrap_err();
    assert!(error.to_string().contains("budget"), "{error}");
    let failed = store.get_run("workflow-1").unwrap().unwrap();
    assert_eq!(failed.state, RunState::Failed);
    assert!(store
        .begin_candidate_validation(&failed.id, failed.revision, &candidate.hash)
        .is_err());

    // A ticket revised after the review failed invalidates the plan binding:
    // the predicate and the gate agree, and the client is not offered a
    // control the runtime would refuse.
    let (mut store, _, candidate) = candidate_fixture();
    begin_validation(&mut store, &candidate);
    store
        .record_candidate_check(
            "workflow-1",
            &candidate.hash,
            &candidate_check(&candidate, CheckStatus::Passed),
        )
        .unwrap();
    finish_validation(&mut store, &candidate);
    let run = store.get_run("workflow-1").unwrap().unwrap();
    store
        .fail_candidate_stage(
            &run.id,
            run.revision,
            &candidate.hash,
            RunState::Failed,
            "invalid structured reviewer response: trailing characters",
        )
        .unwrap();
    store
        .can_candidate_revalidate("workflow-1", &candidate.hash)
        .unwrap();
    store
        .update_ticket(
            "ticket-1",
            1,
            "revised",
            "New intent",
            &["new criterion".into()],
        )
        .unwrap();
    assert!(store
        .can_candidate_revalidate("workflow-1", &candidate.hash)
        .is_err());
    let failed = store.get_run("workflow-1").unwrap().unwrap();
    assert!(store
        .begin_candidate_validation(&failed.id, failed.revision, &candidate.hash)
        .is_err());
    assert_eq!(
        store.get_run("workflow-1").unwrap().unwrap().state,
        RunState::Failed
    );
}
