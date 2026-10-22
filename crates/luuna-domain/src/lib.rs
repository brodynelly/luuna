//! Deterministic Luuna contracts. Worker output never authorizes a state change.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

mod baseline;
mod project;
mod validation;
mod writer;
pub use baseline::*;
pub use project::*;
pub use validation::*;
pub use writer::*;

pub const SCHEMA_VERSION: &str = "0.1";
pub const CANONICALIZATION: &str = "luuna-json-v1";

/// Inclusive plan budget ceilings. Unbounded values could overflow a deadline or
/// exceed what a JSON client shows exactly; zero would refuse every stage.
pub const MAX_PLAN_ATTEMPTS: u32 = 10;
pub const MAX_PLAN_TIMEOUT_SECONDS: u64 = 86_400;
pub const MAX_PLAN_COST_USD_MICROS: u64 = 1_000_000_000;

#[derive(Debug, Error)]
pub enum DomainError {
    #[error("invalid contract: {0}")]
    Invalid(String),
    #[error("invalid transition from {from:?} to {to:?}")]
    InvalidTransition { from: RunState, to: RunState },
    #[error("approval does not authorize this exact plan revision and permissions")]
    StaleApproval,
    #[error("repository identity mismatch: {0}")]
    IdentityMismatch(String),
    #[error("baseline evidence required: {0}")]
    BaselineRequired(String),
    #[error("scope violation: {0}")]
    ScopeViolation(String),
    #[error("budget exceeded: {0}")]
    BudgetExceeded(String),
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
    Discovered,
    Exploring,
    TestingBlocked,
    PlanReady,
    Approved,
    Implementing,
    Validating,
    Reviewing,
    Reviewed,
    Paused,
}

