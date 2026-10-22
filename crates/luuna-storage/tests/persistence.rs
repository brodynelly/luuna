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
    assert!(error.to_string().contains("baseline evidence required"));
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

fn registered_store(path: &std::path::Path) -> Store {
    let mut store = Store::open(path).unwrap();
    let observation = luuna_domain::RepositoryObservation {
        local_path: "/srv/checkouts/app".into(),
        identity: luuna_domain::RepositoryIdentity {
            remote: Some("https://example.invalid/app.git".into()),
            push_remote: None,
            root_commits: vec!["1".repeat(40)],
            shallow: false,
        },
        head_commit: "2".repeat(40),
        branch: Some("main".into()),
        remote_default_branch: None,
        local_branches: vec!["main".into()],
        dirty: luuna_domain::DirtyState::default(),
        git_version: "git version 2.43.0".into(),
        observed_at: "2026-10-17T00:00:00.000Z".into(),
    };
    store
        .register_project("project", "Project", &[("app".into(), observation)])
        .unwrap();
    store
}

fn run_in(store: &mut Store, id: &str, states: &[RunState]) {
    let mut run = store.create_run(id, "project", json!({})).unwrap();
    for state in states {
        run = store
            .transition_run(&run.id, run.revision, *state, "run.moved", json!({}))
            .unwrap();
    }
}

fn raw(path: &std::path::Path) -> rusqlite::Connection {
    rusqlite::Connection::open(path).unwrap()
}

fn column(path: &std::path::Path, sql: &str, id: &str) -> String {
    raw(path).query_row(sql, [id], |r| r.get(0)).unwrap()
}

fn lease_json(run_id: &str, id: &str) -> String {
    serde_json::to_string(&luuna_domain::WorktreeLease {
        id: id.into(),
        run_id: run_id.into(),
        project_id: "project".into(),
        repository_id: "app".into(),
        path: format!("/private/worktrees/{id}"),
        base_commit: "2".repeat(40),
        state: luuna_domain::LeaseState::Active,
        candidate_commit: None,
        created_at: "2026-10-17T00:00:00.000Z".into(),
        released_at: None,
        reason: None,
    })
    .unwrap()
}

