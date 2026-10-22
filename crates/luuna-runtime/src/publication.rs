//! Publication (M7, ADR 0018): push a reviewed candidate's exact commits to
//! GitHub branches, open linked pull requests once, reconcile uncertain
//! external writes before retrying them, and observe CI and merges. Nothing
//! here merges: `integrated` is only ever observed from pull requests a human
//! merged on GitHub, and no route or operation performs a merge.
//!
//! The GitHub token is read once at startup (`LUUNA_GITHUB_TOKEN`); only its
//! presence is ever reported. Git receives it through `GIT_CONFIG_*`
//! environment variables scoped to the GitHub HTTPS origin, never through
//! arguments, with credential helpers and prompts disabled.
use crate::{internal, not_found, projects::storage_error, ApiError, AppState, StartupError};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use luuna_domain::{
    remotes_equivalent, CandidateEvidence, CandidateStatus, DomainError, PlanRevision,
    PublicationState, ReviewVerdict, SCHEMA_VERSION,
};
use luuna_git::{redact_remote, GitHubRepository, PushCredential, RemoteOperations, RemoteRef};
use luuna_storage::{
    intent_key, CiCheck, CiObservation, CiState, IntentState, MergeObservation, PublicationIntent,
    PublicationRecord, PullRequestRef, RepositoryPublication, StepState, StorageError,
    MULTI_REPOSITORY_REPAIR,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::BTreeMap, ffi::OsString, path::PathBuf, sync::OnceLock, time::Duration};
use tokio::sync::watch;

pub const DEFAULT_GITHUB_API_URL: &str = "https://api.github.com";

/// Publication settings read once at startup. The token value lives only
/// here and in the environment of a Git push; `Debug` never prints it.
#[derive(Clone)]
pub struct PublicationSettings {
    /// GitHub REST base URL; tests point it at a loopback fake.
    pub github_api_url: String,
    pub github_token: Option<String>,
    /// Deadline of one GitHub API write (pull request creation or update).
    pub request_timeout: Duration,
    /// Deadline of one GitHub API read while observing CI and merges.
    pub observe_timeout: Duration,
    /// Deadline of one `git ls-remote`/`git push`.
    pub git_timeout: Duration,
}

impl std::fmt::Debug for PublicationSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PublicationSettings")
            .field("github_api_url", &self.github_api_url)
            .field("github_token_configured", &self.github_token.is_some())
            .field("request_timeout", &self.request_timeout)
            .field("observe_timeout", &self.observe_timeout)
            .field("git_timeout", &self.git_timeout)
            .finish()
    }
}

impl Default for PublicationSettings {
    fn default() -> Self {
        Self {
            github_api_url: DEFAULT_GITHUB_API_URL.into(),
            github_token: None,
            request_timeout: Duration::from_secs(30),
            observe_timeout: Duration::from_secs(10),
            git_timeout: Duration::from_secs(120),
        }
    }
}

impl PublicationSettings {
    /// `LUUNA_GITHUB_TOKEN` (presence only is ever reported) and
    /// `LUUNA_GITHUB_API_URL` (default `https://api.github.com`).
    pub fn from_env(var: impl Fn(&str) -> Option<OsString>) -> Result<Self, StartupError> {
        let mut settings = Self::default();
        if let Some(token) = var("LUUNA_GITHUB_TOKEN") {
            let token = token
                .into_string()
                .map_err(|_| StartupError("LUUNA_GITHUB_TOKEN must be valid UTF-8".into()))?;
            let token = token.trim().to_owned();
            if token.is_empty() || !token.bytes().all(|b| b.is_ascii_graphic()) {
                return Err(StartupError(
                    "LUUNA_GITHUB_TOKEN must be a GitHub token of visible ASCII characters (its value is never printed)"
                        .into(),
                ));
            }
            settings.github_token = Some(token);
        }
        if let Some(url) = var("LUUNA_GITHUB_API_URL") {
            let url = url
                .into_string()
                .map_err(|_| StartupError("LUUNA_GITHUB_API_URL must be valid UTF-8".into()))?;
            let url = url.trim().trim_end_matches('/').to_owned();
            if !(url.starts_with("https://")
                || url.starts_with("http://127.0.0.1")
                || url.starts_with("http://localhost")
                || url.starts_with("http://[::1]"))
            {
                return Err(StartupError(
                    "LUUNA_GITHUB_API_URL must be an https:// URL (or a loopback http:// URL for tests)"
                        .into(),
                ));
            }
            settings.github_api_url = url;
        }
        Ok(settings)
    }

