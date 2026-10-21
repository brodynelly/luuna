//! Candidate-bound validation and independent review evidence (M3).
use crate::{
    invalid, is_commit, valid_relative_path, CandidateSet, CheckResult, DomainError, ReviewResult,
    ReviewVerdict, Severity,
};
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
    /// The owned worktree stopped holding this frozen candidate (a tracked
    /// edit, a moved HEAD, a missing worktree) during the current generation.
    /// Such a candidate is never re-validated in place: repair or re-plan.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub content_drift: bool,
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

/// Largest line number a review finding may name.
pub const MAX_REVIEW_LINE: u64 = 10_000_000;
/// Longest finding path, in bytes.
pub const MAX_REVIEW_PATH_BYTES: usize = 4096;
/// Longest explanation or evidence string, in bytes.
pub const MAX_REVIEW_TEXT_BYTES: usize = 16 * 1024;

/// Non-empty text of bounded size without control characters other than
/// line breaks and tabs, so stored findings cannot carry terminal escapes.
fn review_text(text: &str) -> bool {
    !text.trim().is_empty()
        && text.len() <= MAX_REVIEW_TEXT_BYTES
        && !text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
}

impl ReviewResult {
    /// The review-result contract beyond identity: top-level evidence, each
    /// finding's relative path, line, explanation and evidence, and a verdict
    /// consistent with its findings. A passing review cannot carry a blocking
    /// finding, and `changes_required` or `blocked` must name at least one
    /// finding. Output that breaks this is an invalid review: no verdict.
    pub(crate) fn check_contract(&self) -> Result<(), DomainError> {
        if self.evidence.is_empty() || !self.evidence.iter().all(|e| review_text(e)) {
            return invalid("review evidence must be non-empty strings");
        }
        for finding in &self.findings {
            if !valid_relative_path(&finding.path)
                || finding.path.len() > MAX_REVIEW_PATH_BYTES
                || finding.line == 0
                || finding.line > MAX_REVIEW_LINE
                || !review_text(&finding.explanation)
                || finding.evidence.is_empty()
                || !finding.evidence.iter().all(|e| review_text(e))
            {
                return invalid(
                    "every review finding needs a relative path, a line from 1, an explanation and evidence strings",
                );
            }
        }
        match self.verdict {
            ReviewVerdict::Passed
                if self
                    .findings
                    .iter()
                    .any(|f| f.severity == Severity::Blocking) =>
            {
                invalid("a passing review cannot carry a blocking finding")
            }
            ReviewVerdict::ChangesRequired | ReviewVerdict::Blocked if self.findings.is_empty() => {
                invalid("a changes_required or blocked review must name at least one finding")
            }
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Finding;

    fn reviewed() -> (CandidateSet, ReviewResult) {
        let candidate: CandidateSet = serde_json::from_str(include_str!(
            "../../../fixtures/domain/candidate.valid.json"
        ))
        .unwrap();
        let mut review: ReviewResult =
            serde_json::from_str(include_str!("../../../fixtures/domain/review.valid.json"))
                .unwrap();
        review.candidate_hash = candidate.hash.clone();
        (candidate, review)
    }

    fn finding(severity: Severity, path: &str) -> Finding {
        Finding {
            severity,
            path: path.into(),
            line: 3,
            explanation: "Seeded issue".into(),
            evidence: vec!["observed in the diff".into()],
        }
    }

    #[test]
    fn a_non_passing_verdict_must_name_a_finding_and_a_pass_cannot_block() {
        let (candidate, mut review) = reviewed();
        review.validate_for(&candidate, "implementer-1").unwrap();
        for verdict in [ReviewVerdict::ChangesRequired, ReviewVerdict::Blocked] {
            review.verdict = verdict;
            review.findings.clear();
            let error = review
                .validate_for(&candidate, "implementer-1")
                .unwrap_err();
            assert!(
                error.to_string().contains("at least one finding"),
                "{error}"
            );
            review
                .findings
                .push(finding(Severity::Warning, "src/main.py"));
            review.validate_for(&candidate, "implementer-1").unwrap();
        }
        review.verdict = ReviewVerdict::Passed;
        review.findings = vec![finding(Severity::Info, "src/main.py")];
        review.validate_for(&candidate, "implementer-1").unwrap();
        review
            .findings
            .push(finding(Severity::Blocking, "src/main.py"));
        assert!(review.validate_for(&candidate, "implementer-1").is_err());
    }

    #[test]
    fn findings_follow_the_review_result_schema() {
        let (candidate, mut review) = reviewed();
        review.verdict = ReviewVerdict::ChangesRequired;
        for path in [
            "/etc/passwd",
            "../../outside",
            "src/../../outside",
            "C:/repo/main.py",
            "src\\main.py",
            "src/main\u{1b}[31m.py",
            "src//main.py",
            "",
        ] {
            review.findings = vec![finding(Severity::Blocking, path)];
            assert!(
                review.validate_for(&candidate, "implementer-1").is_err(),
                "{path:?}"
            );
        }
        review.findings = vec![finding(Severity::Blocking, "src/main.py")];
        review.validate_for(&candidate, "implementer-1").unwrap();
        for broken in [
            Finding {
                line: MAX_REVIEW_LINE + 1,
                ..finding(Severity::Blocking, "src/main.py")
            },
            Finding {
                line: 0,
                ..finding(Severity::Blocking, "src/main.py")
            },
            Finding {
                evidence: vec!["".into()],
                ..finding(Severity::Blocking, "src/main.py")
            },
            Finding {
                evidence: vec![],
                ..finding(Severity::Blocking, "src/main.py")
            },
            Finding {
                explanation: "red \u{1b}[31m alert".into(),
                ..finding(Severity::Blocking, "src/main.py")
            },
            Finding {
                explanation: "x".repeat(MAX_REVIEW_TEXT_BYTES + 1),
                ..finding(Severity::Blocking, "src/main.py")
            },
        ] {
            review.findings = vec![broken.clone()];
            assert!(
                review.validate_for(&candidate, "implementer-1").is_err(),
                "{broken:?}"
            );
        }
        review.findings = vec![Finding {
            explanation: "first line\nsecond line\twith a tab".into(),
            ..finding(Severity::Blocking, "src/main.py")
        }];
        review.validate_for(&candidate, "implementer-1").unwrap();
        review.evidence = vec![" ".into()];
        assert!(review.validate_for(&candidate, "implementer-1").is_err());
    }
}