#[test]
fn one_undecodable_record_does_not_block_startup_recovery() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.sqlite3");
    let mut store = registered_store(&path);
    run_in(
        &mut store,
        "settled",
        &[RunState::Running, RunState::Completed],
    );
    run_in(&mut store, "damaged-active", &[RunState::Running]);
    run_in(&mut store, "active", &[RunState::Running]);
    run_in(&mut store, "unknown", &[]);
    drop(store);
    // Damage that would otherwise abort recovery: metadata, a state no build
    // knows, and lease, attempt, baseline and candidate payloads.
    raw(&path)
        .execute_batch(
            "UPDATE runs SET metadata='{truncated' WHERE id IN ('settled','damaged-active');
             UPDATE runs SET state='\"vanished\"' WHERE id='unknown';
             INSERT INTO worktree_leases(id,run_id,project_id,repository_id,path,base_commit,state,payload,created_at)
               VALUES ('lease-x','damaged-active','project','app','/private/wt/x','2222222222222222222222222222222222222222','active','{secret prompt','2026-10-17');
             INSERT INTO attempts(id,run_id,task_id,number,state,payload,started_at)
               VALUES ('attempt-x','active','implement',1,'running','not json','2026-10-17');
             INSERT INTO baselines(id,project_id,repository_id,run_id,status,payload,started_at)
               VALUES ('baseline-x','project','app','active','running','{}','2026-10-17');
             INSERT INTO candidates(hash,run_id,id,revision,status,payload,created_at)
               VALUES ('sha256:candidate-x','active','candidate-x',1,'validating','{\"broken\":true}','2026-10-17');",
        )
        .unwrap();
    let mut store = Store::open(&path).unwrap();
    let report = store.recover_after_restart().unwrap();
    assert_eq!(report.interrupted_runs, 2);
    let skipped: Vec<_> = report
        .skipped
        .iter()
        .map(|s| (s.table, s.id.as_str()))
        .collect();
    assert_eq!(
        skipped,
        vec![
            ("runs", "unknown"),
            ("baselines", "baseline-x"),
            ("candidates", "sha256:candidate-x"),
            ("worktree_leases", "lease-x"),
            ("attempts", "attempt-x"),
        ]
    );
    // Reasons name the problem, never the stored content.
    assert!(report
        .skipped
        .iter()
        .all(|s| s.reason.contains("could not be decoded")
            && !s.reason.contains("secret")
            && !s.reason.contains("vanished")));
    let state = "SELECT state FROM runs WHERE id=?1";
    assert_eq!(column(&path, state, "damaged-active"), "\"interrupted\"");
    assert_eq!(
        store.get_run("active").unwrap().unwrap().state,
        RunState::Interrupted
    );
    assert_eq!(column(&path, state, "settled"), "\"completed\"");
    assert_eq!(column(&path, state, "unknown"), "\"vanished\"");
    // Undecodable records still settle where a state column exists.
    assert_eq!(
        column(
            &path,
            "SELECT state FROM worktree_leases WHERE id=?1",
            "lease-x"
        ),
        "abandoned"
    );
    assert!(store.active_worktree_leases().unwrap().is_empty());
    assert_eq!(
        column(&path, "SELECT state FROM attempts WHERE id=?1", "attempt-x"),
        "interrupted"
    );
    assert_eq!(
        column(
            &path,
            "SELECT status FROM baselines WHERE id=?1",
            "baseline-x"
        ),
        "interrupted"
    );
    assert_eq!(
        column(
            &path,
            "SELECT status FROM candidates WHERE hash=?1",
            "sha256:candidate-x"
        ),
        "interrupted"
    );
    let events: Vec<_> = store
        .events_after("active", 0)
        .unwrap()
        .into_iter()
        .map(|e| e.event_type)
        .collect();
    assert!(events.contains(&"attempt.finished".to_owned()));
    assert!(events.contains(&"candidate.interrupted".to_owned()));
    // A second restart has nothing left to settle; the unknown run stays reported.
    let again = store.recover_after_restart().unwrap();
    assert_eq!(again.interrupted_runs, 0);
    assert_eq!(again.skipped.len(), 1);
    assert_eq!(again.skipped[0].id, "unknown");
}

#[test]
fn restart_frees_a_lease_its_settled_run_never_released() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.sqlite3");
    let mut store = registered_store(&path);
    // The writer's terminal transition committed but its lease release and
    // attempt settlement failed (separate writes), leaving both open.
    run_in(&mut store, "writer", &[RunState::Running, RunState::Failed]);
    drop(store);
    let connection = raw(&path);
    connection
        .execute(
            "INSERT INTO worktree_leases(id,run_id,project_id,repository_id,path,base_commit,state,payload,created_at)
             VALUES ('lease-1','writer','project','app','/private/worktrees/lease-1',?1,'active',?2,'2026-10-17')",
            rusqlite::params!["2".repeat(40), lease_json("writer", "lease-1")],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO attempts(id,run_id,task_id,number,state,payload,started_at)
             VALUES ('attempt-1','writer','implement',1,'running','{}','2026-10-17')",
            [],
        )
        .unwrap();
    drop(connection);
    let mut store = Store::open(&path).unwrap();
    assert_eq!(store.interrupt_active_runs().unwrap(), 0);
    assert!(store.active_worktree_leases().unwrap().is_empty());
    let lease = store.worktree_leases("writer").unwrap().remove(0);
    assert_eq!(lease.state, luuna_domain::LeaseState::Abandoned);
    // Recovery does not read the worktree, so it says a commit may be there.
    let reason = lease.reason.unwrap();
    assert!(reason.contains("files preserved"), "{reason}");
    assert!(
        reason.contains("may exist in the worktree unrecorded"),
        "{reason}"
    );
    assert!(reason.contains("never a candidate"), "{reason}");
    assert_eq!(
        store.attempts("writer").unwrap()[0].state,
        luuna_domain::AttemptState::Interrupted
    );
    assert_eq!(
        store.get_run("writer").unwrap().unwrap().state,
        RunState::Failed
    );
    // The repository's single active-lease slot is free for the next writer.
    raw(&path)
        .execute(
            "INSERT INTO worktree_leases(id,run_id,project_id,repository_id,path,base_commit,state,payload,created_at)
             VALUES ('lease-2','writer','project','app','/private/worktrees/lease-2',?1,'active',?2,'2026-10-17')",
            rusqlite::params!["2".repeat(40), lease_json("writer", "lease-2")],
        )
        .unwrap();
}

