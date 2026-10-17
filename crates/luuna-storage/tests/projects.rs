//! Project registry: identity/revision guards, immutability and replay.
use luuna_domain::{
    DirtyState, ExecutionProfile, ManifestCheck, ProjectManifest, ProjectPolicy,
    RepositoryIdentity, RepositoryManifest, RepositoryObservation,
};
use luuna_storage::{StorageError, Store};
use std::collections::BTreeMap;

fn observation(remote: Option<&str>) -> RepositoryObservation {
    RepositoryObservation {
        local_path: "/srv/checkouts/app".into(),
        identity: RepositoryIdentity {
            remote: remote.map(Into::into),
            root_commits: vec!["1".repeat(40)],
            shallow: false,
        },
        head_commit: "2".repeat(40),
        branch: Some("main".into()),
        remote_default_branch: None,
        local_branches: vec!["main".into(), "feature".into()],
        dirty: DirtyState {
            unstaged: 1,
            paths: vec!["README.md".into()],
            ..DirtyState::default()
        },
        git_version: "git version 2.43.0".into(),
        observed_at: "2026-10-17T00:00:00.000Z".into(),
    }
}
const REMOTE: &str = "https://example.invalid/app.git";

fn manifest(revision: u64) -> ProjectManifest {
    ProjectManifest {
        schema_version: "0.1".into(),
        id: "fixture".into(),
        name: "Fixture".into(),
        revision,
        repositories: vec![RepositoryManifest {
            id: "app".into(),
            remote: REMOTE.into(),
            default_branch: "main".into(),
            profiles: vec!["rust".into()],
            execution: ExecutionProfile::Native,
            checks: vec![ManifestCheck {
                id: "cargo-test".into(),
                executable: "cargo".into(),
                args: vec!["test".into(), "--locked".into()],
                required: true,
                timeout_seconds: 600,
                capabilities: vec!["rust".into()],
                cwd: ".".into(),
            }],
        }],
        relationships: vec![],
        policy: ProjectPolicy::v1(1, 1, 2),
    }
}
fn fresh() -> BTreeMap<String, RepositoryObservation> {
    BTreeMap::from([("app".to_owned(), observation(Some(REMOTE)))])
}

#[test]
fn registration_confirmation_and_replay_survive_reopening() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.sqlite3");
    let hash;
    {
        let mut store = Store::open(&path).unwrap();
        let project = store
            .register_project(
                "fixture",
                "Fixture",
                &[("app".into(), observation(Some(REMOTE)))],
            )
            .unwrap();
        assert_eq!(project.revision, 0);
        assert!(project.manifest_hash.is_none());
        assert!(matches!(
            store.register_project(
                "fixture",
                "Again",
                &[("app".into(), observation(Some(REMOTE)))]
            ),
            Err(StorageError::AlreadyExists(_))
        ));
        let registrations = store.repositories("fixture").unwrap();
        assert_eq!(registrations.len(), 1);
        assert_eq!(registrations[0].local_path, "/srv/checkouts/app");
        let confirmed = store
            .confirm_manifest("fixture", 0, &manifest(1), &fresh())
            .unwrap();
        assert_eq!(confirmed.revision, 1);
        hash = confirmed.manifest_hash.clone().unwrap();
        assert_eq!(hash, manifest(1).computed_hash().unwrap());
        let record = store.current_manifest("fixture").unwrap().unwrap();
        assert_eq!(record.base_commits["app"], "2".repeat(40));
        assert_eq!(record.manifest, manifest(1));
    }
    let store = Store::open(&path).unwrap();
    let project = store.get_project("fixture").unwrap().unwrap();
    assert_eq!(project.manifest_hash.as_deref(), Some(hash.as_str()));
    let events = store.project_events_after("fixture", 0).unwrap();
    assert_eq!(
        events
            .iter()
            .map(|e| e.event_type.as_str())
            .collect::<Vec<_>>(),
        vec![
            "project.registered",
            "repository.registered",
            "manifest.confirmed"
        ]
    );
    assert!(events
        .iter()
        .all(|e| e.run_id == "project:fixture" && e.project_id == "fixture"));
    assert_eq!(
        events.iter().map(|e| e.sequence).collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    // Replay reconstructs the confirmed map from the durable stream alone.
    let replayed: ProjectManifest =
        serde_json::from_value(events.last().unwrap().payload["manifest"].clone()).unwrap();
    assert_eq!(replayed, manifest(1));
    assert_eq!(events.last().unwrap().payload["manifest_hash"], hash);
    assert_eq!(
        events.last().unwrap().payload["dirty"]["app"]["clean"],
        false
    );
    assert_eq!(store.project_events_after("fixture", 2).unwrap().len(), 1);
    assert!(matches!(
        store.project_events_after("missing", 0),
        Err(StorageError::NotFound(_))
    ));
}

