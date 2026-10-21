//! The Missions CLI owns ticket intent. SQLite retains only a revision-aware
//! projection and a durable delivery reservation for uncertain external writes.
//! Imported stores are never read: this module uses the explicitly enabled
//! project's private component workspace exclusively.
use crate::{integrations, internal, projects::storage_error, ApiError, AppState};
use axum::http::StatusCode;
use luuna_domain::{Ticket, TicketSource};
use luuna_storage::MissionsBinding;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

fn conflict(message: &str) -> ApiError {
    ApiError(StatusCode::CONFLICT, message.into())
}
fn unavailable() -> ApiError {
    ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Missions is unavailable; restore the pinned component before retrying".into(),
    )
}
fn malformed() -> ApiError {
    ApiError(StatusCode::UNPROCESSABLE_ENTITY, "Missions ticket metadata is invalid; restore its Luuna intent envelope before reconciliation".into())
}

/// Stored as ordinary compatible Missions description text. Unknown imported
/// issues are never automatically interpreted or loaded into an agent context.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Intent {
    luuna_ticket_schema: u32,
    ticket_id: String,
    project_id: String,
    intent: String,
    acceptance_criteria: Vec<String>,
    repository_ids: Vec<String>,
}
impl Intent {
    fn from_ticket(ticket: &Ticket) -> Self {
        Self {
            luuna_ticket_schema: 1,
            ticket_id: ticket.id.clone(),
            project_id: ticket.project_id.clone(),
            intent: ticket.intent.clone(),
            acceptance_criteria: ticket.acceptance_criteria.clone(),
            repository_ids: ticket.repository_ids.clone(),
        }
    }
}

async fn call(state: &AppState, project: &str, args: &[String]) -> Result<Value, ApiError> {
    let workspace = integrations::workspace(state, project)?;
    state
        .components
        .as_ref()
        .ok_or_else(unavailable)?
        .call("missions", &workspace, args)
        .await
        .map_err(|_| unavailable())
}

async fn query_issues(
    state: &AppState,
    project: &str,
    mut args: Vec<String>,
) -> Result<Vec<Value>, ApiError> {
    // Search already includes closed records and has no --all option.
    if args.first().is_some_and(|command| command == "list") {
        args.push("--all".into());
    }
    args.extend(["--limit=10001".into(), "--sort=id".into()]);
    let data = call(state, project, &args).await?;
    let result = data["issues"].as_array().cloned().ok_or_else(malformed)?;
    if result.len() > 10_000 {
        return Err(conflict(
            "Missions store exceeds the bounded ticket reconciliation limit",
        ));
    }
    Ok(result)
}

#[cfg(test)]
async fn issues(state: &AppState, project: &str) -> Result<Vec<Value>, ApiError> {
    query_issues(state, project, vec!["list".into()]).await
}

async fn delivery_records(state: &AppState, ticket: &Ticket) -> Result<Vec<Value>, ApiError> {
    let mut records = query_issues(
        state,
        &ticket.project_id,
        vec!["list".into(), format!("--label={}", marker(ticket))],
    )
    .await?;
    // Search the description identity as well, so removing a label does not
    // duplicate a successful create whose SQLite acknowledgement was lost.
    for issue in query_issues(
        state,
        &ticket.project_id,
        vec!["search".into(), ticket.id.clone()],
    )
    .await?
    {
        if !records.iter().any(|existing| existing["id"] == issue["id"]) {
            records.push(issue);
        }
    }
    records.retain(|issue| matches_delivery(issue, ticket));
    Ok(records)
}

