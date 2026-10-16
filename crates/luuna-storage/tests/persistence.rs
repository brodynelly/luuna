use luuna_domain::{Approval, PlanRevision, RunState};
use luuna_storage::{StorageError, Store};
use serde_json::json;

fn plan() -> PlanRevision {
    serde_json::from_str(include_str!("../../../fixtures/domain/plan.valid.json")).unwrap()
}
fn approval(plan: &PlanRevision) -> Approval {
    Approval {
        schema_version: "0.1".into(),
        id: "approval-1".into(),
        plan_id: plan.id.clone(),
        plan_revision: plan.revision,
        plan_hash: plan.hash.clone(),
        approved_by: "human".into(),
        approved_at: "2026-10-16T00:00:00Z".into(),
        permissions: plan.permissions.clone(),
    }
}
fn plan_ready(store: &mut Store) -> luuna_storage::RunRecord {
    let run = store
        .create_workflow_run("workflow", "project", json!({}))
        .unwrap();
    let run = store
        .transition_run(
            &run.id,
            run.revision,
            RunState::Exploring,
            "run.exploring",
            json!({}),
        )
        .unwrap();
    let current = store.get_plan("plan-1", 2).unwrap().unwrap_or_else(plan);
    store
        .bind_plan(&run.id, run.revision, &current.id, current.revision)
        .unwrap()
}

#[test]
fn durable_state_and_events_survive_restart_without_false_success() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.sqlite3");
    {
        let mut store = Store::open(&path).unwrap();
        let run = store
            .create_run("run-1", "project", json!({"prompt":"read only"}))
            .unwrap();
        store
            .transition_run(
                &run.id,
                run.revision,
                RunState::Running,
                "run.started",
                json!({}),
            )
            .unwrap();
        store
            .append_event(&run.id, "worker.output", json!({"text":"tests passed"}))
            .unwrap();
    }
    let mut store = Store::open(&path).unwrap();
    assert_eq!(store.interrupt_active_runs().unwrap(), 1);
    assert_eq!(
        store.get_run("run-1").unwrap().unwrap().state,
        RunState::Interrupted
    );
    let events = store.events_after("run-1", 0).unwrap();
    assert_eq!(
        events.iter().map(|e| e.sequence).collect::<Vec<_>>(),
        vec![1, 2, 3, 4]
    );
    assert_eq!(events.last().unwrap().event_type, "run.interrupted");
    assert_eq!(store.events_after("run-1", 3).unwrap().len(), 1);
    assert_eq!(store.interrupt_active_runs().unwrap(), 0);
}

#[test]
fn stale_state_and_failed_events_roll_back_the_entire_mutation() {
    let mut store = Store::open(":memory:").unwrap();
    let run = store.create_run("run", "project", json!({})).unwrap();
    assert!(store
        .transition_run("run", run.revision, RunState::Running, "", json!({}))
        .is_err());
    assert_eq!(
        store.get_run("run").unwrap().unwrap().state,
        RunState::Queued
    );
    assert_eq!(store.events_after("run", 0).unwrap().len(), 1);
    store
        .transition_run(
            "run",
            run.revision,
            RunState::Running,
            "run.started",
            json!({}),
        )
        .unwrap();
    assert!(matches!(
        store.transition_run(
            "run",
            run.revision,
            RunState::Completed,
            "run.completed",
            json!({})
        ),
        Err(StorageError::RevisionConflict { .. })
    ));
    assert_eq!(store.events_after("run", 0).unwrap().len(), 2);
}

#[test]
fn revisions_are_immutable_and_stale_approval_does_not_write() {
    let mut store = Store::open(":memory:").unwrap();
    let first = plan();
    store.save_plan(&first).unwrap();
    assert!(matches!(
        store.save_plan(&first),
        Err(StorageError::ImmutableRevision)
    ));
    let mut second = first.clone();
    second.revision += 1;
    let second = second.seal().unwrap();
    store.save_plan(&second).unwrap();
    let run = plan_ready(&mut store);
    let count = store.events_after(&run.id, 0).unwrap().len();
    assert!(store
        .approve_plan(&run.id, run.revision, &approval(&first))
        .is_err());
    assert_eq!(
        store.get_run(&run.id).unwrap().unwrap().state,
        RunState::PlanReady
    );
    assert_eq!(store.events_after(&run.id, 0).unwrap().len(), count);
    assert_eq!(
        store.get_plan(&first.id, first.revision).unwrap().unwrap(),
        first
    );
}