    pub fn github_token_configured(&self) -> bool {
        self.github_token.is_some()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublishRequest {
    pub expected_hash: String,
    pub idempotency_key: String,
}

fn conflict(reason: impl Into<String>) -> ApiError {
    ApiError(StatusCode::CONFLICT, reason.into())
}
fn unprocessable(reason: impl Into<String>) -> ApiError {
    ApiError(StatusCode::UNPROCESSABLE_ENTITY, reason.into())
}

/// The branch a candidate publishes to: `luuna/<ticket>/<12 hex of the hash>`.
pub fn branch_name(ticket_id: &str, candidate_hash: &str) -> String {
    let hex = candidate_hash
        .strip_prefix("sha256:")
        .unwrap_or(candidate_hash);
    let short: String = hex.chars().take(12).collect();
    let ticket: String = ticket_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("luuna/{ticket}/{short}")
}

/// Everything the gate resolved for a publication, taken under one store lock.
struct Prepared {
    evidence: CandidateEvidence,
    ticket: luuna_domain::Ticket,
    /// The plan revision the workflow's approval still authorizes.
    plan: PlanRevision,
    project_id: String,
    repositories: BTreeMap<String, RepositoryPublication>,
    /// The registered developer checkout and, when it still exists, the
    /// Luuna-owned worktree that recorded the candidate commit.
    checkouts: BTreeMap<String, Checkout>,
}

#[derive(Clone, Debug)]
struct Checkout {
    developer: PathBuf,
    worktree: Option<PathBuf>,
}

/// Refuse unless the current candidate is reviewed with a passed review, no
/// writer is active, the hash matches and the confirmed manifest is the one
/// the plan was made for. Every refusal names the next allowed step.
fn prepare(state: &AppState, id: &str, expected_hash: &str) -> Result<Prepared, ApiError> {
    if state.active.lock().map_err(internal)?.contains_key(id) {
        return Err(conflict(
            "workflow has active work; wait for it to settle, then publish",
        ));
    }
    let store = state.store.lock().map_err(internal)?;
    let run = store.get_run(id).map_err(internal)?.ok_or_else(not_found)?;
    if run.metadata["kind"] != "workflow" {
        return Err(unprocessable("only a plan workflow can be published"));
    }
    let evidence = store
        .current_candidate(id)
        .map_err(internal)?
        .ok_or_else(|| {
            unprocessable(
                "no candidate recorded; implement the approved plan first (POST /implement)",
            )
        })?;
    if evidence.candidate.hash != expected_hash {
        return Err(conflict(format!(
            "candidate hash changed; reload the candidate (GET /candidate) and publish {}",
            evidence.candidate.hash
        )));
    }
    let next = match evidence.status {
        CandidateStatus::Reviewed => None,
        CandidateStatus::Pending => Some("validate the candidate (POST /validate)"),
        CandidateStatus::Validating | CandidateStatus::Reviewing => {
            Some("wait for validation and review to settle")
        }
        CandidateStatus::Failed | CandidateStatus::TestingBlocked | CandidateStatus::Paused => {
            Some("repair the candidate (POST /repair) or create the next plan revision")
        }
        CandidateStatus::Cancelled | CandidateStatus::Interrupted => {
            Some("re-validate the candidate (POST /validate) or create the next plan revision")
        }
    };
    if let Some(next) = next {
        return Err(conflict(format!(
            "candidate is {}; publication needs a reviewed candidate with a passed review: {next}",
            status_name(&evidence.status)
        )));
    }
    match evidence.review.as_ref().map(|review| &review.verdict) {
        Some(ReviewVerdict::Passed) => {}
        Some(ReviewVerdict::ChangesRequired) => {
            return Err(conflict(
                "the independent review required changes; repair the candidate (POST /repair) before publishing",
            ))
        }
        Some(ReviewVerdict::Blocked) => {
            return Err(conflict(
                "the independent review blocked this candidate; create the next plan revision",
            ))
        }
        None => {
            return Err(conflict(
                "the candidate has no review verdict; re-validate it (POST /validate) before publishing",
            ))
        }
    }
    let plan = store
        .get_plan(
            run.metadata["plan_id"].as_str().unwrap_or_default(),
            run.metadata["plan_revision"].as_u64().unwrap_or_default(),
        )
        .map_err(internal)?
        .ok_or_else(|| unprocessable("the workflow's plan revision is missing"))?;
    let ticket = store
        .get_ticket(&plan.ticket_id)
        .map_err(internal)?
        .ok_or_else(|| unprocessable("ticket not found"))?;
    let manifest = store
        .current_manifest(&run.project_id)
        .map_err(internal)?
        .ok_or_else(|| unprocessable("the project has no confirmed manifest"))?;
    if manifest.hash != plan.manifest_hash {
        return Err(conflict(
            "the confirmed manifest changed since the plan; create the next plan revision before publishing",
        ));
    }
    // The same authorization gate validation and repair apply: the stored
    // approval must authorize the latest revision of the plan (a newer
    // revision supersedes it), and the ticket and manifest bindings must
    // still hold. A reviewed candidate is evidence for one exact plan
    // revision; it never carries over to a later one.
    let plan = store.authorize_workflow(id).map_err(|error| match error {
        StorageError::Domain(DomainError::StaleApproval) => conflict(format!(
            "the approval this candidate was implemented under no longer authorizes the latest revision of plan {}; a newer plan revision supersedes it, so this candidate cannot be published: implement, validate and review the latest revision's workflow, or re-plan",
            plan.id
        )),
        StorageError::Domain(error) => conflict(format!(
            "the plan's bindings no longer hold ({error}); create the next plan revision before publishing"
        )),
        StorageError::Invalid(detail) => conflict(format!(
            "publication is not authorized: {detail}; create the next plan revision before publishing"
        )),
        other => internal(other),
    })?;
    let active_leases = store.active_worktree_leases().map_err(internal)?;
    let leases = store.worktree_leases(id).map_err(internal)?;
    let registrations = store.repositories(&run.project_id).map_err(internal)?;
    let branch = branch_name(&ticket.id, &evidence.candidate.hash);
    let mut repositories = BTreeMap::new();
    let mut checkouts = BTreeMap::new();
    for (repository_id, commit) in &evidence.candidate.repository_commits {
        if active_leases
            .iter()
            .any(|l| l.project_id == run.project_id && &l.repository_id == repository_id)
        {
            return Err(conflict(format!(
                "repository {repository_id} has an active writer; wait for it to settle, then publish"
            )));
        }
        let manifest_repository = manifest
            .manifest
            .repositories
            .iter()
            .find(|r| &r.id == repository_id)
            .ok_or_else(|| {
                unprocessable(format!(
                    "repository {repository_id} is not part of the confirmed manifest; re-confirm the manifest and re-plan"
                ))
            })?;
        let registration = registrations
            .iter()
            .find(|r| &r.repository_id == repository_id)
            .ok_or_else(|| {
                unprocessable(format!(
                    "repository {repository_id} is not registered; register it before publishing"
                ))
            })?;
        let github = GitHubRepository::parse(&manifest_repository.remote).map_err(|reason| {
            unprocessable(format!(
                "repository {repository_id} cannot be published: {reason}"
            ))
        })?;
        let worktree = leases
            .iter()
            .rev()
            .find(|l| {
                &l.repository_id == repository_id && l.candidate_commit.as_ref() == Some(commit)
            })
            .map(|l| PathBuf::from(&l.path))
            .filter(|path| path.join(".git").exists());
        checkouts.insert(
            repository_id.clone(),
            Checkout {
                developer: PathBuf::from(&registration.local_path),
                worktree,
            },
        );
        repositories.insert(
            repository_id.clone(),
            RepositoryPublication {
                branch: branch.clone(),
                commit: commit.clone(),
                remote: manifest_repository.remote.clone(),
                owner: github.owner,
                repo: github.repo,
                base_branch: manifest_repository.default_branch.clone(),
                push: StepState::Pending,
                pull_request_step: StepState::Pending,
                pull_request: None,
                reason: None,
                ci: CiObservation::default(),
                merge: MergeObservation::default(),
            },
        );
    }
    Ok(Prepared {
        evidence,
        ticket,
        plan,
        project_id: run.project_id,
        repositories,
        checkouts,
    })
}

/// The scan budget for the pre-push policy check: a candidate whose patch
/// does not fit is refused as unscanned rather than pushed unchecked.
const POLICY_DIFF_BYTES: usize = 16 * 1024 * 1024;

fn refused(state: &AppState, id: &str, kind: &str, payload: Value) -> Result<(), ApiError> {
    let mut payload = payload;
    payload["kind"] = json!(kind);
    state.event(id, "publication.refused", payload)
}

/// Revalidate, after the transactional gate and before any external side
/// effect, every authoritative input a publication consumes that only the
/// repository, the host or the components can answer: the ticket's source and
/// the approved component context are re-resolved (`verify_plan_sources`),
/// every repository's Luuna-owned worktree must still hold exactly the frozen
/// candidate (manual drift after the review invalidates the candidate; the
/// evidence is marked and the run leaves `reviewed`), and the exact patch
/// that will be pushed passes the deterministic secrets/path policy. Applies
/// to the initial publication and to every reconciliation alike. Refusals are
/// durable `publication.refused` events naming the kind and the next step.
async fn admit(state: &AppState, id: &str, prepared: &mut Prepared) -> Result<(), ApiError> {
    crate::integrations::verify_plan_sources(state, &prepared.plan)
        .await
        .inspect_err(|error| {
            let _ = refused(
                state,
                id,
                "source_changed",
                json!({"candidate_hash": prepared.evidence.candidate.hash, "reason": error.1}),
            );
        })?;
    let evidence = prepared.evidence.clone();
    let worktrees = match crate::candidates::worktrees_for(state, id, &evidence) {
        Ok(worktrees) => worktrees,
        Err(error) => {
            let reason = format!(
                "the candidate's Luuna-owned worktree cannot be verified against the frozen candidate ({}); publication needs the reviewed worktree: repair the candidate (POST /repair) or create the next plan revision",
                error.1
            );
            refused(
                state,
                id,
                "worktree_unverifiable",
                json!({"candidate_hash": evidence.candidate.hash, "reason": reason}),
            )?;
            return Err(conflict(reason));
        }
    };
    for (repository_id, worktree) in &worktrees {
        let drift = crate::candidates::content_drift(state, &evidence, repository_id, worktree)
            .await
            .map_err(|detail| {
                ApiError(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("repository {repository_id}: {detail}"),
                )
            })?;
        if let Some(drift) = drift {
            let drift = if evidence.candidate.repository_commits.len() > 1 {
                format!("repository {repository_id}: {drift}")
            } else {
                drift
            };
            let reason = format!(
                "candidate content drift: the Luuna-owned worktree was changed outside Luuna after the review and no longer holds the frozen candidate ({drift}); the reviewed evidence is invalidated and nothing was pushed; the worktree is kept for inspection; repair the candidate (POST /repair, a new revision in a fresh worktree) or create the next plan revision"
            );
            let invalidated = state
                .store
                .lock()
                .map_err(internal)?
                .invalidate_reviewed_candidate(id, &evidence.candidate.hash, &reason, true)
                .map_err(storage_error)?;
            refused(
                state,
                id,
                "candidate_drift",
                json!({"candidate_hash": evidence.candidate.hash, "repository_id": repository_id, "reason": reason, "candidate_status": invalidated.status}),
            )?;
            return Err(conflict(reason));
        }
    }
    let known = crate::writer::known_secrets(state);
    let mut findings = Vec::new();
    for (repository_id, worktree) in &worktrees {
        let commit = &evidence.candidate.repository_commits[repository_id];
        let Some(base) = prepared.plan.base_commits.get(repository_id) else {
            return Err(conflict(format!(
                "the plan has no base commit for repository {repository_id}; create the next plan revision before publishing"
            )));
        };
        let diff = state
            .git
            .review_diff(worktree, base, commit, POLICY_DIFF_BYTES)
            .await
            .map_err(|error| {
                ApiError(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("repository {repository_id}: cannot read the candidate patch for the pre-push policy check: {error}"),
                )
            })?;
        // Files the patch could only summarize are read from their blobs so
        // a binary or non-UTF-8 file never carries unscanned content.
        let mut binary = Vec::new();
        for file in diff
            .files
            .iter()
            .filter(|file| file.shown == luuna_git::DiffShown::Summary && file.status != "D")
        {
            let bytes = state.git.blob_bytes(worktree, &file.new_blob).await.ok();
            binary.push(crate::policy::BinaryContent {
                path: file.path.clone(),
                bytes,
            });
        }
        findings.extend(crate::policy::scan_repository(
            repository_id,
            &prepared.plan,
            &diff,
            &known,
            &binary,
        ));
    }
    if !findings.is_empty() {
        let reason = format!(
            "pre-push policy refused the candidate ({}); nothing was pushed; the reviewed evidence is invalidated and the candidate is failed so a bounded repair can remove the finding: repair the candidate (POST /repair) or create the next plan revision",
            crate::policy::describe(&findings)
        );
        // The candidate's content is what the policy refused, so its review
        // is no longer evidence that it may be published; failing it opens
        // the same bounded repair path as a failed check.
        state
            .store
            .lock()
            .map_err(internal)?
            .invalidate_reviewed_candidate(id, &evidence.candidate.hash, &reason, false)
            .map_err(storage_error)?;
        refused(
            state,
            id,
            "policy",
            json!({"candidate_hash": evidence.candidate.hash, "findings": findings, "reason": reason}),
        )?;
        return Err(unprocessable(reason));
    }
    for (repository_id, worktree) in worktrees {
        if let Some(checkout) = prepared.checkouts.get_mut(&repository_id) {
            checkout.worktree = Some(worktree);
        }
    }
    Ok(())
}

fn status_name(status: &CandidateStatus) -> String {
    serde_json::to_value(status)
        .ok()
        .and_then(|v| v.as_str().map(ToOwned::to_owned))
        .unwrap_or_default()
}

fn view(state: &AppState, record: &PublicationRecord) -> Result<Value, ApiError> {
    let active = state
        .active
        .lock()
        .map_err(internal)?
        .contains_key(&record.run_id);
    let mut value = serde_json::to_value(record).map_err(internal)?;
    value["contract"] = serde_json::to_value(record.contract()).map_err(internal)?;
    value["active"] = json!(active);
    Ok(value)
}

fn require_token(state: &AppState) -> Result<PushCredential, ApiError> {
    state
        .publication
        .github_token
        .as_deref()
        .map(PushCredential::github)
        .ok_or_else(|| {
            unprocessable(
                "LUUNA_GITHUB_TOKEN is not configured for this runtime; set it (a GitHub token with repository write access) and restart the runtime, then publish",
            )
        })
}

/// `POST /api/v1/runs/{id}/publish` with `{expected_hash, idempotency_key}`.
/// A repeated key returns the existing record without new side effects.
pub async fn publish(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<PublishRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if request.idempotency_key.is_empty() || request.idempotency_key.len() > 128 {
        return Err(unprocessable("idempotency_key must be 1 to 128 characters"));
    }
    // An earlier request under the same key replays before any gate that
    // the first delivery already passed could now refuse it.
    {
        let store = state.store.lock().map_err(internal)?;
        if let Some(existing) = store
            .get_publication(&id, &request.expected_hash)
            .map_err(internal)?
        {
            drop(store);
            if existing.idempotency_key == request.idempotency_key {
                return Ok((StatusCode::OK, Json(view(&state, &existing)?)));
            }
            return Err(conflict(
                "this candidate already has a publication under another idempotency key; read it (GET /publication) or retry its missing steps (POST /publication/reconcile)",
            ));
        }
    }
    let mut prepared = prepare(&state, &id, &request.expected_hash)?;
    let credential = require_token(&state)?;
    admit(&state, &id, &mut prepared).await?;
    let (tx, rx) = watch::channel(false);
    let record = {
        let mut active = state.active.lock().map_err(internal)?;
        if active.contains_key(&id) {
            return Err(conflict(
                "workflow has active work; wait for it to settle, then publish",
            ));
        }
        if active.len() >= 4 {
            return Err(ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "four runs are already active".into(),
            ));
        }
        let now = luuna_git_now();
        let mut record = PublicationRecord {
            schema_version: SCHEMA_VERSION.into(),
            run_id: id.clone(),
            project_id: prepared.project_id.clone(),
            ticket_id: prepared.ticket.id.clone(),
            candidate_hash: prepared.evidence.candidate.hash.clone(),
            idempotency_key: request.idempotency_key.clone(),
            publication_state: PublicationState::Pending,
            repositories: prepared.repositories.clone(),
            reason: None,
            created_at: now.clone(),
            updated_at: now,
            observed_at: None,
            superseded_by_repair: false,
            superseded_reason: None,
            superseded_at: None,
        };
        let mut store = state.store.lock().map_err(internal)?;
        match store.create_publication(&record) {
            Ok(()) => {}
            Err(luuna_storage::StorageError::AlreadyExists(_)) => {
                let existing = store
                    .get_publication(&id, &record.candidate_hash)
                    .map_err(internal)?
                    .ok_or_else(|| conflict("publication changed; reload"))?;
                if existing.idempotency_key == request.idempotency_key {
                    record = existing;
                    drop(store);
                    drop(active);
                    return Ok((StatusCode::OK, Json(view(&state, &record)?)));
                }
                return Err(conflict(
                    "this candidate already has a publication under another idempotency key",
                ));
            }
            Err(error) => return Err(storage_error(error)),
        }
        active.insert(id.clone(), tx);
        record
    };
    let job = Job {
        state: state.clone(),
        run_id: id.clone(),
        candidate_hash: record.candidate_hash.clone(),
        checkouts: prepared.checkouts,
        evidence: prepared.evidence,
        ticket: prepared.ticket,
        credential,
        reconcile: false,
        stop: rx,
        superseded: Vec::new(),
    };
    state.spawn_supervised(id, job.run());
    Ok((StatusCode::ACCEPTED, Json(view(&state, &record)?)))
}

/// `POST /api/v1/runs/{id}/publication/reconcile`: retry only the steps the
/// intent ledger does not show succeeded, looking at the remote first for
/// writes whose outcome was uncertain. Never duplicates a branch push or a
/// pull request.
pub async fn reconcile(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let record = {
        let store = state.store.lock().map_err(internal)?;
        store
            .latest_publication(&id)
            .map_err(internal)?
            .ok_or_else(|| {
                ApiError(
                    StatusCode::NOT_FOUND,
                    "no publication exists for this run; publish the reviewed candidate first (POST /publish)".into(),
                )
            })?
    };
    if matches!(
        record.publication_state,
        PublicationState::PrOpen | PublicationState::Integrated
    ) && record.complete()
    {
        return Ok((StatusCode::OK, Json(view(&state, &record)?)));
    }
    let mut prepared = prepare(&state, &id, &record.candidate_hash)?;
    let credential = require_token(&state)?;
    admit(&state, &id, &mut prepared).await?;
    let (tx, rx) = watch::channel(false);
    {
        let mut active = state.active.lock().map_err(internal)?;
        if active.contains_key(&id) {
            return Err(conflict(
                "workflow has active work; wait for it to settle, then reconcile",
            ));
        }
        if active.len() >= 4 {
            return Err(ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "four runs are already active".into(),
            ));
        }
        active.insert(id.clone(), tx);
    }
    let job = Job {
        state: state.clone(),
        run_id: id.clone(),
        candidate_hash: record.candidate_hash.clone(),
        checkouts: prepared.checkouts,
        evidence: prepared.evidence,
        ticket: prepared.ticket,
        credential,
        reconcile: true,
        stop: rx,
        superseded: Vec::new(),
    };
    state.spawn_supervised(id, job.run());
    Ok((StatusCode::ACCEPTED, Json(view(&state, &record)?)))
}