impl RunState {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Cancelled | Self::Interrupted | Self::Reviewed
        )
    }

    /// Structural lifecycle only. `Approved`/`Implementing` additionally require
    /// `Approval::authorize`; storage exposes those through its approval gate.
    pub fn transition(self, to: Self) -> Result<Self, DomainError> {
        use RunState::*;
        let valid = matches!(
            (self, to),
            (Queued, Running | Cancelled | Interrupted | Failed)
                | (Running, Completed | Failed | Cancelled | Interrupted)
                | (Discovered, Exploring | Cancelled)
                | (
                    Exploring,
                    PlanReady | TestingBlocked | Failed | Cancelled | Interrupted
                )
                | (TestingBlocked, Exploring | Cancelled)
                | (PlanReady, Approved | Exploring | Cancelled)
                | (Approved, Implementing | Paused | Cancelled)
                | (
                    Implementing,
                    Validating | Paused | Failed | Cancelled | Interrupted
                )
                | (
                    Validating,
                    Reviewing | TestingBlocked | Paused | Failed | Cancelled | Interrupted
                )
                | (
                    Reviewing,
                    Reviewed | Paused | Failed | Cancelled | Interrupted
                )
                | (Paused, Exploring | Cancelled)
                | (Paused | Failed | TestingBlocked, Implementing)
                | (Failed | TestingBlocked, Paused)
                | (Failed, Cancelled)
                // Structural only: storage admits `Failed -> Validating` solely for a
                // candidate whose required checks passed and whose reviewer left no
                // verdict (a fresh generation, never a new revision or budget).
                | (Interrupted | Failed, Validating)
        );
        if valid {
            Ok(to)
        } else {
            Err(DomainError::InvalidTransition { from: self, to })
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Read,
    Write,
    Shell,
    Network,
    Publish,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Permissions {
    /// Repository ID to explicit relative path prefixes. `.` means the repository.
    pub repositories: BTreeMap<String, Vec<String>>,
    pub operations: Vec<Operation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Budgets {
    pub max_workers: u32,
    pub max_attempts: u32,
    pub timeout_seconds: u64,
    pub cost_usd_micros: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanTask {
    pub id: String,
    pub repository_id: String,
    pub role: String,
    pub depends_on: Vec<String>,
    pub paths: Vec<String>,
    pub operations: Vec<Operation>,
    pub acceptance_criteria: Vec<String>,
    pub execution_profile: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckRecipe {
    pub id: String,
    pub repository_id: String,
    pub executable: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub timeout_seconds: u64,
    pub required: bool,
    pub capabilities: Vec<String>,
    pub execution_profile: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanRevision {
    pub schema_version: String,
    pub canonicalization: String,
    pub id: String,
    pub revision: u64,
    pub project_id: String,
    pub ticket_id: String,
    pub ticket_revision: u64,
    pub manifest_hash: String,
    pub base_commits: BTreeMap<String, String>,
    /// If this plan repairs an existing candidate, bind that exact identity too.
    pub candidate_hash: Option<String>,
    pub permissions: Permissions,
    pub tasks: Vec<PlanTask>,
    pub required_checks: Vec<CheckRecipe>,
    pub budgets: Budgets,
    /// Explicit, hash-bound component references. Absence preserves old plan hashes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component_context: Option<ComponentContext>,
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComponentContext {
    pub memory: Vec<MemoryReference>,
    pub prompt: Option<ApprovedPrompt>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryReference {
    pub id: String,
    pub scope: String,
    pub hash: String,
    pub content: String,
    pub provenance: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApprovedPrompt {
    pub name: String,
    pub version: u64,
    pub hash: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PromptReference {
    pub name: String,
    pub version: u64,
    pub hash: String,
}

impl PlanRevision {
    /// luuna-json-v1 recursively sorts object keys, uses JSON integer/string
    /// encoding, preserves array order and Unicode bytes, and omits only `hash`.
    /// Inputs must already be normalized; no lossy path/Unicode normalization.
    pub fn computed_hash(&self) -> Result<String, DomainError> {
        let mut value = serde_json::to_value(self)?;
        value
            .as_object_mut()
            .expect("plan is an object")
            .remove("hash");
        hash_value(&value)
    }

    pub fn seal(mut self) -> Result<Self, DomainError> {
        self.validate_payload()?;
        self.hash = self.computed_hash()?;
        Ok(self)
    }

    pub fn validate(&self) -> Result<(), DomainError> {
        self.validate_payload()?;
        if self.hash != self.computed_hash()? {
            return Err(DomainError::Invalid(
                "plan hash does not match payload".into(),
            ));
        }
        Ok(())
    }

    fn validate_payload(&self) -> Result<(), DomainError> {
        if let Some(context) = &self.component_context {
            let mut ids = std::collections::BTreeSet::new();
            if context.memory.len() > 16
                || context.memory.iter().any(|memory| {
                    memory.id.is_empty()
                        || !ids.insert(memory.id.clone())
                        || !is_hash(&memory.hash)
                        || memory.content.trim().is_empty()
                        || memory.provenance.trim().is_empty()
                        || memory.provenance.len() > 1000
                        || !matches!(memory.scope.as_str(), "project" | "process" | "user")
                })
                || context.prompt.as_ref().is_some_and(|prompt| {
                    prompt.name.is_empty()
                        || prompt.version == 0
                        || !is_hash(&prompt.hash)
                        || prompt.body.trim().is_empty()
                })
                || serde_json::to_vec(context)?.len() > 16_000
            {
                return invalid("invalid or duplicated approved component resources");
            }
        }
        if self.schema_version != SCHEMA_VERSION || self.canonicalization != CANONICALIZATION {
            return invalid("unsupported schema or canonicalization version");
        }
        if self.id.is_empty()
            || self.project_id.is_empty()
            || self.ticket_id.is_empty()
            || self.revision == 0
            || self.ticket_revision == 0
        {
            return invalid("plan and ticket identities and positive revisions are required");
        }
        if !is_hash(&self.manifest_hash)
            || self.candidate_hash.as_deref().is_some_and(|h| !is_hash(h))
        {
            return invalid("invalid manifest or candidate hash");
        }
        if self.base_commits.is_empty()
            || self
                .base_commits
                .iter()
                .any(|(id, commit)| id.is_empty() || !is_commit(commit))
        {
            return invalid("nonempty repository scope and exact commits are required");
        }
        if self.permissions.repositories.keys().collect::<Vec<_>>()
            != self.base_commits.keys().collect::<Vec<_>>()
        {
            return invalid("permission repositories must equal base commit scope");
        }
        if self.permissions.operations.is_empty() || !unique(&self.permissions.operations) {
            return invalid("operations must be nonempty and unique");
        }
        // Task paths first: permissions default to them, so a malformed entry is
        // reported against the field the client actually wrote.
        for task in &self.tasks {
            for path in &task.paths {
                if let Some(problem) = scope_path_problem(path) {
                    return Err(DomainError::Invalid(format!(
                        "task {} path {path:?} {problem}",
                        task.id
                    )));
                }
            }
        }
        for (repository, paths) in &self.permissions.repositories {
            if paths.is_empty() || !unique(paths) {
                return invalid("permission paths must be nonempty and unique");
            }
            for path in paths {
                if let Some(problem) = scope_path_problem(path) {
                    return Err(DomainError::Invalid(format!(
                        "permission path {path:?} for repository {repository} {problem}"
                    )));
                }
            }
        }
        let budgets = &self.budgets;
        if budgets.max_workers != 1 {
            return invalid("budgets.max_workers must be exactly 1");
        }
        if !(1..=MAX_PLAN_ATTEMPTS).contains(&budgets.max_attempts) {
            return Err(DomainError::Invalid(format!(
                "budgets.max_attempts must be between 1 and {MAX_PLAN_ATTEMPTS}"
            )));
        }
        if !(1..=MAX_PLAN_TIMEOUT_SECONDS).contains(&budgets.timeout_seconds) {
            return Err(DomainError::Invalid(format!(
                "budgets.timeout_seconds must be between 1 and {MAX_PLAN_TIMEOUT_SECONDS}"
            )));
        }
        // Zero cost is refused rather than defined: a new model stage needs
        // remaining budget, so a zero-cost plan could never be validated.
        if !(1..=MAX_PLAN_COST_USD_MICROS).contains(&budgets.cost_usd_micros) {
            return Err(DomainError::Invalid(format!(
                "budgets.cost_usd_micros must be between 1 and {MAX_PLAN_COST_USD_MICROS}"
            )));
        }
        if self.tasks.is_empty() {
            return invalid("at least one task is required");
        }
        let mut ids = BTreeSet::new();
        for task in &self.tasks {
            if task.id.is_empty() || !ids.insert(&task.id) {
                return invalid("duplicate or empty task ID");
            }
            let Some(allowed_paths) = self.permissions.repositories.get(&task.repository_id) else {
                return invalid("task references unknown repository");
            };
            if task.role.is_empty()
                || task.execution_profile.is_empty()
                || task.acceptance_criteria.is_empty()
                || task.acceptance_criteria.iter().any(|s| s.is_empty())
                || task.paths.is_empty()
                || task.paths.iter().any(|p| {
                    scope_path_problem(p).is_some()
                        || !allowed_paths.iter().any(|prefix| path_within(p, prefix))
                })
                || task.operations.is_empty()
                || !unique(&task.operations)
                || task
                    .operations
                    .iter()
                    .any(|op| !self.permissions.operations.contains(op))
            {
                return invalid("task exceeds permissions or omits executable requirements");
            }
        }
        let mut complete = BTreeSet::new();
        while complete.len() < self.tasks.len() {
            let before = complete.len();
            for task in &self.tasks {
                if task.depends_on.iter().all(|id| complete.contains(id)) {
                    complete.insert(task.id.clone());
                }
            }
            if complete.len() == before {
                return invalid("task dependencies contain a cycle or unknown ID");
            }
        }
        if self.required_checks.is_empty() || !self.required_checks.iter().any(|c| c.required) {
            return invalid("at least one required check is necessary");
        }
        let mut checks = BTreeSet::new();
        for check in &self.required_checks {
            if check.id.is_empty()
                || !checks.insert(&check.id)
                || !self.base_commits.contains_key(&check.repository_id)
                || check.executable.is_empty()
                || !valid_relative_path(&check.cwd)
                || check.timeout_seconds == 0
                || check.execution_profile.is_empty()
            {
                return invalid("invalid check recipe or repository");
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Approval {
    pub schema_version: String,
    pub id: String,
    pub plan_id: String,
    pub plan_revision: u64,
    pub plan_hash: String,
    pub approved_by: String,
    pub approved_at: String,
    pub permissions: Permissions,
}

impl Approval {
    pub fn authorize(&self, plan: &PlanRevision) -> Result<(), DomainError> {
        plan.validate()?;
        if self.schema_version != SCHEMA_VERSION
            || self.id.is_empty()
            || self.approved_by.is_empty()
            || self.approved_at.is_empty()
            || self.plan_id != plan.id
            || self.plan_revision != plan.revision
            || self.plan_hash != plan.hash
            || self.permissions != plan.permissions
        {
            return Err(DomainError::StaleApproval);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateSet {
    pub schema_version: String,
    pub id: String,
    pub revision: u64,
    pub plan_hash: String,
    pub repository_commits: BTreeMap<String, String>,
    pub dependency_bindings: BTreeMap<String, String>,
    pub hash: String,
}

impl CandidateSet {
    pub fn computed_hash(&self) -> Result<String, DomainError> {
        let mut value = serde_json::to_value(self)?;
        value
            .as_object_mut()
            .expect("candidate object")
            .remove("hash");
        hash_value(&value)
    }
    pub fn validate(&self) -> Result<(), DomainError> {
        if self.schema_version != SCHEMA_VERSION
            || self.id.is_empty()
            || self.revision == 0
            || !is_hash(&self.plan_hash)
            || self.repository_commits.is_empty()
            || self
                .repository_commits
                .iter()
                .any(|(id, c)| id.is_empty() || !is_commit(c))
            || self.hash != self.computed_hash()?
        {
            return invalid("invalid candidate identity");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Assignment {
    pub schema_version: String,
    pub id: String,
    pub task_id: String,
    pub plan_hash: String,
    pub role: String,
    pub repository_id: String,
    pub environment_id: String,
    pub context_manifest: Vec<String>,
    pub tool_profile: String,
}

impl Assignment {
    pub fn validate_for(&self, plan: &PlanRevision) -> Result<(), DomainError> {
        plan.validate()?;
        let task = plan
            .tasks
            .iter()
            .find(|task| task.id == self.task_id)
            .ok_or_else(|| DomainError::Invalid("assignment references unknown task".into()))?;
        if self.schema_version != SCHEMA_VERSION
            || self.id.is_empty()
            || self.plan_hash != plan.hash
            || self.role != task.role
            || self.repository_id != task.repository_id
            || self.environment_id.is_empty()
            || self.context_manifest.is_empty()
            || self.context_manifest.iter().any(|s| s.is_empty())
            || self.tool_profile.is_empty()
        {
            return invalid("assignment does not match plan task or required execution context");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Info,
    Warning,
    Blocking,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Finding {
    pub severity: Severity,
    pub path: String,
    pub line: u64,
    pub explanation: String,
    pub evidence: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewVerdict {
    Passed,
    ChangesRequired,
    Blocked,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewResult {
    pub schema_version: String,
    pub id: String,
    pub candidate_hash: String,
    pub reviewer_session: String,
    pub findings: Vec<Finding>,
    pub verdict: ReviewVerdict,
    pub evidence: Vec<String>,
}
impl ReviewResult {
    pub fn validate_for(
        &self,
        candidate: &CandidateSet,
        implementer_session: &str,
    ) -> Result<(), DomainError> {
        candidate.validate()?;
        if self.schema_version != SCHEMA_VERSION
            || self.id.is_empty()
            || self.candidate_hash != candidate.hash
            || self.reviewer_session.is_empty()
            || self.reviewer_session == implementer_session
        {
            return invalid("review must independently match the exact candidate and findings");
        }
        self.check_contract()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicationState {
    Pending,
    Pushing,
    PrOpen,
    Failed,
    Integrated,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Publication {
    pub schema_version: String,
    pub ticket_id: String,
    pub candidate_hash: String,
    pub per_repository_branch: BTreeMap<String, String>,
    pub pull_request_urls: BTreeMap<String, String>,
    pub publication_state: PublicationState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventEnvelope {
    pub schema_version: String,
    pub event_id: String,
    pub sequence: u64,
    pub timestamp: String,
    pub project_id: String,
    pub run_id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub payload: serde_json::Value,
}

pub(crate) fn invalid<T>(message: &str) -> Result<T, DomainError> {
    Err(DomainError::Invalid(message.into()))
}
pub(crate) fn unique<T: Ord>(values: &[T]) -> bool {
    values.iter().collect::<BTreeSet<_>>().len() == values.len()
}
pub(crate) fn valid_relative_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains(':')
        && !path.bytes().any(|byte| byte < 32 || byte == 127)
        && path.split('/').all(|part| !part.is_empty() && part != "..")
}
/// Why `path` cannot be an approved scope path (a task path or permission
/// prefix), or `None` when it is canonical. Scope is compared as plain strings
/// with the paths Git reports, so each location has exactly one spelling: `.`
/// alone is the whole repository, and no component may be `.`, `..`, empty or
/// Git's repository metadata.
pub fn scope_path_problem(path: &str) -> Option<&'static str> {
    if path == "." {
        return None;
    }
    if path.is_empty() {
        return Some("must not be empty");
    }
    if path.starts_with('/') || path.contains('\\') {
        return Some("must be relative to the repository root and use '/' separators");
    }
    if path.contains(':') || path.bytes().any(|byte| byte < 32 || byte == 127) {
        return Some("must not contain ':' or control characters");
    }
    let parts: Vec<&str> = path.split('/').collect();
    if parts.iter().any(|part| part.is_empty()) {
        return Some("must not contain empty components or a trailing '/'");
    }
    if parts.contains(&"..") {
        return Some("must not contain '..' components");
    }
    if parts.contains(&".") {
        return Some("must not contain '.' components (write \"src\", not \"./src\" or \"src/.\")");
    }
    if parts.iter().any(|part| is_repository_metadata(part)) {
        return Some("must not name repository metadata (.git)");
    }
    None
}
/// Whether one path component reaches Git's repository metadata as a
/// filesystem may resolve it: `.git` in any ASCII case, with the trailing dots
/// or spaces Windows ignores or an NTFS stream suffix, or its `GIT~1` short name.
pub fn is_repository_metadata(component: &str) -> bool {
    let name = component.split(':').next().unwrap_or(component);
    let name = name.trim_end_matches(['.', ' ']).to_ascii_lowercase();
    name == ".git" || name == "git~1"
}
pub(crate) fn path_within(path: &str, prefix: &str) -> bool {
    prefix == "."
        || path == prefix
        || path
            .strip_prefix(prefix)
            .is_some_and(|p| p.starts_with('/'))
}
pub(crate) fn is_commit(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub(crate) fn is_hash(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
/// Canonical luuna-json-v1 content identity, shared by runtime resource bindings.
pub fn hash_value(value: &serde_json::Value) -> Result<String, DomainError> {
    fn sorted(value: &serde_json::Value) -> serde_json::Value {
        match value {
            serde_json::Value::Object(map) => {
                let entries: BTreeMap<_, _> =
                    map.iter().map(|(k, v)| (k.clone(), sorted(v))).collect();
                serde_json::to_value(entries).expect("JSON object serialization")
            }
            serde_json::Value::Array(a) => serde_json::Value::Array(a.iter().map(sorted).collect()),
            other => other.clone(),
        }
    }
    let bytes = serde_json::to_vec(&sorted(value))?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn plan() -> PlanRevision {
        serde_json::from_str(include_str!("../../../fixtures/domain/plan.valid.json")).unwrap()
    }
    #[test]
    fn approved_component_bytes_are_part_of_the_plan_hash() {
        let mut plan = plan();
        plan.component_context = Some(ComponentContext {
            memory: vec![MemoryReference {
                id: "mem-1".into(),
                scope: "project".into(),
                hash: format!("sha256:{}", "1".repeat(64)),
                content: "Selected content".into(),
                provenance: "Explicit fixture".into(),
            }],
            prompt: Some(ApprovedPrompt {
                name: "guidance".into(),
                version: 1,
                hash: format!("sha256:{}", "2".repeat(64)),
                body: "Selected guidance".into(),
            }),
        });
        let sealed = plan.seal().unwrap();
        let mut changed = sealed.clone();
        changed.component_context.as_mut().unwrap().memory[0]
            .content
            .push('!');
        assert_ne!(
            sealed.computed_hash().unwrap(),
            changed.computed_hash().unwrap()
        );
        assert!(changed.validate().is_err());
        let mut changed = sealed.clone();
        changed
            .component_context
            .as_mut()
            .unwrap()
            .prompt
            .as_mut()
            .unwrap()
            .body
            .push('!');
        assert!(changed.validate().is_err());
    }

    fn approval(plan: &PlanRevision) -> Approval {
        Approval {
            schema_version: SCHEMA_VERSION.into(),
            id: "approval-1".into(),
            plan_id: plan.id.clone(),
            plan_revision: plan.revision,
            plan_hash: plan.hash.clone(),
            approved_by: "human".into(),
            approved_at: "2026-10-16T00:00:00Z".into(),
            permissions: plan.permissions.clone(),
        }
    }
    #[test]
    fn fixture_plan_hash_matches() {
        plan().validate().unwrap();
    }
    #[test]
    fn rejects_invalid_transitions_and_terminal_restarts() {
        assert!(RunState::PlanReady
            .transition(RunState::Implementing)
            .is_err());
        assert!(RunState::Queued.transition(RunState::Completed).is_err());
        assert!(RunState::Completed.transition(RunState::Running).is_err());
        assert_eq!(
            RunState::Running.transition(RunState::Cancelled).unwrap(),
            RunState::Cancelled
        );
        // A fresh validation generation may follow an interrupted or failed
        // stage; paused, cancelled and reviewed candidates never re-enter it.
        assert!(RunState::Failed.transition(RunState::Validating).is_ok());
        assert!(RunState::Interrupted
            .transition(RunState::Validating)
            .is_ok());
        for state in [
            RunState::Paused,
            RunState::Cancelled,
            RunState::Reviewed,
            RunState::TestingBlocked,
        ] {
            assert!(state.transition(RunState::Validating).is_err(), "{state:?}");
        }
    }
    #[test]
    fn permissions_candidate_and_checks_are_hash_bound() {
        let original = plan();
        let mut changed = original.clone();
        changed.permissions.operations.push(Operation::Network);
        assert_ne!(original.hash, changed.computed_hash().unwrap());
        changed = original.clone();
        changed.base_commits.insert("app".into(), "b".repeat(40));
        assert_ne!(original.hash, changed.computed_hash().unwrap());
        changed = original.clone();
        changed.candidate_hash = Some(format!("sha256:{}", "c".repeat(64)));
        assert_ne!(original.hash, changed.computed_hash().unwrap());
        changed = original.clone();
        changed.required_checks[0].args.push("--ignored".into());
        assert_ne!(original.hash, changed.computed_hash().unwrap());
    }
    #[test]
    fn rejects_stale_revision_and_material_reapproval() {
        let original = plan();
        let approval = approval(&original);
        approval.authorize(&original).unwrap();
        let mut changed = original;
        changed.revision += 1;
        let changed = changed.seal().unwrap();
        assert!(matches!(
            approval.authorize(&changed),
            Err(DomainError::StaleApproval)
        ));
    }
    #[test]
    fn denies_permission_escalation_in_approval() {
        let plan = plan();
        let mut approval = approval(&plan);
        approval.permissions.operations.push(Operation::Publish);
        assert!(approval.authorize(&plan).is_err());
    }
    #[test]
    fn rejects_unknown_repositories_cycles_and_escape_paths() {
        let mut unknown = plan();
        unknown.tasks[0].repository_id = "other".into();
        assert!(unknown.seal().is_err());
        let mut cycle = plan();
        cycle.tasks[0].depends_on = vec![cycle.tasks[0].id.clone()];
        assert!(cycle.seal().is_err());
        let mut escape = plan();
        escape.tasks[0].paths = vec!["src/../../secret".into()];
        assert!(escape.seal().is_err());
        let mut sibling = plan();
        sibling
            .permissions
            .repositories
            .insert("app".into(), vec!["src".into()]);
        sibling.tasks[0].paths = vec!["src-escape".into()];
        assert!(sibling.seal().is_err());
    }
    #[test]
    fn scope_paths_have_one_canonical_spelling_and_never_name_repository_metadata() {
        for good in [
            ".",
            "src",
            "src/main.py",
            "docs/a b.md",
            ".github/workflows",
            "a.git",
        ] {
            let mut plan = plan();
            plan.permissions
                .repositories
                .insert("app".into(), vec![good.into()]);
            plan.tasks[0].paths = vec![good.into()];
            plan.seal().unwrap_or_else(|e| panic!("{good}: {e}"));
        }
        for bad in [
            "./src",
            "src/.",
            "a/./b",
            "src/",
            "src//x",
            "/src",
            "a\\b",
            "a:b",
            "",
            "..",
            ".git",
            "src/.git/x",
            ".GIT",
            ".git.",
            ".git ",
            "Git~1",
            "src/.Git/config",
        ] {
            // Permissions default to the task paths, so the error names the task.
            let mut plan = plan();
            plan.permissions
                .repositories
                .insert("app".into(), vec![bad.into()]);
            plan.tasks[0].paths = vec![bad.into()];
            let error = plan.seal().unwrap_err().to_string();
            assert!(
                error.contains(&format!("task implement path {bad:?}")),
                "{bad}: {error}"
            );
            let mut plan = self::plan();
            plan.permissions
                .repositories
                .insert("app".into(), vec![bad.into()]);
            let error = plan.seal().unwrap_err().to_string();
            assert!(
                error.contains(&format!("permission path {bad:?} for repository app")),
                "{bad}: {error}"
            );
        }
        for metadata in [
            ".git",
            ".GIT",
            ".git.",
            ".git ",
            "git~1",
            ".git::$INDEX_ALLOCATION",
        ] {
            assert!(is_repository_metadata(metadata), "{metadata}");
        }
        for ordinary in [".gitignore", ".github", "git", ".", "..", "a.git"] {
            assert!(!is_repository_metadata(ordinary), "{ordinary}");
        }
    }
    #[test]
    fn budgets_are_bounded_and_named_when_refused() {
        let at_limits = |edit: fn(&mut Budgets)| {
            let mut plan = plan();
            edit(&mut plan.budgets);
            plan.seal()
        };
        at_limits(|b| {
            b.max_attempts = MAX_PLAN_ATTEMPTS;
            b.timeout_seconds = MAX_PLAN_TIMEOUT_SECONDS;
            b.cost_usd_micros = MAX_PLAN_COST_USD_MICROS;
        })
        .unwrap();
        at_limits(|b| {
            b.max_attempts = 1;
            b.timeout_seconds = 1;
            b.cost_usd_micros = 1;
        })
        .unwrap();
        for (edit, field) in [
            (
                (|b: &mut Budgets| b.max_workers = 0) as fn(&mut Budgets),
                "budgets.max_workers",
            ),
            (|b| b.max_workers = 2, "budgets.max_workers"),
            (
                |b| b.max_attempts = 0,
                "budgets.max_attempts must be between 1 and 10",
            ),
            (
                |b| b.max_attempts = 11,
                "budgets.max_attempts must be between 1 and 10",
            ),
            (
                |b| b.timeout_seconds = 0,
                "budgets.timeout_seconds must be between 1 and 86400",
            ),
            (|b| b.timeout_seconds = 86_401, "budgets.timeout_seconds"),
            (|b| b.timeout_seconds = u64::MAX, "budgets.timeout_seconds"),
            (
                |b| b.cost_usd_micros = 0,
                "budgets.cost_usd_micros must be between 1 and 1000000000",
            ),
            (
                |b| b.cost_usd_micros = 1_000_000_001,
                "budgets.cost_usd_micros",
            ),
        ] {
            let error = at_limits(edit).unwrap_err().to_string();
            assert!(error.contains(field), "{field}: {error}");
        }
    }
    #[test]
    fn object_key_order_is_irrelevant_but_array_order_is_not() {
        let a = serde_json::json!({"z": {"b":2,"a":1}, "a":[1,2]});
        let b: serde_json::Value =
            serde_json::from_str(r#"{"a":[1,2],"z":{"a":1,"b":2}}"#).unwrap();
        assert_eq!(hash_value(&a).unwrap(), hash_value(&b).unwrap());
        assert_ne!(
            hash_value(&a).unwrap(),
            hash_value(&serde_json::json!({"a":[2,1],"z":{"a":1,"b":2}})).unwrap()
        );
    }
    #[test]
    fn model_claims_do_not_advance_domain_state() {
        let _: EventEnvelope = serde_json::from_value(serde_json::json!({"schema_version":"0.1", "event_id":"e", "sequence":1,
            "timestamp":"2026-10-16T00:00:00Z", "project_id":"p", "run_id":"r", "type":"worker.output", "payload":{"text":"all tests passed"}})).unwrap();
        assert!(RunState::Running.transition(RunState::Reviewed).is_err());
    }

    #[test]
    fn candidate_changes_invalidate_review_and_blocking_findings_cannot_pass() {
        let mut candidate: CandidateSet = serde_json::from_str(include_str!(
            "../../../fixtures/domain/candidate.valid.json"
        ))
        .unwrap();
        let mut review: ReviewResult =
            serde_json::from_str(include_str!("../../../fixtures/domain/review.valid.json"))
                .unwrap();
        review.validate_for(&candidate, "implementer-1").unwrap();
        assert!(review
            .validate_for(&candidate, &review.reviewer_session)
            .is_err());
        candidate
            .dependency_bindings
            .insert("app->api".into(), "api-v2".into());
        candidate.hash = candidate.computed_hash().unwrap();
        assert!(review.validate_for(&candidate, "implementer-1").is_err());
        review.candidate_hash = candidate.hash.clone();
        review.findings.push(Finding {
            severity: Severity::Blocking,
            path: "src/main.rs".into(),
            line: 1,
            explanation: "Known regression".into(),
            evidence: vec!["artifact:failed.log".into()],
        });
        assert!(review.validate_for(&candidate, "implementer-1").is_err());
        review.verdict = ReviewVerdict::ChangesRequired;
        review.validate_for(&candidate, "implementer-1").unwrap();
    }

    #[test]
    fn assignment_requires_matching_plan_task_and_repository() {
        let plan = plan();
        let mut assignment: Assignment = serde_json::from_str(include_str!(
            "../../../fixtures/domain/assignment.valid.json"
        ))
        .unwrap();
        assignment.validate_for(&plan).unwrap();
        assignment.repository_id = "outside-scope".into();
        assert!(assignment.validate_for(&plan).is_err());
    }
}