#[test]
fn writes_require_durable_exact_approval_and_new_revision_invalidates_it() {
    let mut store = Store::open(":memory:").unwrap();
    let first = plan();
    store.save_plan(&first).unwrap();
    let run = plan_ready(&mut store);
    assert!(store
        .transition_run(
            &run.id,
            run.revision,
            RunState::Implementing,
            "run.implementing",
            json!({})
        )
        .is_err());
    assert!(store
        .transition_run(
            &run.id,
            run.revision,
            RunState::Approved,
            "plan.approved",
            json!({})
        )
        .is_err());
    let run = store
        .approve_plan(&run.id, run.revision, &approval(&first))
        .unwrap();
    let mut second = first;
    second.revision += 1;
    let second = second.seal().unwrap();
    store.save_plan(&second).unwrap();
    assert!(store
        .transition_run(
            &run.id,
            run.revision,
            RunState::Implementing,
            "run.implementing",
            json!({})
        )
        .is_err());
    assert_eq!(
        store.get_run(&run.id).unwrap().unwrap().state,
        RunState::Approved
    );
}

#[test]
fn exact_approval_is_durable_but_feature_writes_remain_blocked_until_m2() {
    let mut store = Store::open(":memory:").unwrap();
    let plan = plan();
    store.save_plan(&plan).unwrap();
    let run = plan_ready(&mut store);
    let run = store
        .approve_plan(&run.id, run.revision, &approval(&plan))
        .unwrap();
    let error = store
        .transition_run(
            &run.id,
            run.revision,
            RunState::Implementing,
            "run.implementing",
            json!({}),
        )
        .unwrap_err();
    assert!(error.to_string().contains("baseline_not_implemented"));
    assert_eq!(
        store.get_run(&run.id).unwrap().unwrap().state,
        RunState::Approved
    );
    assert_eq!(
        store
            .events_after(&run.id, 0)
            .unwrap()
            .iter()
            .filter(|e| e.event_type == "plan.approved")
            .count(),
        1
    );
}

#[test]
fn unrelated_plan_and_forged_metadata_cannot_authorize_a_workflow() {
    let mut store = Store::open(":memory:").unwrap();
    let first = plan();
    store.save_plan(&first).unwrap();
    let run = plan_ready(&mut store);
    let mut other = first.clone();
    other.id = "unrelated".into();
    let other = other.seal().unwrap();
    store.save_plan(&other).unwrap();
    let mut wrong = approval(&other);
    wrong.id = "wrong-approval".into();
    assert!(store.approve_plan(&run.id, run.revision, &wrong).is_err());
    assert_eq!(
        store.get_run(&run.id).unwrap().unwrap().state,
        RunState::PlanReady
    );
    let forged = store
        .create_workflow_run(
            "forged",
            "another-project",
            json!({"plan_id":first.id,"plan_revision":1,"approval_id":"approval-1"}),
        )
        .unwrap();
    let forged = store
        .transition_run(
            &forged.id,
            forged.revision,
            RunState::Exploring,
            "run.exploring",
            json!({}),
        )
        .unwrap();
    assert!(store
        .bind_plan(&forged.id, forged.revision, &first.id, first.revision)
        .is_err());
    assert!(store
        .approve_plan(&forged.id, forged.revision, &approval(&first))
        .is_err());
}

#[cfg(unix)]
#[test]
fn newly_created_database_is_private() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("private/state.sqlite3");
    let _store = Store::open(&path).unwrap();
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(
        std::fs::metadata(path.parent().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
}

#[test]
fn concurrent_connections_serialize_events_without_duplicate_sequences() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("shared.sqlite3");
    let mut store = Store::open(&path).unwrap();
    store.create_run("run", "project", json!({})).unwrap();
    let workers: Vec<_> = (0..3)
        .map(|worker| {
            let path = path.clone();
            std::thread::spawn(move || {
                let mut store = Store::open(path).unwrap();
                for index in 0..8 {
                    store
                        .append_event(
                            "run",
                            "worker.output",
                            json!({"worker":worker,"index":index}),
                        )
                        .unwrap();
                }
            })
        })
        .collect();
    for worker in workers {
        worker.join().unwrap();
    }
    let events = store.events_after("run", 0).unwrap();
    assert_eq!(events.len(), 25);
    assert_eq!(
        events
            .iter()
            .map(|event| event.sequence)
            .collect::<Vec<_>>(),
        (1..=25).collect::<Vec<_>>()
    );
}
