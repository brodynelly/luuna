//! Baseline and check-result evidence contracts (M2b).
//!
//! A check result is deterministic runtime evidence about one recipe execution.
//! It binds to the exact commit and tree, the confirmed manifest and the host
//! environment it ran on. A baseline is the set of required check results for
//! one repository; only a passing baseline whose bindings equal an approved
//! plan's bindings can unlock feature implementation. Worker or model text
//! never produces these records.

use crate::{hash_value, invalid, is_commit, is_hash, DomainError, PlanRevision, SCHEMA_VERSION};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Passed,
    Failed,
    /// Could not run meaningfully: missing executable, incapable host, dirty
    /// checkout, container profile, or an empty suite. Never counts as success.
    Blocked,
    Cancelled,
    Interrupted,
}

/// What a baseline binds to. Its hash is the `candidate_hash` of each check result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BaselineIdentity {
    pub manifest_hash: String,
    pub repository_id: String,
    pub commit: String,
    pub tree: String,
}

impl BaselineIdentity {
    pub fn validate(&self) -> Result<(), DomainError> {
        if !is_hash(&self.manifest_hash)
            || self.repository_id.is_empty()
            || !is_commit(&self.commit)
            || !is_commit(&self.tree)
        {
            return invalid(
                "baseline identity requires manifest hash, repository, commit and tree",
            );
        }
        Ok(())
    }

    pub fn hash(&self) -> Result<String, DomainError> {
        self.validate()?;
        hash_value(&serde_json::to_value(self)?)
    }
}

/// Mirrors `schemas/result.schema.json`; the optional fields are evidence detail.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckResult {
    pub schema_version: String,
    pub id: String,
    pub run_id: String,
    pub repository_id: String,
    pub recipe_id: String,
    pub candidate_hash: String,
    pub commit: String,
    pub environment_fingerprint: String,
    /// Executable followed by its arguments, exactly as spawned.
    pub command: Vec<String>,
    pub status: CheckStatus,
    pub exit_code: Option<i32>,
    pub artifact_refs: Vec<String>,
    #[serde(default)]
    pub cwd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub artifact_hashes: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tests_detected: Option<u64>,
}