/// `GET /api/v1/runs/{id}/publication`: the record with CI and merge
/// observations refreshed under bounded timeouts. A failed observation
/// leaves `unknown` with its reason; `integrated` is set only when every pull
/// request is observed merged.
pub async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let record = {
        let store = state.store.lock().map_err(internal)?;
        store.latest_publication(&id).map_err(internal)?
    };
    let Some(mut record) = record else {
        if state
            .store
            .lock()
            .map_err(internal)?
            .get_run(&id)
            .map_err(internal)?
            .is_none()
        {
            return Err(not_found());
        }
        return Err(ApiError(
            StatusCode::NOT_FOUND,
            "no publication exists for this run; publish the reviewed candidate (POST /publish)"
                .into(),
        ));
    };
    let active = state.active.lock().map_err(internal)?.contains_key(&id);
    if !active && record.complete() {
        observe(&state, &mut record).await?;
    }
    Ok(Json(view(&state, &record)?))
}

/// `POST /api/v1/runs/{id}/publication/repair` with the exact candidate hash
/// (and the provider and model, as for `POST …/repair`): the bounded repair
/// after a published candidate's pull request failed CI (A24). The run's
/// latest publication must be complete with its pull requests open, its CI
/// observation is refreshed first through the same bounded `observe` (a stale
/// view never triggers a repair) and must be `failure` on at least one
/// repository, the hash must match, no work may be active, and the ordinary
/// repair gates and budgets must hold before anything changes. Then the
/// reviewed candidate is invalidated with a reason naming the failing checks
/// per repository (names and conclusions, never log content), the record is
/// marked superseded, `publication.repair_requested` is recorded and the
/// existing repair path creates the next candidate revision in a fresh
/// worktree with the CI failure in its evidence. Nothing is merged, closed or
/// pushed here.
pub async fn repair(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<crate::candidates::CandidateRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if state.active.lock().map_err(internal)?.contains_key(&id) {
        return Err(conflict(
            "workflow has active work; wait for it to settle, then request the repair",
        ));
    }
    let record = {
        let store = state.store.lock().map_err(internal)?;
        if store.get_run(&id).map_err(internal)?.is_none() {
            return Err(not_found());
        }
        store.latest_publication(&id).map_err(internal)?
    };
    let Some(mut record) = record else {
        return Err(ApiError(
            StatusCode::NOT_FOUND,
            "no publication exists for this run; a CI repair follows a published candidate (POST /publish)"
                .into(),
        ));
    };
    if record.candidate_hash != request.candidate_hash {
        return Err(conflict(format!(
            "candidate hash changed; the latest publication is of candidate {}: reload the publication (GET /publication) and request the repair for that hash",
            record.candidate_hash
        )));
    }
    if record.superseded_by_repair {
        return Err(conflict(
            "this publication was already superseded by a repair; validate, review and publish the repaired candidate (GET /candidate)",
        ));
    }
    let not_open = match record.publication_state {
        PublicationState::PrOpen if record.complete() => None,
        PublicationState::PrOpen | PublicationState::Pending | PublicationState::Pushing => {
            Some("the publication is still in progress or incomplete; wait for it to settle or reconcile it (POST /publication/reconcile)")
        }
        PublicationState::Failed => Some(
            "the publication did not complete; reconcile it (POST /publication/reconcile) before a CI repair",
        ),
        PublicationState::Integrated => Some(
            "every pull request was already merged; there is nothing to repair, and a further change is the next plan revision",
        ),
    };
    if let Some(next) = not_open {
        return Err(conflict(format!(
            "a CI repair needs open pull requests (publication is {}): {next}",
            state_text(&record.publication_state)
        )));
    }
    // Refresh the observation under the bounded timeouts before deciding.
    observe(&state, &mut record).await?;
    if record.publication_state == PublicationState::Integrated {
        return Err(conflict(
            "a CI repair needs open pull requests (publication is integrated): every pull request was observed merged; there is nothing to repair",
        ));
    }
    let failing: Vec<(String, RepositoryPublication)> = record
        .repositories
        .iter()
        .filter(|(_, r)| r.ci.state == CiState::Failure)
        .map(|(id, r)| (id.clone(), r.clone()))
        .collect();
    if failing.is_empty() {
        let states: Vec<String> = record
            .repositories
            .iter()
            .map(|(repository_id, r)| {
                let next = match r.ci.state {
                    CiState::Unknown => "CI could not be observed or no checks are reported; read the publication again (GET /publication) once CI reports",
                    CiState::Pending => "CI is still running; wait for it to finish, then read the publication again (GET /publication)",
                    CiState::Success => "CI passed; there is nothing to repair and merging is the developer's decision on GitHub",
                    CiState::Failure => "",
                };
                format!(
                    "repository {repository_id}: ci {}{}; {next}",
                    ci_state_text(&r.ci.state),
                    r.ci
                        .reason
                        .as_deref()
                        .map(|reason| format!(" ({reason})"))
                        .unwrap_or_default()
                )
            })
            .collect();
        return Err(conflict(format!(
            "a CI repair needs an observed CI failure on at least one pull request; none is observed: {}",
            states.join("; ")
        )));
    }
    // The ordinary repair gates and budgets (ADR 0009, ADR 0017), evaluated
    // before the reviewed evidence is touched: a repair the budgets refuse
    // never costs the candidate its review.
    state
        .store
        .lock()
        .map_err(internal)?
        .can_repair_after_ci_failure(&id, &record.candidate_hash)
        .map_err(|error| match error {
            StorageError::Invalid(detail) if detail == MULTI_REPOSITORY_REPAIR => {
                conflict(format!("CI repair refused: {detail}"))
            }
            StorageError::Invalid(detail) => conflict(format!("CI repair refused: {detail}")),
            StorageError::Domain(DomainError::BudgetExceeded(detail)) => {
                unprocessable(format!("CI repair refused: {detail}"))
            }
            StorageError::Domain(error) => conflict(format!("CI repair refused: {error}")),
            other => storage_error(other),
        })?;
    let mut summary = Vec::new();
    let mut sentences = Vec::new();
    for (repository_id, repository) in &failing {
        let failed: Vec<&CiCheck> = repository
            .ci
            .checks
            .iter()
            .filter(|c| {
                matches!(
                    c.conclusion.as_deref(),
                    Some(
                        "failure"
                            | "cancelled"
                            | "timed_out"
                            | "action_required"
                            | "startup_failure"
                    )
                )
            })
            .collect();
        let pr = repository.pull_request.clone();
        sentences.push(format!(
            "repository {repository_id}, pull request {}: {}",
            pr.as_ref()
                .map(|pr| format!("#{} ({})", pr.number, pr.url))
                .unwrap_or_else(|| "unknown".into()),
            failed
                .iter()
                .map(|c| format!(
                    "{} {}",
                    c.name,
                    c.conclusion.as_deref().unwrap_or("unknown")
                ))
                .collect::<Vec<_>>()
                .join(", ")
        ));
        summary.push(json!({
            "repository_id": repository_id,
            "pull_request": pr,
            "commit": repository.commit,
            "ci_state": repository.ci.state,
            "observed_at": repository.ci.observed_at,
            "checks": repository.ci.checks,
            "failed_checks": failed.iter().map(|c| json!({"name": c.name, "status": c.status, "conclusion": c.conclusion})).collect::<Vec<_>>(),
        }));
    }
    let reason = format!(
        "CI failed on the published pull request ({}); the developer sent the candidate to a bounded repair: the reviewed evidence is invalidated, the pull request stays open for the developer, and the next candidate revision is implemented in a fresh worktree with the CI failure in its evidence",
        sentences.join("; ")
    );
    let hash = record.candidate_hash.clone();
    let invalidated = state
        .store
        .lock()
        .map_err(internal)?
        .invalidate_reviewed_candidate(&id, &hash, &reason, false)
        .map_err(storage_error)?;
    let now = luuna_git_now();
    record.superseded_by_repair = true;
    record.superseded_reason = Some(reason.clone());
    record.superseded_at = Some(now.clone());
    state
        .store
        .lock()
        .map_err(internal)?
        .update_publication(
            &mut record,
            Some((
                "publication.repair_requested",
                json!({
                    "candidate_hash": hash,
                    "candidate_status": invalidated.status,
                    "observed_at": now,
                    "ci_failure": summary,
                    "reason": reason,
                }),
            )),
        )
        .map_err(storage_error)?;
    let ci_failure = json!({
        "observed_at": record.observed_at,
        "repositories": summary,
        "note": "observed on GitHub after the independent review; check names, statuses and conclusions only, no log content",
    });
    let (status, Json(run)) =
        crate::writer::repair_after_ci_failure(state.clone(), id.clone(), request, ci_failure)
            .await
            .map_err(|error| {
                ApiError(
                    error.0,
                    format!(
                        "{}; the reviewed candidate was invalidated after the CI failure and the publication is marked superseded: repair it (POST /repair) once the refusal is resolved, or create the next plan revision",
                        error.1
                    ),
                )
            })?;
    let mut body = view(&state, &record)?;
    body["run"] = serde_json::to_value(run).map_err(internal)?;
    Ok((status, Json(body)))
}