#[test]
fn latest_baseline_follows_recording_order_not_the_wall_clock() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.sqlite3");
    let mut store = registered_store(&path);
    let identity = luuna_domain::BaselineIdentity {
        manifest_hash: format!("sha256:{}", "a".repeat(64)),
        repository_id: "app".into(),
        commit: "2".repeat(40),
        tree: "3".repeat(40),
    };
    // The second baseline started after the clock was stepped back an hour.
    for (id, started_at, status) in [
        (
            "passed-first",
            "2026-10-17T12:00:00.000Z",
            luuna_domain::BaselineStatus::Passed,
        ),
        (
            "failed-later",
            "2026-10-17T11:00:00.000Z",
            luuna_domain::BaselineStatus::Failed,
        ),
    ] {
        run_in(&mut store, &format!("{id}-run"), &[]);
        store
            .start_baseline(&luuna_domain::BaselineEvidence {
                id: id.into(),
                run_id: format!("{id}-run"),
                project_id: "project".into(),
                manifest_revision: 1,
                identity: identity.clone(),
                environment_fingerprint: format!("sha256:{}", "1".repeat(64)),
                status: luuna_domain::BaselineStatus::Running,
                required_checks: vec!["unit".into()],
                results: vec![],
                started_at: started_at.into(),
                finished_at: None,
                reason: None,
            })
            .unwrap();
        store.finish_baseline(id, status, None).unwrap();
    }
    let latest = store.latest_baseline("project", "app").unwrap().unwrap();
    assert_eq!(latest.id, "failed-later");
    assert_eq!(latest.status, luuna_domain::BaselineStatus::Failed);
    let listed: Vec<_> = store
        .baselines("project")
        .unwrap()
        .into_iter()
        .map(|b| b.id)
        .collect();
    assert_eq!(listed, vec!["failed-later", "passed-first"]);
}

#[test]
fn a_candidate_that_is_not_json_keeps_its_status_and_is_reported() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.sqlite3");
    let mut store = registered_store(&path);
    run_in(&mut store, "active", &[RunState::Running]);
    drop(store);
    raw(&path)
        .execute_batch(
            "INSERT INTO candidates(hash,run_id,id,revision,status,payload,created_at)
               VALUES ('sha256:candidate-y','active','candidate-y',1,'reviewing','not json','2026-10-17');",
        )
        .unwrap();
    let mut store = Store::open(&path).unwrap();
    let report = store.recover_after_restart().unwrap();
    assert_eq!(report.interrupted_runs, 1);
    let skipped: Vec<_> = report
        .skipped
        .iter()
        .map(|s| (s.table, s.id.as_str()))
        .collect();
    assert_eq!(skipped, vec![("candidates", "sha256:candidate-y")]);
    // The identity trigger cannot read the payload, so only the refusal is
    // tolerated; the gates decode the record and fail closed on it.
    assert_eq!(
        column(
            &path,
            "SELECT status FROM candidates WHERE hash=?1",
            "sha256:candidate-y"
        ),
        "reviewing"
    );
    assert!(!store
        .events_after("active", 0)
        .unwrap()
        .iter()
        .any(|e| e.event_type == "candidate.interrupted"));
}

#[test]
fn orphan_evidence_survives_damaged_metadata_and_an_unrelated_bad_event() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.sqlite3");
    let mut store = Store::open(&path).unwrap();
    store.create_run("orphan", "p", json!({})).unwrap();
    store
        .append_event(
            "orphan",
            "check.spawned",
            json!({"recipe_id":"unit","process_group":{}}),
        )
        .unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute(
        "UPDATE runs SET metadata='invalid-json' WHERE id='orphan'",
        [],
    )
    .unwrap();
    db.execute(
        "UPDATE events SET envelope='invalid-json' WHERE run_id='orphan' AND sequence=1",
        [],
    )
    .unwrap();
    let events = store.recovery_check_events().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].0, "orphan");
    assert_eq!(store.interrupt_active_runs().unwrap(), 1);
}