impl CheckResult {
    pub fn validate(&self) -> Result<(), DomainError> {
        if self.schema_version != SCHEMA_VERSION
            || self.id.is_empty()
            || self.run_id.is_empty()
            || self.repository_id.is_empty()
            || self.recipe_id.is_empty()
            || self.environment_fingerprint.is_empty()
        {
            return invalid("check result identities and environment fingerprint are required");
        }
        if !is_hash(&self.candidate_hash) || !is_commit(&self.commit) {
            return invalid("check result must bind to an exact candidate hash and commit");
        }
        if self.command.is_empty() || self.command[0].is_empty() {
            return invalid("check result must record the spawned command");
        }
        if self.status == CheckStatus::Passed && self.exit_code != Some(0) {
            return invalid("a passed check must have exit code 0");
        }
        if self.status == CheckStatus::Passed && self.tests_detected == Some(0) {
            return invalid("an empty suite cannot pass");
        }
        if self.artifact_hashes.values().any(|hash| !is_hash(hash)) {
            return invalid("artifact hashes must be sha256 digests");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BaselineStatus {
    Running,
    Passed,
    Failed,
    Blocked,
    Cancelled,
    Interrupted,
}

impl BaselineStatus {
    /// A baseline passes only when every required check passed; the worst
    /// non-passing outcome otherwise, with blocked outranking failed.
    pub fn from_results(results: &[CheckResult], expected: usize) -> Self {
        if results.len() < expected {
            return Self::Interrupted;
        }
        let mut status = Self::Passed;
        for result in results {
            status = match (status, result.status) {
                (_, CheckStatus::Interrupted) => Self::Interrupted,
                (Self::Interrupted, _) => Self::Interrupted,
                (_, CheckStatus::Cancelled) => Self::Cancelled,
                (Self::Cancelled, _) => Self::Cancelled,
                (_, CheckStatus::Blocked) => Self::Blocked,
                (Self::Blocked, _) => Self::Blocked,
                (_, CheckStatus::Failed) => Self::Failed,
                (Self::Failed, _) => Self::Failed,
                (Self::Running, CheckStatus::Passed) | (Self::Passed, CheckStatus::Passed) => {
                    Self::Passed
                }
            };
        }
        status
    }
}

/// The recorded outcome of one repository's required checks at one commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BaselineEvidence {
    pub id: String,
    pub run_id: String,
    pub project_id: String,
    pub manifest_revision: u64,
    pub identity: BaselineIdentity,
    pub environment_fingerprint: String,
    pub status: BaselineStatus,
    pub required_checks: Vec<String>,
    pub results: Vec<CheckResult>,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl BaselineEvidence {
    /// Deterministic gate for entering implementation on one repository: the
    /// baseline passed, binds to the plan's manifest and base commit, and was
    /// produced on the host that will now execute.
    pub fn authorizes(
        &self,
        plan: &PlanRevision,
        repository_id: &str,
        environment_fingerprint: &str,
    ) -> Result<(), DomainError> {
        self.identity.validate()?;
        if self.status != BaselineStatus::Passed {
            return Err(DomainError::BaselineRequired(format!(
                "baseline for {repository_id} is {:?}, not passed",
                self.status
            )));
        }
        if self.identity.repository_id != repository_id {
            return Err(DomainError::BaselineRequired(format!(
                "baseline belongs to {}, not {repository_id}",
                self.identity.repository_id
            )));
        }
        if self.identity.manifest_hash != plan.manifest_hash {
            return Err(DomainError::BaselineRequired(
                "baseline was recorded for a different manifest revision".into(),
            ));
        }
        let Some(base) = plan.base_commits.get(repository_id) else {
            return Err(DomainError::BaselineRequired(format!(
                "plan has no base commit for {repository_id}"
            )));
        };
        if &self.identity.commit != base {
            return Err(DomainError::BaselineRequired(format!(
                "baseline commit {} is not the plan base {base}",
                self.identity.commit
            )));
        }
        if self.environment_fingerprint != environment_fingerprint {
            return Err(DomainError::BaselineRequired(
                "baseline was recorded in a different environment".into(),
            ));
        }
        // Every required recipe needs its own passed result bound to this exact
        // identity; optional results never count either way. The host binding is
        // the baseline's combined fingerprint, checked above; each result carries
        // only its recipe's part.
        let candidate_hash = self.identity.hash()?;
        if self.required_checks.is_empty() {
            return Err(DomainError::BaselineRequired(
                "baseline declares no required check".into(),
            ));
        }
        for required in &self.required_checks {
            let satisfied = self.results.iter().any(|r| {
                r.recipe_id == *required
                    && r.status == CheckStatus::Passed
                    && r.exit_code == Some(0)
                    && r.candidate_hash == candidate_hash
                    && r.commit == self.identity.commit
            });
            if !satisfied {
                return Err(DomainError::BaselineRequired(format!(
                    "baseline lacks a passed result for required check {required} bound to its commit"
                )));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan() -> PlanRevision {
        serde_json::from_str(include_str!("../../../fixtures/domain/plan.valid.json")).unwrap()
    }
    fn identity(plan: &PlanRevision) -> BaselineIdentity {
        BaselineIdentity {
            manifest_hash: plan.manifest_hash.clone(),
            repository_id: "app".into(),
            commit: plan.base_commits["app"].clone(),
            tree: "b".repeat(40),
        }
    }
    fn result(
        identity: &BaselineIdentity,
        status: CheckStatus,
        exit_code: Option<i32>,
    ) -> CheckResult {
        CheckResult {
            schema_version: SCHEMA_VERSION.into(),
            id: "check-1".into(),
            run_id: "baseline-run".into(),
            repository_id: "app".into(),
            recipe_id: "unit".into(),
            candidate_hash: identity.hash().unwrap(),
            commit: identity.commit.clone(),
            environment_fingerprint: format!("sha256:{}", "e".repeat(64)),
            command: vec!["cargo".into(), "test".into()],
            status,
            exit_code,
            artifact_refs: vec!["artifact:baseline-run:unit:stdout".into()],
            cwd: ".".into(),
            started_at: None,
            finished_at: None,
            reason: None,
            artifact_hashes: BTreeMap::new(),
            tests_detected: Some(3),
        }
    }
    fn evidence(
        plan: &PlanRevision,
        results: Vec<CheckResult>,
        status: BaselineStatus,
    ) -> BaselineEvidence {
        BaselineEvidence {
            id: "baseline-1".into(),
            run_id: "baseline-run".into(),
            project_id: plan.project_id.clone(),
            manifest_revision: 1,
            identity: identity(plan),
            environment_fingerprint: format!("sha256:{}", "e".repeat(64)),
            status,
            required_checks: vec!["unit".into()],
            results,
            started_at: "2026-10-17T00:00:00.000Z".into(),
            finished_at: None,
            reason: None,
        }
    }

    #[test]
    fn passed_results_need_exit_zero_and_a_nonempty_suite() {
        let plan = plan();
        let id = identity(&plan);
        result(&id, CheckStatus::Passed, Some(0))
            .validate()
            .unwrap();
        assert!(result(&id, CheckStatus::Passed, Some(1))
            .validate()
            .is_err());
        assert!(result(&id, CheckStatus::Passed, None).validate().is_err());
        let mut empty = result(&id, CheckStatus::Passed, Some(0));
        empty.tests_detected = Some(0);
        assert!(empty.validate().is_err());
        result(&id, CheckStatus::Blocked, None).validate().unwrap();
        result(&id, CheckStatus::Failed, Some(101))
            .validate()
            .unwrap();
        let mut unbound = result(&id, CheckStatus::Passed, Some(0));
        unbound.candidate_hash = "not-a-hash".into();
        assert!(unbound.validate().is_err());
    }

    #[test]
    fn baseline_status_aggregates_worst_outcome_and_missing_results() {
        let plan = plan();
        let id = identity(&plan);
        let pass = result(&id, CheckStatus::Passed, Some(0));
        let fail = result(&id, CheckStatus::Failed, Some(1));
        let blocked = result(&id, CheckStatus::Blocked, None);
        assert_eq!(
            BaselineStatus::from_results(std::slice::from_ref(&pass), 1),
            BaselineStatus::Passed
        );
        assert_eq!(
            BaselineStatus::from_results(&[pass.clone(), fail.clone()], 2),
            BaselineStatus::Failed
        );
        assert_eq!(
            BaselineStatus::from_results(&[fail, blocked], 2),
            BaselineStatus::Blocked
        );
        assert_eq!(
            BaselineStatus::from_results(&[pass], 2),
            BaselineStatus::Interrupted
        );
        assert_eq!(BaselineStatus::from_results(&[], 0), BaselineStatus::Passed);
    }

    #[test]
    fn only_a_matching_passed_baseline_authorizes_implementation() {
        let plan = plan();
        let id = identity(&plan);
        let fingerprint = format!("sha256:{}", "e".repeat(64));
        let good = evidence(
            &plan,
            vec![result(&id, CheckStatus::Passed, Some(0))],
            BaselineStatus::Passed,
        );
        good.authorizes(&plan, "app", &fingerprint).unwrap();
        assert!(matches!(
            good.authorizes(&plan, "app", "sha256:other"),
            Err(DomainError::BaselineRequired(_))
        ));
        assert!(good.authorizes(&plan, "other", &fingerprint).is_err());
        let mut stale_commit = good.clone();
        stale_commit.identity.commit = "c".repeat(40);
        assert!(stale_commit.authorizes(&plan, "app", &fingerprint).is_err());
        let mut stale_manifest = good.clone();
        stale_manifest.identity.manifest_hash = format!("sha256:{}", "d".repeat(64));
        assert!(stale_manifest
            .authorizes(&plan, "app", &fingerprint)
            .is_err());
        let failed = evidence(
            &plan,
            vec![result(&id, CheckStatus::Failed, Some(1))],
            BaselineStatus::Failed,
        );
        assert!(failed.authorizes(&plan, "app", &fingerprint).is_err());
        let mut lying = good.clone();
        lying.results[0].status = CheckStatus::Failed;
        assert!(lying.authorizes(&plan, "app", &fingerprint).is_err());
        let mut incomplete = good.clone();
        incomplete.required_checks.push("lint".into());
        assert!(incomplete.authorizes(&plan, "app", &fingerprint).is_err());
        // An unrelated passed result cannot stand in for a missing required one.
        let mut substituted = incomplete.clone();
        let mut extra = result(&id, CheckStatus::Passed, Some(0));
        extra.recipe_id = "docs".into();
        substituted.results.push(extra);
        assert!(substituted.authorizes(&plan, "app", &fingerprint).is_err());
        // A failed optional recipe does not withhold authorization.
        let mut optional_failed = good.clone();
        let mut optional = result(&id, CheckStatus::Failed, Some(1));
        optional.recipe_id = "bench".into();
        optional_failed.results.push(optional);
        optional_failed
            .authorizes(&plan, "app", &fingerprint)
            .unwrap();
        // A required result recorded against another commit or identity is not evidence.
        let mut other_commit = good.clone();
        other_commit.results[0].commit = "c".repeat(40);
        assert!(other_commit.authorizes(&plan, "app", &fingerprint).is_err());
        let mut other_identity = good;
        other_identity.results[0].candidate_hash = format!("sha256:{}", "f".repeat(64));
        assert!(other_identity
            .authorizes(&plan, "app", &fingerprint)
            .is_err());
    }
}