fn state_text(state: &PublicationState) -> String {
    serde_json::to_value(state)
        .ok()
        .and_then(|v| v.as_str().map(ToOwned::to_owned))
        .unwrap_or_default()
}

fn ci_state_text(state: &CiState) -> String {
    serde_json::to_value(state)
        .ok()
        .and_then(|v| v.as_str().map(ToOwned::to_owned))
        .unwrap_or_default()
}

fn luuna_git_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// The GitHub REST client. Every call is bounded; errors never carry the
/// token (reqwest reports URLs and statuses, not headers).
struct GitHub {
    client: reqwest::Client,
    base: String,
    token: String,
}

#[derive(Debug)]
enum GitHubError {
    /// The request may have reached GitHub; its effect is unknown.
    Timeout,
    Status(u16, String),
    Transport(String),
}

impl std::fmt::Display for GitHubError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Timeout => f.write_str("GitHub did not answer before the deadline"),
            Self::Status(status, detail) => write!(f, "GitHub answered {status}: {detail}"),
            Self::Transport(detail) => write!(f, "GitHub request failed: {detail}"),
        }
    }
}

fn install_crypto_provider() {
    static INSTALLED: OnceLock<()> = OnceLock::new();
    INSTALLED.get_or_init(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

impl GitHub {
    fn new(settings: &PublicationSettings, token: &str, timeout: Duration) -> Result<Self, String> {
        install_crypto_provider();
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .user_agent("luuna-runtime")
            .build()
            .map_err(|error| format!("cannot build the GitHub client: {error}"))?;
        Ok(Self {
            client,
            base: settings.github_api_url.trim_end_matches('/').to_owned(),
            token: token.to_owned(),
        })
    }

    async fn call(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, GitHubError> {
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.base))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .bearer_auth(&self.token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|error| {
            if error.is_timeout() {
                GitHubError::Timeout
            } else {
                GitHubError::Transport(crate::one_line(&error.to_string(), 300).unwrap_or_default())
            }
        })?;
        let status = response.status().as_u16();
        let text = response.text().await.map_err(|error| {
            if error.is_timeout() {
                GitHubError::Timeout
            } else {
                GitHubError::Transport(crate::one_line(&error.to_string(), 300).unwrap_or_default())
            }
        })?;
        if !(200..300).contains(&status) {
            let detail = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v["message"].as_str().map(ToOwned::to_owned))
                .or_else(|| crate::one_line(&text, 200))
                .unwrap_or_default();
            return Err(GitHubError::Status(status, detail));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text).map_err(|error| {
            GitHubError::Transport(format!("GitHub answered with invalid JSON: {error}"))
        })
    }

    async fn get(&self, path: &str) -> Result<Value, GitHubError> {
        self.call(reqwest::Method::GET, path, None).await
    }
    async fn post(&self, path: &str, body: Value) -> Result<Value, GitHubError> {
        self.call(reqwest::Method::POST, path, Some(body)).await
    }
    async fn patch(&self, path: &str, body: Value) -> Result<Value, GitHubError> {
        self.call(reqwest::Method::PATCH, path, Some(body)).await
    }
}

