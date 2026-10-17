//! Candidate-bound validation and independent review evidence (M3).
use crate::{invalid, is_commit, CandidateSet, CheckResult, DomainError, ReviewResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateStatus {
    Pending,
    Validating,
    Reviewing,
    Reviewed,
    Failed,
    TestingBlocked,
    Paused,
    Cancelled,
    Interrupted,
}

/// One immutable candidate identity plus append-only check/review evidence.
/// Usage is measured by the runtime and survives every retry and restart.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateEvidence {
    pub candidate: CandidateSet,
    pub run_id: String,
    pub implementer_session: String,
    pub repository_trees: BTreeMap<String, String>,
    pub status: CandidateStatus,
    pub validation_generation: u64,
    pub results: Vec<CheckResult>,
    pub review: Option<ReviewResult>,
    pub elapsed_seconds: u64,
    pub cost_usd_micros: u64,
    /// Recovery checkpoints for work consumed since the last durable charge.
    pub stage_started_at: Option<String>,
    pub stage_start_elapsed_seconds: u64,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl CandidateEvidence {
    pub fn validate(&self) -> Result<(), DomainError> {
        self.candidate.validate()?;
        if self.run_id.is_empty()
            || self.implementer_session.is_empty()
            || self.started_at.is_empty()
            || self.repository_trees.keys().collect::<Vec<_>>()
                != self.candidate.repository_commits.keys().collect::<Vec<_>>()
            || self.repository_trees.values().any(|tree| !is_commit(tree))
        {
            return invalid(
                "candidate evidence requires exact repository trees and writer session",
            );
        }
        for result in &self.results {
            result.validate()?;
            if result.run_id != self.run_id
                || result.candidate_hash != self.candidate.hash
                || self.candidate.repository_commits.get(&result.repository_id)
                    != Some(&result.commit)
            {
                return invalid("check result is not bound to this candidate");
            }
        }
        if let Some(review) = &self.review {
            review.validate_for(&self.candidate, &self.implementer_session)?;
        }
        Ok(())
    }
}