#[test]
fn stale_revision_identity_remote_and_branch_mismatches_fail_closed() {
    let mut store = Store::open(":memory:").unwrap();
    store
        .register_project(
            "fixture",
            "Fixture",
            &[("app".into(), observation(Some(REMOTE)))],
        )
        .unwrap();
    assert!(matches!(
        store.confirm_manifest("fixture", 1, &manifest(2), &fresh()),
        Err(StorageError::RevisionConflict {
            expected: 1,
            actual: 0
        })
    ));
    assert!(matches!(
        store.confirm_manifest("fixture", 0, &manifest(2), &fresh()),
        Err(StorageError::RevisionConflict {
            expected: 1,
            actual: 2
        })
    ));
    let mut other_repo = fresh();
    other_repo.get_mut("app").unwrap().identity.root_commits = vec!["9".repeat(40)];
    assert!(matches!(
        store.confirm_manifest("fixture", 0, &manifest(1), &other_repo),
        Err(StorageError::Domain(
            luuna_domain::DomainError::IdentityMismatch(_)
        ))
    ));
    let mut wrong_remote = manifest(1);
    wrong_remote.repositories[0].remote = "https://example.invalid/other.git".into();
    assert!(matches!(
        store.confirm_manifest("fixture", 0, &wrong_remote, &fresh()),
        Err(StorageError::Invalid(_))
    ));
    let mut wrong_branch = manifest(1);
    wrong_branch.repositories[0].default_branch = "release".into();
    assert!(matches!(
        store.confirm_manifest("fixture", 0, &wrong_branch, &fresh()),
        Err(StorageError::Invalid(_))
    ));
    let mut unknown_repo = manifest(1);
    unknown_repo.repositories[0].id = "api".into();
    assert!(matches!(
        store.confirm_manifest("fixture", 0, &unknown_repo, &fresh()),
        Err(StorageError::Invalid(_))
    ));
    let mut wrong_project = manifest(1);
    wrong_project.id = "other".into();
    assert!(store
        .confirm_manifest("fixture", 0, &wrong_project, &fresh())
        .is_err());
    assert!(store
        .confirm_manifest("fixture", 0, &manifest(1), &BTreeMap::new())
        .is_err());
    assert_eq!(store.get_project("fixture").unwrap().unwrap().revision, 0);
    assert_eq!(store.project_events_after("fixture", 0).unwrap().len(), 2);
    store
        .confirm_manifest("fixture", 0, &manifest(1), &fresh())
        .unwrap();
    let mut renamed = manifest(2);
    renamed.name = "Fixture renamed".into();
    store
        .confirm_manifest("fixture", 1, &renamed, &fresh())
        .unwrap();
    assert_eq!(
        store.get_project("fixture").unwrap().unwrap().name,
        "Fixture renamed"
    );
    assert_eq!(
        store.get_manifest("fixture", 1).unwrap().unwrap().revision,
        1
    );
    assert_eq!(
        store.current_manifest("fixture").unwrap().unwrap().revision,
        2
    );
}

#[test]
fn local_only_repositories_use_an_explicit_identity_and_registration_validates_input() {
    let mut store = Store::open(":memory:").unwrap();
    assert!(store
        .register_project("Fixture", "x", &[("app".into(), observation(None))])
        .is_err());
    assert!(store
        .register_project("fixture", "", &[("app".into(), observation(None))])
        .is_err());
    assert!(store.register_project("fixture", "x", &[]).is_err());
    store
        .register_project("fixture", "Fixture", &[("app".into(), observation(None))])
        .unwrap();
    let fresh_local = BTreeMap::from([("app".to_owned(), observation(None))]);
    // Without an origin, an arbitrary URL would record a false identity.
    assert!(matches!(
        store.confirm_manifest("fixture", 0, &manifest(1), &fresh_local),
        Err(StorageError::Invalid(_))
    ));
    let mut local = manifest(1);
    local.repositories[0].remote = "local:app".into();
    store
        .confirm_manifest("fixture", 0, &local, &fresh_local)
        .unwrap();
    // A remote appearing later changes identity; confirmation must re-register.
    assert!(matches!(
        store.confirm_manifest(
            "fixture",
            1,
            &{
                let mut m = local.clone();
                m.revision = 2;
                m
            },
            &fresh()
        ),
        Err(StorageError::Domain(
            luuna_domain::DomainError::IdentityMismatch(_)
        ))
    ));
}