fn pull_request_ref(value: &Value) -> Option<PullRequestRef> {
    Some(PullRequestRef {
        number: value["number"].as_u64()?,
        url: value["html_url"]
            .as_str()
            .or_else(|| value["url"].as_str())?
            .to_owned(),
    })
}

/// One supervised publication or reconciliation of a run's candidate.
struct Job {
    state: AppState,
    run_id: String,
    candidate_hash: String,
    checkouts: BTreeMap<String, Checkout>,
    evidence: CandidateEvidence,
    ticket: luuna_domain::Ticket,
    credential: PushCredential,
    reconcile: bool,
    stop: watch::Receiver<bool>,
    /// Earlier publications of this run that a CI repair superseded; the
    /// pull request bodies name them.
    superseded: Vec<PublicationRecord>,
}

struct Failure {
    repository_id: String,
    step: &'static str,
    reason: String,
}

impl Job {
    fn load(&self) -> Option<PublicationRecord> {
        self.state
            .store
            .lock()
            .ok()?
            .get_publication(&self.run_id, &self.candidate_hash)
            .ok()
            .flatten()
    }

    fn save(&self, record: &mut PublicationRecord, event: Option<(&str, Value)>) {
        if let Ok(mut store) = self.state.store.lock() {
            if let Err(error) = store.update_publication(record, event) {
                eprintln!(
                    "luuna-runtime: publication of run {} could not be saved: {error}",
                    self.run_id
                );
            }
        }
    }

    fn intent(
        &self,
        repository_id: &str,
        step: &str,
        branch: &str,
        commit: &str,
    ) -> PublicationIntent {
        let now = luuna_git_now();
        PublicationIntent {
            key: intent_key(
                &self.run_id,
                &self.candidate_hash,
                repository_id,
                step,
                branch,
                commit,
            ),
            run_id: self.run_id.clone(),
            candidate_hash: self.candidate_hash.clone(),
            repository_id: repository_id.to_owned(),
            step: step.to_owned(),
            branch: branch.to_owned(),
            commit: commit.to_owned(),
            state: IntentState::Intended,
            outcome: Value::Null,
            created_at: now.clone(),
            updated_at: now,
        }
    }

    /// Record the intent (or read the existing one) before an external write.
    fn record_intent(&self, intent: &PublicationIntent) -> Result<PublicationIntent, String> {
        self.state
            .store
            .lock()
            .map_err(|_| "runtime store unavailable".to_owned())?
            .record_publication_intent(intent)
            .map_err(|error| format!("intent could not be recorded: {error}"))
    }

    fn settle_intent(&self, key: &str, state: IntentState, outcome: Value) {
        if let Ok(mut store) = self.state.store.lock() {
            if let Err(error) = store.settle_publication_intent(key, state, outcome) {
                eprintln!("luuna-runtime: publication intent {key} could not be settled: {error}");
            }
        }
    }

    fn stopped(&self) -> bool {
        *self.stop.borrow()
    }