async fn source_snapshot(
    state: &AppState,
    project: &str,
    id: &str,
) -> Result<(Value, Vec<Value>), ApiError> {
    let data = call(state, project, &["show".into(), id.into()]).await?;
    let issue = data
        .get("issue")
        .filter(|issue| issue["id"] == id)
        .cloned()
        .ok_or_else(malformed)?;
    let dependencies = issue["blockedBy"].as_array().cloned().unwrap_or_default();
    if dependencies.len() > 64 {
        return Err(conflict(
            "Missions ticket exceeds the bounded dependency reconciliation limit",
        ));
    }
    let mut snapshots = Vec::with_capacity(dependencies.len());
    for dependency in dependencies {
        let id = dependency.as_str().ok_or_else(malformed)?;
        let data = call(state, project, &["show".into(), id.into()]).await?;
        snapshots.push(
            data.get("issue")
                .filter(|issue| issue["id"] == id)
                .cloned()
                .ok_or_else(malformed)?,
        );
    }
    Ok((issue, snapshots))
}

fn source_hash(issue: &Value, all: &[Value]) -> Result<String, ApiError> {
    let dependencies: Vec<Value> = issue["blockedBy"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|id| {
            all.iter()
                .find(|other| other["id"] == *id)
                .cloned()
                .unwrap_or_else(|| json!({"id":id,"missing":true}))
        })
        .collect();
    let bytes = serde_json::to_vec(&json!({"issue":issue,"dependencies":dependencies}))
        .map_err(internal)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn projection(ticket: &Ticket, issue: &Value) -> Result<Ticket, ApiError> {
    let description = issue["description"].as_str().ok_or_else(malformed)?;
    let intent: Intent = serde_json::from_str(description).map_err(|_| malformed())?;
    if intent.luuna_ticket_schema != 1
        || intent.ticket_id != ticket.id
        || intent.project_id != ticket.project_id
    {
        return Err(malformed());
    }
    let mut result = ticket.clone();
    result.source = TicketSource::Missions;
    result.title = issue["title"].as_str().ok_or_else(malformed)?.to_owned();
    result.intent = intent.intent;
    result.acceptance_criteria = intent.acceptance_criteria;
    result.repository_ids = intent.repository_ids;
    result.validate().map_err(|_| malformed())?;
    Ok(result)
}

fn marker(ticket: &Ticket) -> String {
    format!("luuna-ticket-{}", ticket.id)
}

fn matches_delivery(issue: &Value, ticket: &Ticket) -> bool {
    let marker = marker(ticket);
    if issue["labels"]
        .as_array()
        .is_some_and(|labels| labels.iter().any(|label| label == &marker))
    {
        return true;
    }
    // An external edit can remove a label after a successful uncertain write.
    // The compatible description envelope provides a second stable identity;
    // do not create a duplicate just because one marker was edited away.
    issue["description"]
        .as_str()
        .and_then(|text| serde_json::from_str::<Intent>(text).ok())
        .is_some_and(|intent| {
            intent.ticket_id == ticket.id && intent.project_id == ticket.project_id
        })
}

fn ready(issue: &Value, all: &[Value]) -> Result<(), ApiError> {
    if !matches!(issue["status"].as_str(), Some("open" | "in_progress")) {
        return Err(conflict("Missions ticket is closed or has an unsupported state; reopen it and reconcile before planning"));
    }
    for dependency in issue["blockedBy"].as_array().into_iter().flatten() {
        if !all
            .iter()
            .any(|other| other["id"] == *dependency && other["status"] == "closed")
        {
            return Err(conflict("Missions ticket has an unresolved dependency; resolve it and reconcile before planning"));
        }
    }
    Ok(())
}

async fn deliver(state: &AppState, ticket: &Ticket) -> Result<Ticket, ApiError> {
    let binding = state
        .store
        .lock()
        .map_err(internal)?
        .reserve_missions_delivery(&ticket.id)
        .map_err(storage_error)?;
    if binding.source_id.is_some() {
        return Ok(ticket.clone());
    }
    let expected = &binding.original;
    let tag = marker(expected);
    let mut found = delivery_records(state, expected).await?;
    if found.len() > 1 {
        return Err(conflict("Missions contains duplicate Luuna delivery markers; reconcile the duplicate source records before retrying"));
    }
    if found.is_empty() {
        if binding.delivery_started {
            return Err(conflict("Missions delivery was already attempted but its source identity is missing; restore the source marker before retrying"));
        }
        // The reservation survives an exit after this command succeeded. The
        // next delivery searches the marker before creating another issue.
        let description =
            serde_json::to_string(&Intent::from_ticket(expected)).map_err(internal)?;
        state
            .store
            .lock()
            .map_err(internal)?
            .begin_missions_delivery(&ticket.id)
            .map_err(storage_error)?;
        let created = call(
            state,
            &ticket.project_id,
            &[
                "create".into(),
                format!("--title={}", expected.title),
                format!("--description={description}"),
                format!("--labels={tag}"),
            ],
        )
        .await?;
        if created["id"].as_str().is_none() {
            return Err(malformed());
        }
        found = delivery_records(state, expected).await?;
    }
    if found.len() != 1 {
        return Err(conflict("Missions delivery outcome is uncertain; inspect the source and retry with the same idempotency key"));
    }
    let id = found[0]["id"].as_str().ok_or_else(malformed)?;
    let (issue, dependencies) = source_snapshot(state, &ticket.project_id, id).await?;
    let projected = projection(expected, &issue)?;
    if projected.title != expected.title
        || projected.intent != expected.intent
        || projected.acceptance_criteria != expected.acceptance_criteria
        || projected.repository_ids != expected.repository_ids
    {
        return Err(conflict("Missions delivery changed before acknowledgement; restore the reserved content before retrying"));
    }
    let hash = source_hash(&issue, &dependencies)?;
    state
        .store
        .lock()
        .map_err(internal)?
        .complete_missions_delivery(&ticket.id, ticket.revision, id, &hash)
        .map_err(storage_error)
}

/// Called while activation owns the component lock and the project is frozen in
/// `initializing`. Preserves identifiers and revisions of every legacy ticket.
pub(crate) async fn migrate_project(state: &AppState, project: &str) -> Result<(), ApiError> {
    let tickets = state
        .store
        .lock()
        .map_err(internal)?
        .tickets(project)
        .map_err(internal)?;
    for ticket in tickets {
        if ticket.source == TicketSource::LuunaSqliteTemporary {
            deliver(state, &ticket).await?;
        } else {
            check_source(state, &ticket).await?;
        }
    }
    Ok(())
}

/// The create handler holds the global component lock. A failed command leaves
/// a durable reservation and can only be retried with the original request key.
pub(crate) async fn create_projection(
    state: &AppState,
    ticket: &Ticket,
    key: &str,
) -> Result<(Ticket, bool), ApiError> {
    let (stored, created) = state
        .store
        .lock()
        .map_err(internal)?
        .create_ticket(ticket, key)
        .map_err(storage_error)?;
    if stored.source == TicketSource::Missions {
        check_source(state, &stored).await?;
        return Ok((stored, false));
    }
    Ok((deliver(state, &stored).await?, created))
}

async fn current(
    state: &AppState,
    ticket: &Ticket,
) -> Result<(MissionsBinding, Value, Vec<Value>, String), ApiError> {
    let binding = state
        .store
        .lock()
        .map_err(internal)?
        .missions_binding(&ticket.id)
        .map_err(internal)?
        .ok_or_else(|| {
            conflict(
                "Missions ticket binding is missing; finish component activation before continuing",
            )
        })?;
    let source_id = binding.source_id.as_deref().ok_or_else(|| {
        conflict("Missions ticket delivery is incomplete; retry the original operation")
    })?;
    let (issue, all) = source_snapshot(state, &ticket.project_id, source_id).await?;
    let hash = source_hash(&issue, &all)?;
    Ok((binding, issue, all, hash))
}

async fn check_source(state: &AppState, ticket: &Ticket) -> Result<(), ApiError> {
    if ticket.source != TicketSource::Missions {
        return Err(conflict(
            "project ticket migration is incomplete; resume component activation",
        ));
    }
    let (binding, issue, all, hash) = current(state, ticket).await?;
    if binding.source_revision.as_deref() != Some(hash.as_str()) {
        return Err(conflict("Missions ticket changed outside Luuna; reconcile the source and create a new plan before continuing"));
    }
    ready(&issue, &all)
}

/// Guard planning, exact approval, scheduling, repairs and review consumption.
/// Callers serialize API mutations using component_locks; external CLI changes
/// are independently re-observed immediately before the transactional gate.
pub(crate) async fn ensure_current(state: &AppState, ticket: &Ticket) -> Result<(), ApiError> {
    if !integrations::enabled(state, &ticket.project_id)? {
        return Ok(());
    }
    check_source(state, ticket).await
}

pub(crate) async fn source(state: &AppState, ticket: &Ticket) -> Result<Value, ApiError> {
    if !integrations::enabled(state, &ticket.project_id)? {
        return Ok(
            json!({"source":"luuna_sqlite_temporary","source_id":null,"source_revision":null,"reconciliation_required":false,"workspace":null}),
        );
    }
    let (binding, issue, all, hash) = current(state, ticket).await?;
    let workspace: PathBuf = integrations::workspace(state, &ticket.project_id)?;
    Ok(
        json!({"source":"missions","source_id":binding.source_id,"source_revision":hash,
        "reconciliation_required":binding.source_revision.as_deref()!=Some(hash.as_str()),
        "workspace":workspace,"status":issue["status"],"blocked":ready(&issue,&all).is_err()}),
    )
}

pub(crate) async fn reconcile(
    state: &AppState,
    ticket: &Ticket,
    expected_revision: u64,
) -> Result<Ticket, ApiError> {
    if !integrations::enabled(state, &ticket.project_id)? {
        return Err(conflict(
            "enable components before reconciling Missions tickets",
        ));
    }
    let (binding, issue, _, hash) = current(state, ticket).await?;
    let projected = projection(ticket, &issue)?;
    state
        .store
        .lock()
        .map_err(internal)?
        .reconcile_missions_ticket(
            &projected,
            expected_revision,
            binding.source_id.as_deref().ok_or_else(malformed)?,
            &hash,
        )
        .map_err(storage_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RuntimeConfig;
    use axum::extract::{Path, State};
    use luuna_domain::{DirtyState, RepositoryIdentity, RepositoryObservation, SCHEMA_VERSION};

    fn config(path: &std::path::Path) -> RuntimeConfig {
        RuntimeConfig {
            data_dir: path.join("private"),
            pi_program: "node".into(),
            git_program: "git".into(),
            pi_launcher_args: vec![],
            provider: None,
            model: None,
            token: "synthetic-missions-token-at-least-32-bytes".into(),
            max_run_seconds: 10,
        }
    }
    fn legacy() -> Ticket {
        Ticket {
            schema_version: SCHEMA_VERSION.into(),
            id: "ticket-legacy".into(),
            project_id: "missions-fixture".into(),
            revision: 1,
            source: TicketSource::LuunaSqliteTemporary,
            title: "Original title".into(),
            intent: "Implement the test feature".into(),
            acceptance_criteria: vec!["The isolated check passes".into()],
            repository_ids: vec!["app".into()],
            created_at: "2026-10-21T00:00:00.000Z".into(),
            updated_at: "2026-10-21T00:00:00.000Z".into(),
        }
    }
    fn new_state(config: RuntimeConfig) -> AppState {
        let components = luuna_components::Components::discover().expect(
            "This explicit integration test requires pinned Bun and all component submodules",
        );
        AppState::open(config).unwrap().with_components(components)
    }
    fn register(state: &AppState) {
        let observation = RepositoryObservation {
            local_path: state
                .config
                .data_dir
                .join("unused-developer-root")
                .to_string_lossy()
                .into_owned(),
            identity: RepositoryIdentity {
                remote: Some("https://example.invalid/test.git".into()),
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
            .register_project(
                "missions-fixture",
                "Fixture",
                &[("app".into(), observation)],
            )
            .unwrap();
    }

    #[tokio::test]
    #[ignore = "requires pinned Bun and real component checkouts; run with --ignored"]
    async fn missions_real_migration_external_edit_reconciliation_and_dependency_gate() {
        let directory = tempfile::tempdir().unwrap();
        let state = new_state(config(directory.path()));
        register(&state);
        let original = legacy();
        state
            .store
            .lock()
            .unwrap()
            .create_ticket(&original, "legacy-request")
            .unwrap();
        let _ = integrations::enable(State(state.clone()), Path(original.project_id.clone()))
            .await
            .unwrap();
        let migrated = state
            .store
            .lock()
            .unwrap()
            .get_ticket(&original.id)
            .unwrap()
            .unwrap();
        assert_eq!(migrated.source, TicketSource::Missions);
        assert_eq!(migrated.id, original.id);
        assert_eq!(migrated.revision, 1);
        assert_eq!(migrated.created_at, original.created_at);
        let (replayed, created) = create_projection(&state, &original, "legacy-request")
            .await
            .unwrap();
        assert!(!created);
        assert_eq!(replayed.id, migrated.id);
        assert_eq!(issues(&state, &original.project_id).await.unwrap().len(), 1);
        let status = source(&state, &migrated).await.unwrap();
        let source_id = status["source_id"].as_str().unwrap();
        call(
            &state,
            &original.project_id,
            &[
                "update".into(),
                source_id.into(),
                "--title=Edited through the external CLI".into(),
            ],
        )
        .await
        .unwrap();
        assert_eq!(
            source(&state, &migrated).await.unwrap()["reconciliation_required"],
            true
        );
        assert_eq!(
            ensure_current(&state, &migrated).await.unwrap_err().0,
            StatusCode::CONFLICT
        );
        let reconciled = reconcile(&state, &migrated, 1).await.unwrap();
        assert_eq!(reconciled.revision, 2);
        assert_eq!(reconciled.title, "Edited through the external CLI");
        assert_eq!(
            reconcile(&state, &reconciled, 1).await.unwrap_err().0,
            StatusCode::CONFLICT
        );
        ensure_current(&state, &reconciled).await.unwrap();
        let blocker = call(
            &state,
            &original.project_id,
            &["create".into(), "--title=External dependency".into()],
        )
        .await
        .unwrap();
        call(
            &state,
            &original.project_id,
            &[
                "block".into(),
                source_id.into(),
                "--by".into(),
                blocker["id"].as_str().unwrap().into(),
            ],
        )
        .await
        .unwrap();
        let blocked = reconcile(&state, &reconciled, 2).await.unwrap();
        assert_eq!(
            ensure_current(&state, &blocked).await.unwrap_err().0,
            StatusCode::CONFLICT
        );
        call(
            &state,
            &original.project_id,
            &[
                "update".into(),
                blocker["id"].as_str().unwrap().into(),
                "--status=closed".into(),
            ],
        )
        .await
        .unwrap();
        // A dependency revision is part of the source fingerprint too.
        assert_eq!(
            ensure_current(&state, &blocked).await.unwrap_err().0,
            StatusCode::CONFLICT
        );
        let ready = reconcile(&state, &blocked, 3).await.unwrap();
        ensure_current(&state, &ready).await.unwrap();
        assert!(!state.config.data_dir.join("unused-developer-root").exists());
    }

    #[tokio::test]
    #[ignore = "requires pinned Bun and real component checkouts; run with --ignored"]
    async fn missions_real_uncertain_create_reconciles_after_runtime_restart() {
        let directory = tempfile::tempdir().unwrap();
        let settings = config(directory.path());
        let state = new_state(settings.clone());
        register(&state);
        let original = legacy();
        state
            .store
            .lock()
            .unwrap()
            .create_ticket(&original, "retry-key")
            .unwrap();
        state
            .store
            .lock()
            .unwrap()
            .reserve_missions_delivery(&original.id)
            .unwrap();
        state
            .store
            .lock()
            .unwrap()
            .begin_missions_delivery(&original.id)
            .unwrap();
        state
            .store
            .lock()
            .unwrap()
            .begin_component_enable(&original.project_id)
            .unwrap();
        let workspace = integrations::workspace(&state, &original.project_id).unwrap();
        std::fs::create_dir_all(&workspace).unwrap();
        call(&state, &original.project_id, &["init".into()])
            .await
            .unwrap();
        let description = serde_json::to_string(&Intent::from_ticket(&original)).unwrap();
        let created = call(
            &state,
            &original.project_id,
            &[
                "create".into(),
                format!("--title={}", original.title),
                format!("--description={description}"),
                format!("--labels={}", marker(&original)),
            ],
        )
        .await
        .unwrap();
        // The second identity survives removal of the label by an external CLI.
        call(
            &state,
            &original.project_id,
            &[
                "update".into(),
                created["id"].as_str().unwrap().into(),
                "--set-labels=".into(),
            ],
        )
        .await
        .unwrap();
        // Simulate loss after successful CLI create but before SQLite acknowledgement.
        drop(state);
        let restarted = new_state(settings);
        let _ = integrations::enable(State(restarted.clone()), Path(original.project_id.clone()))
            .await
            .unwrap();
        assert_eq!(
            issues(&restarted, &original.project_id)
                .await
                .unwrap()
                .len(),
            1
        );
        let ticket = restarted
            .store
            .lock()
            .unwrap()
            .get_ticket(&original.id)
            .unwrap()
            .unwrap();
        assert_eq!(ticket.source, TicketSource::Missions);
        assert_eq!(ticket.revision, 1);
        ensure_current(&restarted, &ticket).await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires pinned Bun and real component checkouts; run with --ignored"]
    async fn missions_real_uncertain_missing_duplicate_and_unavailable_fail_closed() {
        let directory = tempfile::tempdir().unwrap();
        let state = new_state(config(directory.path()));
        register(&state);
        let original = legacy();
        let _ = integrations::enable(State(state.clone()), Path(original.project_id.clone()))
            .await
            .unwrap();
        state
            .store
            .lock()
            .unwrap()
            .create_ticket(&original, "uncertain")
            .unwrap();
        state
            .store
            .lock()
            .unwrap()
            .reserve_missions_delivery(&original.id)
            .unwrap();
        state
            .store
            .lock()
            .unwrap()
            .begin_missions_delivery(&original.id)
            .unwrap();
        assert_eq!(
            deliver(&state, &original).await.unwrap_err().0,
            StatusCode::CONFLICT
        );
        assert!(issues(&state, &original.project_id)
            .await
            .unwrap()
            .is_empty());
        let description = serde_json::to_string(&Intent::from_ticket(&original)).unwrap();
        for _ in 0..2 {
            call(
                &state,
                &original.project_id,
                &[
                    "create".into(),
                    format!("--title={}", original.title),
                    format!("--description={description}"),
                    format!("--labels={}", marker(&original)),
                ],
            )
            .await
            .unwrap();
        }
        assert_eq!(
            deliver(&state, &original).await.unwrap_err().0,
            StatusCode::CONFLICT
        );
        assert_eq!(issues(&state, &original.project_id).await.unwrap().len(), 2);
        let mut unavailable = state.clone();
        unavailable.components = None;
        let mut next = original.clone();
        next.id = "ticket-unavailable".into();
        assert_eq!(
            create_projection(&unavailable, &next, "unavailable")
                .await
                .unwrap_err()
                .0,
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(issues(&state, &original.project_id).await.unwrap().len(), 2);
    }
}