    async fn run(mut self) {
        let Some(mut record) = self.load() else {
            eprintln!(
                "luuna-runtime: publication of run {} vanished before it started",
                self.run_id
            );
            return;
        };
        self.superseded = self
            .state
            .store
            .lock()
            .ok()
            .and_then(|store| store.publications(&self.run_id).ok())
            .unwrap_or_default()
            .into_iter()
            .filter(|earlier| {
                earlier.superseded_by_repair && earlier.candidate_hash != self.candidate_hash
            })
            .collect();
        let settings = self.state.publication.clone();
        let Some(token) = settings.github_token.as_deref() else {
            record.publication_state = PublicationState::Failed;
            record.reason = Some("LUUNA_GITHUB_TOKEN is not configured".into());
            self.save(
                &mut record,
                Some((
                    "publication.failed",
                    json!({"reasons": [{"reason": "LUUNA_GITHUB_TOKEN is not configured"}]}),
                )),
            );
            return;
        };
        let github = match GitHub::new(&settings, token, settings.request_timeout) {
            Ok(github) => github,
            Err(reason) => {
                record.publication_state = PublicationState::Failed;
                record.reason = Some(reason.clone());
                self.save(
                    &mut record,
                    Some((
                        "publication.failed",
                        json!({"reasons": [{"reason": reason}]}),
                    )),
                );
                return;
            }
        };
        let ops = RemoteOperations::new((*self.state.git).clone(), settings.git_timeout);
        record.publication_state = PublicationState::Pushing;
        record.reason = None;
        self.save(&mut record, None);
        let mut failures = Vec::new();
        let ids: Vec<String> = record.repositories.keys().cloned().collect();
        for repository_id in &ids {
            if self.stopped() {
                failures.push(Failure {
                    repository_id: repository_id.clone(),
                    step: "publication",
                    reason: self
                        .state
                        .stop_reason("publication stopped before this repository was published"),
                });
                continue;
            }
            let mut repository = record.repositories[repository_id].clone();
            repository.reason = None;
            if repository.push != StepState::Done {
                match self.push(&ops, repository_id, &repository).await {
                    Ok(already) => {
                        repository.push = StepState::Done;
                        record
                            .repositories
                            .insert(repository_id.clone(), repository.clone());
                        self.save(
                            &mut record,
                            Some((
                                "publication.pushed",
                                json!({"repository_id": repository_id, "branch": repository.branch, "commit": repository.commit, "already_on_remote": already}),
                            )),
                        );
                    }
                    Err(reason) => {
                        repository.push = StepState::Failed;
                        repository.reason = Some(reason.clone());
                        record
                            .repositories
                            .insert(repository_id.clone(), repository);
                        self.save(&mut record, None);
                        failures.push(Failure {
                            repository_id: repository_id.clone(),
                            step: "push",
                            reason,
                        });
                        continue;
                    }
                }
            }
            if repository.pull_request_step != StepState::Done {
                match self
                    .pull_request(&github, &record, repository_id, &repository)
                    .await
                {
                    Ok((pull_request, reused)) => {
                        repository.pull_request_step = StepState::Done;
                        repository.pull_request = Some(pull_request.clone());
                        record
                            .repositories
                            .insert(repository_id.clone(), repository.clone());
                        self.save(
                            &mut record,
                            Some((
                                "publication.pr_opened",
                                json!({"repository_id": repository_id, "number": pull_request.number, "url": pull_request.url, "reused_existing": reused}),
                            )),
                        );
                    }
                    Err(reason) => {
                        repository.pull_request_step = StepState::Failed;
                        repository.reason = Some(reason.clone());
                        record
                            .repositories
                            .insert(repository_id.clone(), repository);
                        self.save(&mut record, None);
                        failures.push(Failure {
                            repository_id: repository_id.clone(),
                            step: "pull_request",
                            reason,
                        });
                    }
                }
            }
        }
        if failures.is_empty() && record.repositories.len() > 1 {
            for repository_id in &ids {
                let repository = record.repositories[repository_id].clone();
                if let Err(reason) = self
                    .link(&github, &record, repository_id, &repository)
                    .await
                {
                    failures.push(Failure {
                        repository_id: repository_id.clone(),
                        step: "link",
                        reason,
                    });
                }
            }
        }
        let reasons: Vec<Value> = failures
            .iter()
            .map(|f| json!({"repository_id": f.repository_id, "step": f.step, "reason": f.reason}))
            .collect();
        if failures.is_empty() {
            record.publication_state = PublicationState::PrOpen;
            record.reason = None;
        } else {
            record.publication_state = PublicationState::Failed;
            record.reason = Some(
                failures
                    .iter()
                    .map(|f| format!("{} {}: {}", f.repository_id, f.step, f.reason))
                    .collect::<Vec<_>>()
                    .join("; "),
            );
        }
        let summary = json!({
            "publication_state": record.publication_state,
            "repositories": record.repositories.iter().map(|(id, r)| json!({"repository_id": id, "push": r.push, "pull_request_step": r.pull_request_step, "pull_request": r.pull_request})).collect::<Vec<_>>(),
            "reasons": reasons,
        });
        if !failures.is_empty() {
            self.save(&mut record, Some(("publication.failed", summary.clone())));
        }
        if self.reconcile {
            self.save(&mut record, Some(("publication.reconciled", summary)));
        } else if failures.is_empty() {
            self.save(&mut record, None);
        }
    }

    /// Push the exact commit unless the remote branch already holds it.
    /// Returns whether the branch was already there.
    async fn push(
        &self,
        ops: &RemoteOperations,
        repository_id: &str,
        repository: &RepositoryPublication,
    ) -> Result<bool, String> {
        let checkout = self
            .checkouts
            .get(repository_id)
            .ok_or_else(|| "registered checkout is unknown".to_owned())?;
        let developer = &checkout.developer;
        if !developer.is_dir() {
            return Err(format!(
                "registered checkout {} no longer exists",
                developer.display()
            ));
        }
        let configured = ops
            .configured_url(developer)
            .await
            .map_err(|e| format!("cannot read the checkout's origin: {e}"))?
            .ok_or_else(|| "the registered checkout has no origin remote".to_owned())?;
        let redacted = redact_remote(&configured);
        if !remotes_equivalent(&redacted, &repository.remote) {
            return Err(format!(
                "the checkout's origin ({redacted}) is no longer the registered remote {}; rebind the repository before publishing",
                repository.remote
            ));
        }
        let url = ops
            .push_url(developer)
            .await
            .map_err(|e| format!("cannot resolve the push URL: {e}"))?;
        let cwd = checkout
            .worktree
            .clone()
            .filter(|p| p.is_dir())
            .unwrap_or_else(|| developer.clone());
        if !ops
            .has_commit(&cwd, &repository.commit)
            .await
            .map_err(|e| format!("cannot look up the candidate commit: {e}"))?
        {
            return Err(format!(
                "candidate commit {} is no longer in the repository's object store; repair the candidate or create the next plan revision",
                repository.commit
            ));
        }
        let intent = self.intent(
            repository_id,
            "push",
            &repository.branch,
            &repository.commit,
        );
        let existing = self.record_intent(&intent)?;
        if existing.state == IntentState::Succeeded {
            return Ok(existing.outcome["already_on_remote"]
                .as_bool()
                .unwrap_or(true));
        }
        let credential = Some(&self.credential);
        match ops
            .remote_branch(&cwd, &url, &repository.branch, credential)
            .await
        {
            Ok(RemoteRef::At(sha)) if sha == repository.commit => {
                self.settle_intent(
                    &intent.key,
                    IntentState::Succeeded,
                    json!({"already_on_remote": true}),
                );
                return Ok(true);
            }
            Ok(RemoteRef::At(sha)) => {
                let reason = format!(
                    "remote branch {} already points at {sha}, not the candidate commit {}; it was not written by this publication and is left alone",
                    repository.branch, repository.commit
                );
                self.settle_intent(&intent.key, IntentState::Failed, json!({"reason": reason}));
                return Err(reason);
            }
            Ok(RemoteRef::Absent) => {}
            Err(error) => {
                let reason = format!("cannot read the remote branch: {error}");
                self.settle_intent(&intent.key, IntentState::Failed, json!({"reason": reason}));
                return Err(reason);
            }
        }
        match ops
            .push_commit(
                &cwd,
                &url,
                &repository.commit,
                &repository.branch,
                credential,
            )
            .await
        {
            Ok(()) => {
                self.settle_intent(
                    &intent.key,
                    IntentState::Succeeded,
                    json!({"already_on_remote": false}),
                );
                Ok(false)
            }
            Err(luuna_git::GitError::Timeout(_)) => {
                let reason = "the push did not finish before its deadline; reconcile to check whether it reached the remote".to_owned();
                self.settle_intent(
                    &intent.key,
                    IntentState::Uncertain,
                    json!({"reason": reason}),
                );
                Err(reason)
            }
            Err(error) => {
                let reason = format!("push failed: {error}");
                self.settle_intent(&intent.key, IntentState::Failed, json!({"reason": reason}));
                Err(reason)
            }
        }
    }

    fn title(&self) -> String {
        format!("{} [Luuna {}]", self.ticket.title, self.ticket.id)
    }

    fn body(&self, record: &PublicationRecord, repository_id: &str) -> String {
        let evidence = &self.evidence;
        let passed = evidence
            .results
            .iter()
            .filter(|r| r.status == luuna_domain::CheckStatus::Passed)
            .count();
        let mut body = format!(
            "Luuna ticket `{}`: {}\n\nCandidate hash: `{}`\nCandidate revision: {}\nWorkflow run: `{}`\n\n## Evidence\n\n- Required checks: {passed} of {} passed (validation generation {})\n- Independent review: {} by `{}`\n- Implementer session: `{}`\n",
            self.ticket.id,
            self.ticket.title,
            evidence.candidate.hash,
            evidence.candidate.revision,
            self.run_id,
            evidence.results.len(),
            evidence.validation_generation,
            evidence
                .review
                .as_ref()
                .map(|r| serde_json::to_value(&r.verdict).ok().and_then(|v| v.as_str().map(ToOwned::to_owned)).unwrap_or_default())
                .unwrap_or_else(|| "none".into()),
            evidence
                .review
                .as_ref()
                .map(|r| r.reviewer_session.clone())
                .unwrap_or_default(),
            evidence.implementer_session,
        );
        if let Some(review) = &evidence.review {
            for line in review.evidence.iter().take(8) {
                body.push_str(&format!("- Review evidence: {line}\n"));
            }
        }
        if record.repositories.len() > 1 {
            body.push_str("\n## Linked pull requests\n\n");
            body.push_str(&format!(
                "This pull request is part of a {}-repository candidate set; each repository's checks ran against the others' exact candidate commits.\n\n",
                record.repositories.len()
            ));
            for (id, repository) in &record.repositories {
                if id == repository_id {
                    continue;
                }
                match &repository.pull_request {
                    Some(pr) => body.push_str(&format!("- `{id}`: {}\n", pr.url)),
                    None => body.push_str(&format!(
                        "- `{id}`: branch `{}` (pull request pending)\n",
                        repository.branch
                    )),
                }
            }
            body.push_str("\n## Dependencies and merge order\n\n");
            let order = merge_order(
                record.repositories.keys().cloned().collect(),
                &evidence.candidate.dependency_bindings,
            );
            let mut producers: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
            for binding in evidence.candidate.dependency_bindings.keys() {
                if let Some((consumer, producer)) = binding.split_once(':') {
                    producers.entry(consumer).or_default().push(producer);
                }
            }
            for (position, id) in order.iter().enumerate() {
                let depends = producers
                    .get(id.as_str())
                    .map(|p| {
                        format!(
                            " (depends on {})",
                            p.iter()
                                .map(|producer| format!(
                                    "`{producer}` at `{}`",
                                    evidence.candidate.dependency_bindings
                                        [&format!("{id}:{producer}")]
                                ))
                                .collect::<Vec<_>>()
                                .join(", ")
                        )
                    })
                    .unwrap_or_default();
                body.push_str(&format!(
                    "{}. `{id}`{}{depends}\n",
                    position + 1,
                    if id == repository_id {
                        " (this pull request)"
                    } else {
                        ""
                    }
                ));
            }
            body.push_str(
                "\nMerge producers before their consumers, in this order. The pull requests are not merged atomically: until every one is merged, a consumer's default branch may not build against its producer's; if a partial merge leaves the remaining change obsolete, re-plan instead of merging it.\n",
            );
        }
        for earlier in &self.superseded {
            let Some(previous) = earlier.repositories.get(repository_id) else {
                continue;
            };
            body.push_str("\n## Supersedes\n\n");
            match &previous.pull_request {
                Some(pr) => body.push_str(&format!(
                    "- Pull request #{} ({}) of candidate `{}` (branch `{}`) is superseded by this candidate revision after CI failed on it; Luuna leaves it to the developer to close.\n",
                    pr.number, pr.url, earlier.candidate_hash, previous.branch
                )),
                None => body.push_str(&format!(
                    "- Branch `{}` of candidate `{}` is superseded by this candidate revision after CI failed on it.\n",
                    previous.branch, earlier.candidate_hash
                )),
            }
            if let Some(reason) = &earlier.superseded_reason {
                body.push_str(&format!("- Reason: {reason}\n"));
            }
        }
        body.push_str(
            "\nMerging is the developer's decision; Luuna never merges. Generated by Luuna.\n",
        );
        body
    }

    /// Reuse the pull request for this head when one exists; create it
    /// otherwise. Returns the pull request and whether it was reused.
    async fn pull_request(
        &self,
        github: &GitHub,
        record: &PublicationRecord,
        repository_id: &str,
        repository: &RepositoryPublication,
    ) -> Result<(PullRequestRef, bool), String> {
        let intent = self.intent(
            repository_id,
            "pull_request",
            &repository.branch,
            &repository.commit,
        );
        let existing = self.record_intent(&intent)?;
        if existing.state == IntentState::Succeeded {
            if let Some(pr) = pull_request_ref(&existing.outcome) {
                return Ok((
                    pr,
                    existing.outcome["reused_existing"]
                        .as_bool()
                        .unwrap_or(false),
                ));
            }
        }
        let repos = format!("/repos/{}/{}", repository.owner, repository.repo);
        let head = format!("{}:{}", repository.owner, repository.branch);
        let listed = github
            .get(&format!(
                "{repos}/pulls?head={}&state=all&per_page=20",
                url_encode(&head)
            ))
            .await
            .map_err(|error| {
                let reason = format!("cannot list pull requests for {head}: {error}");
                self.settle_intent(&intent.key, IntentState::Failed, json!({"reason": reason}));
                reason
            })?;
        let found = listed
            .as_array()
            .into_iter()
            .flatten()
            .find(|pr| pr["head"]["ref"].as_str() == Some(repository.branch.as_str()))
            .and_then(pull_request_ref);
        if let Some(pr) = found {
            self.settle_intent(
                &intent.key,
                IntentState::Succeeded,
                json!({"number": pr.number, "html_url": pr.url, "reused_existing": true}),
            );
            return Ok((pr, true));
        }
        let body = json!({
            "title": self.title(),
            "head": repository.branch,
            "base": repository.base_branch,
            "body": self.body(record, repository_id),
            "maintainer_can_modify": true,
        });
        match github.post(&format!("{repos}/pulls"), body).await {
            Ok(created) => match pull_request_ref(&created) {
                Some(pr) => {
                    self.settle_intent(
                        &intent.key,
                        IntentState::Succeeded,
                        json!({"number": pr.number, "html_url": pr.url, "reused_existing": false}),
                    );
                    Ok((pr, false))
                }
                None => {
                    let reason = "GitHub created a pull request but answered without its number; reconcile to find it".to_owned();
                    self.settle_intent(
                        &intent.key,
                        IntentState::Uncertain,
                        json!({"reason": reason}),
                    );
                    Err(reason)
                }
            },
            Err(GitHubError::Timeout) => {
                let reason = "pull request creation did not answer before the deadline; reconcile to find it without creating another".to_owned();
                self.settle_intent(
                    &intent.key,
                    IntentState::Uncertain,
                    json!({"reason": reason}),
                );
                Err(reason)
            }
            Err(error) => {
                let reason = format!("pull request creation failed: {error}");
                self.settle_intent(&intent.key, IntentState::Failed, json!({"reason": reason}));
                Err(reason)
            }
        }
    }

    /// Once every pull request exists, each body names the others.
    async fn link(
        &self,
        github: &GitHub,
        record: &PublicationRecord,
        repository_id: &str,
        repository: &RepositoryPublication,
    ) -> Result<(), String> {
        let Some(pr) = &repository.pull_request else {
            return Err("pull request missing".into());
        };
        let intent = self.intent(
            repository_id,
            "link",
            &repository.branch,
            &repository.commit,
        );
        let existing = self.record_intent(&intent)?;
        if existing.state == IntentState::Succeeded {
            return Ok(());
        }
        let repos = format!("/repos/{}/{}", repository.owner, repository.repo);
        match github
            .patch(
                &format!("{repos}/pulls/{}", pr.number),
                json!({"body": self.body(record, repository_id)}),
            )
            .await
        {
            Ok(_) => {
                self.settle_intent(&intent.key, IntentState::Succeeded, json!({"linked": true}));
                Ok(())
            }
            Err(GitHubError::Timeout) => {
                let reason = "linking the pull request bodies did not answer before the deadline; reconcile to retry".to_owned();
                self.settle_intent(
                    &intent.key,
                    IntentState::Uncertain,
                    json!({"reason": reason}),
                );
                Err(reason)
            }
            Err(error) => {
                let reason = format!("linking the pull request bodies failed: {error}");
                self.settle_intent(&intent.key, IntentState::Failed, json!({"reason": reason}));
                Err(reason)
            }
        }
    }
}

/// The merge order of a candidate set: producers before their consumers,
/// derived from the set's `<consumer>:<producer>` bindings; repositories with
/// no ordering between them follow their identifiers. A binding that names a
/// repository outside the set is ignored (the domain refuses such sets).
pub fn merge_order(
    repositories: Vec<String>,
    dependency_bindings: &BTreeMap<String, String>,
) -> Vec<String> {
    let mut remaining: Vec<String> = repositories;
    remaining.sort();
    let edges: Vec<(String, String)> = dependency_bindings
        .keys()
        .filter_map(|binding| binding.split_once(':'))
        .map(|(consumer, producer)| (consumer.to_owned(), producer.to_owned()))
        .collect();
    let mut order = Vec::new();
    while !remaining.is_empty() {
        let next = remaining.iter().position(|candidate| {
            !edges
                .iter()
                .any(|(consumer, producer)| consumer == candidate && remaining.contains(producer))
        });
        match next {
            Some(index) => order.push(remaining.remove(index)),
            // A cycle cannot reach here (the domain refuses it); keep the
            // rest in identifier order rather than loop.
            None => {
                order.append(&mut remaining);
            }
        }
    }
    order
}

fn url_encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Refresh the CI and merge observations of every pull request. Observation
/// never changes candidate evidence; a merge observed on every pull request
/// makes the record `integrated` once.
async fn observe(state: &AppState, record: &mut PublicationRecord) -> Result<(), ApiError> {
    let settings = state.publication.clone();
    let now = luuna_git_now();
    let github = settings
        .github_token
        .as_deref()
        .map(|token| GitHub::new(&settings, token, settings.observe_timeout));
    let ids: Vec<String> = record.repositories.keys().cloned().collect();
    for repository_id in ids {
        let mut repository = record.repositories[&repository_id].clone();
        let Some(pr) = repository.pull_request.clone() else {
            continue;
        };
        let (ci, merge) = match &github {
            None => (
                CiObservation {
                    state: CiState::Unknown,
                    observed_at: Some(now.clone()),
                    checks: Vec::new(),
                    reason: Some(
                        "LUUNA_GITHUB_TOKEN is not configured; CI cannot be observed".into(),
                    ),
                },
                MergeObservation {
                    merged: repository.merge.merged,
                    merged_at: repository.merge.merged_at.clone(),
                    merged_by: repository.merge.merged_by.clone(),
                    observed_at: Some(now.clone()),
                    reason: Some(
                        "LUUNA_GITHUB_TOKEN is not configured; merges cannot be observed".into(),
                    ),
                },
            ),
            Some(Err(reason)) => (
                CiObservation {
                    state: CiState::Unknown,
                    observed_at: Some(now.clone()),
                    checks: Vec::new(),
                    reason: Some(reason.clone()),
                },
                MergeObservation {
                    merged: repository.merge.merged,
                    observed_at: Some(now.clone()),
                    reason: Some(reason.clone()),
                    ..repository.merge.clone()
                },
            ),
            Some(Ok(github)) => observe_pull_request(github, &repository, &pr, &now).await,
        };
        repository.ci = ci;
        // A merge is final on GitHub; an observation failure never unsets it.
        if repository.merge.merged && !merge.merged {
            repository.merge.observed_at = merge.observed_at;
            repository.merge.reason = merge.reason;
        } else {
            repository.merge = merge;
        }
        record.repositories.insert(repository_id, repository);
    }
    record.observed_at = Some(now.clone());
    let integrated_now =
        record.all_merged() && record.publication_state != PublicationState::Integrated;
    if integrated_now {
        record.publication_state = PublicationState::Integrated;
        record.reason = None;
    }
    let event = integrated_now.then(|| {
        (
            "publication.integrated",
            json!({
                "observed_at": now,
                "pull_requests": record.repositories.iter().map(|(id, r)| json!({"repository_id": id, "pull_request": r.pull_request, "merged_at": r.merge.merged_at, "merged_by": r.merge.merged_by})).collect::<Vec<_>>(),
                "reason": "every pull request was observed merged on GitHub by a person; Luuna performed no merge",
            }),
        )
    });
    state
        .store
        .lock()
        .map_err(internal)?
        .update_publication(record, event)
        .map_err(internal)?;
    Ok(())
}

async fn observe_pull_request(
    github: &GitHub,
    repository: &RepositoryPublication,
    pr: &PullRequestRef,
    now: &str,
) -> (CiObservation, MergeObservation) {
    let repos = format!("/repos/{}/{}", repository.owner, repository.repo);
    let pull = match github.get(&format!("{repos}/pulls/{}", pr.number)).await {
        Ok(pull) => pull,
        Err(error) => {
            let reason = format!("pull request could not be read: {error}");
            return (
                CiObservation {
                    state: CiState::Unknown,
                    observed_at: Some(now.to_owned()),
                    checks: Vec::new(),
                    reason: Some(reason.clone()),
                },
                MergeObservation {
                    merged: repository.merge.merged,
                    merged_at: repository.merge.merged_at.clone(),
                    merged_by: repository.merge.merged_by.clone(),
                    observed_at: Some(now.to_owned()),
                    reason: Some(reason),
                },
            );
        }
    };
    let merge = MergeObservation {
        merged: pull["merged"].as_bool().unwrap_or(false),
        merged_at: pull["merged_at"].as_str().map(ToOwned::to_owned),
        merged_by: pull["merged_by"]["login"].as_str().map(ToOwned::to_owned),
        observed_at: Some(now.to_owned()),
        reason: None,
    };
    let sha = pull["head"]["sha"]
        .as_str()
        .unwrap_or(&repository.commit)
        .to_owned();
    let mut checks = Vec::new();
    let mut reasons = Vec::new();
    match github
        .get(&format!("{repos}/commits/{sha}/check-runs?per_page=100"))
        .await
    {
        Ok(runs) => {
            for run in runs["check_runs"].as_array().into_iter().flatten() {
                checks.push(CiCheck {
                    name: run["name"].as_str().unwrap_or("check").to_owned(),
                    status: run["status"].as_str().unwrap_or("unknown").to_owned(),
                    conclusion: run["conclusion"].as_str().map(ToOwned::to_owned),
                });
            }
        }
        Err(error) => reasons.push(format!("check runs could not be read: {error}")),
    }
    match github.get(&format!("{repos}/commits/{sha}/status")).await {
        Ok(status) => {
            for context in status["statuses"].as_array().into_iter().flatten() {
                let state = context["state"].as_str().unwrap_or("pending");
                checks.push(CiCheck {
                    name: context["context"].as_str().unwrap_or("status").to_owned(),
                    status: if state == "pending" {
                        "in_progress"
                    } else {
                        "completed"
                    }
                    .to_owned(),
                    conclusion: match state {
                        "success" => Some("success".into()),
                        "failure" | "error" => Some("failure".into()),
                        _ => None,
                    },
                });
            }
        }
        Err(error) => reasons.push(format!("commit status could not be read: {error}")),
    }
    let state = if !reasons.is_empty() && checks.is_empty() {
        CiState::Unknown
    } else if checks.iter().any(|c| {
        matches!(
            c.conclusion.as_deref(),
            Some("failure" | "cancelled" | "timed_out" | "action_required" | "startup_failure")
        )
    }) {
        CiState::Failure
    } else if checks.iter().any(|c| c.status != "completed") {
        CiState::Pending
    } else if checks.is_empty() {
        reasons.push("no checks or statuses are reported for the pull request head".into());
        CiState::Unknown
    } else {
        CiState::Success
    };
    let ci = CiObservation {
        state,
        observed_at: Some(now.to_owned()),
        checks,
        reason: (!reasons.is_empty()).then(|| reasons.join("; ")),
    };
    (ci, merge)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branch_names_are_bounded_and_safe() {
        let hash = format!("sha256:{}", "0123456789abcdef".repeat(4));
        assert_eq!(
            branch_name("ticket-7", &hash),
            "luuna/ticket-7/0123456789ab"
        );
        assert_eq!(branch_name("a b/c", &hash), "luuna/a-b-c/0123456789ab");
    }

    #[test]
    fn settings_report_token_presence_only() {
        let settings = PublicationSettings::from_env(|name| match name {
            "LUUNA_GITHUB_TOKEN" => Some(" ghp_example ".into()),
            "LUUNA_GITHUB_API_URL" => Some("http://127.0.0.1:9/".into()),
            _ => None,
        })
        .unwrap();
        assert!(settings.github_token_configured());
        assert_eq!(settings.github_api_url, "http://127.0.0.1:9");
        assert!(!format!("{settings:?}").contains("ghp_example"));
        assert!(PublicationSettings::from_env(|name| {
            (name == "LUUNA_GITHUB_API_URL").then(|| "http://example.invalid".into())
        })
        .is_err());
        assert!(PublicationSettings::from_env(|name| {
            (name == "LUUNA_GITHUB_TOKEN").then(|| "   ".into())
        })
        .is_err());
        let none = PublicationSettings::from_env(|_| None).unwrap();
        assert!(!none.github_token_configured());
        assert_eq!(none.github_api_url, DEFAULT_GITHUB_API_URL);
    }

    #[test]
    fn merge_order_puts_producers_before_consumers() {
        let bindings: BTreeMap<String, String> = [
            ("consumer:shared".to_owned(), "c".repeat(40)),
            ("shared:api".to_owned(), "a".repeat(40)),
        ]
        .into_iter()
        .collect();
        assert_eq!(
            merge_order(
                vec!["consumer".into(), "api".into(), "shared".into()],
                &bindings
            ),
            ["api", "shared", "consumer"]
        );
        assert_eq!(
            merge_order(vec!["b".into(), "a".into()], &BTreeMap::new()),
            ["a", "b"]
        );
    }

    #[test]
    fn head_filters_are_url_encoded() {
        assert_eq!(url_encode("octo:luuna/t/abc"), "octo%3Aluuna%2Ft%2Fabc");
    }
}
