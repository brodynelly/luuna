//! Failure explanations (formerly packages/api-client/src/failures.ts, shared with the desktop):
//! the runtime decides every state, permission, reason and next step; this only turns a failure
//! into the developer-facing sentence `<Action> refused: <reason> <next step>`. Each pattern is a
//! hand-port of the original regular expression, matched on the lowercased reason.
use crate::js::J;

/// Why a request or a command did not produce a result. The variants mirror the JavaScript error
/// classes the original client distinguished, because each describes itself differently.
#[derive(Clone, Debug, PartialEq)]
pub enum Failure {
    /// An HTTP status the runtime answered with (`ApiError`).
    Api {
        status: u16,
        message: String,
        from_runtime: bool,
        prerequisite: Option<J>,
    },
    /// No answer: the transport failed, or a response lacked a field the command reads (`TypeError`).
    Type(String),
    /// The request was abandoned before the runtime answered (`AbortError`).
    Aborted,
    /// A problem with the command line itself: exit code 2 (`UsageError`).
    Usage(String),
    /// The client declined to send the request (`ClientRefusal`).
    Refusal(String),
    /// Any other error with its message (`Error`, including JSON syntax errors).
    Error(String),
    /// A bridge protocol failure with its code (bridge only).
    Protocol { code: String, message: String },
}

impl Failure {
    pub fn error(message: impl Into<String>) -> Self {
        Failure::Error(message.into())
    }
    pub fn type_error() -> Self {
        Failure::Type("Cannot read properties of undefined".into())
    }
    pub fn message(&self) -> String {
        match self {
            Failure::Api { message, .. }
            | Failure::Type(message)
            | Failure::Usage(message)
            | Failure::Refusal(message)
            | Failure::Error(message) => message.clone(),
            Failure::Protocol { message, .. } => message.clone(),
            Failure::Aborted => "This operation was aborted".into(),
        }
    }
}

/// Developer-facing text for a failed request: the runtime's short deterministic reasons pass
/// through; transport failures and status codes become plain sentences; a raw body is never shown.
pub fn describe_failure(failure: &Failure) -> String {
    match failure {
        Failure::Api { status, message, from_runtime, .. } => {
            if *status == 404 {
                return "The runtime no longer has this record. Refresh the panel.".into();
            }
            if *status == 429 {
                return "The runtime already has four active runs. Wait for one to finish or cancel it.".into();
            }
            if *status == 503 && *from_runtime {
                return message.clone();
            }
            if *status >= 500 {
                return format!("The runtime reported an internal error (HTTP {status}). Check its log, then retry.");
            }
            message.clone()
        }
        Failure::Aborted => "The request was abandoned before the runtime answered.".into(),
        Failure::Type(_) => "The runtime did not answer. Start the service, or check its address and that it is still running; this panel reconnects by itself once it answers.".into(),
        other => {
            let message = other.message();
            if message.is_empty() {
                "The runtime could not be reached.".into()
            } else {
                message
            }
        }
    }
}

/// The class of a failed request, the same in every client.
pub fn classify_failure(failure: &Failure) -> &'static str {
    match failure {
        Failure::Api {
            status,
            from_runtime,
            ..
        } => match status {
            401 => "rejected_token",
            403 => "denied",
            404 => "not_found",
            429 => "capacity",
            503 if *from_runtime => "shutting_down",
            s if *s >= 500 => "internal",
            _ => "refused",
        },
        Failure::Aborted => "aborted",
        Failure::Type(_) => "unreachable",
        _ => "client",
    }
}

/// The candidate actions the runtime currently admits, and why it refuses the others.
#[derive(Clone, Debug, Default)]
pub struct AllowedActions {
    pub validate: Option<bool>,
    pub revalidate: Option<bool>,
    pub repair: Option<bool>,
    pub reasons: [Option<String>; 3],
}

#[derive(Clone, Copy)]
enum Action {
    Validate,
    Revalidate,
    Repair,
}

fn contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

/// `a.*b` within one line: `b` occurs after `a`.
fn seq(text: &str, first: &str, then: &str) -> bool {
    let mut from = 0;
    while let Some(at) = text[from..].find(first) {
        let after = from + at + first.len();
        if text[after..]
            .split('\n')
            .next()
            .is_some_and(|rest| rest.contains(then))
        {
            return true;
        }
        from = from + at + first.len().max(1);
        if from > text.len() {
            break;
        }
    }
    false
}

fn identity(text: &str) -> bool {
    text.contains("identity changed")
        || seq(text, "registered checkout ", " no longer exists")
        || text.contains("no longer matches the regist")
}

fn missing_tool(text: &str) -> bool {
    if contains_any(
        text,
        &["exit code 127", "command not found", "missing dependency"],
    ) {
        return true;
    }
    // command `[^`]*` was not found
    let mut from = 0;
    while let Some(at) = text[from..].find("command `") {
        let start = from + at + "command `".len();
        if let Some(close) = text[start..].find('`') {
            if text[start + close..].starts_with("` was not found") {
                return true;
            }
        }
        from = start;
    }
    // cannot start (?!pi:|the scope guard)
    let mut from = 0;
    while let Some(at) = text[from..].find("cannot start ") {
        let after = from + at + "cannot start ".len();
        if !text[after..].starts_with("pi:") && !text[after..].starts_with("the scope guard") {
            return true;
        }
        from = after;
    }
    false
}

fn dirty(text: &str) -> bool {
    contains_any(text, &["dirty", "uncommitted"])
}

fn baseline_running(text: &str) -> bool {
    seq(text, "baseline run ", " is already running") || seq(text, "baseline ", " already running")
}

/// /budgets?\b[^;]* must be (?:between|positive|exactly)/
fn budget_range(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut from = 0;
    while let Some(at) = text[from..].find("budget") {
        let start = from + at;
        let mut end = start + "budget".len();
        let word = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
        let mut candidates = vec![end];
        if bytes.get(end) == Some(&b's') {
            candidates.push(end + 1);
        }
        for candidate in candidates {
            if bytes.get(candidate).is_some_and(|b| word(*b)) {
                continue;
            }
            let rest = &text[candidate..];
            let segment = rest.split(';').next().unwrap_or("");
            let mut search = 0;
            while let Some(found) = segment[search..].find(" must be ") {
                let after = &segment[search + found + " must be ".len()..];
                // The alternatives may extend past a ';' only if [^;]* stopped before it, so the
                // phrase itself must start inside the segment; its words contain no ';'.
                let full = &rest[search + found + " must be ".len()..];
                if ["between", "positive", "exactly"]
                    .iter()
                    .any(|w| full.starts_with(w))
                {
                    let _ = after;
                    return true;
                }
                search += found + 1;
            }
            end = candidate;
        }
        from = end.max(start + 1);
    }
    false
}

struct Step {
    matches: fn(&str) -> bool,
    step: &'static str,
    requires: Option<Action>,
    otherwise: Option<&'static str>,
}

const REPLAN: &str = "Create the next plan revision to continue.";

fn steps() -> Vec<Step> {
    let s = |matches: fn(&str) -> bool, step: &'static str| Step {
        matches,
        step,
        requires: None,
        otherwise: None,
    };
    vec![
        s(|t| t.contains("rejected this token"), "Check the LUUNA_API_TOKEN value the service was started with, then connect again."),
        s(|t| contains_any(t, &["did not answer", "could not be reached"]), ""),
        s(|t| t.contains("shutting down"), "The runtime is stopping and admits no new work. Start it again with the same data directory and token; this panel reconnects by itself, then retry."),
        s(|t| contains_any(t, &["runtime request failed (http 422)", "failed to deserialize the json body"]), "The runtime could not read this request: a field is missing, misspelled or of the wrong type. A manifest draft must follow schemas/project.schema.json."),
        s(|t| t.contains("revision conflict"), "The record changed since this panel read it. Refresh, and run Discover again before confirming a manifest draft for the next revision."),
        s(identity, "If the change is intended, use Rebind repository in the project panel, then confirm a manifest revision whose remote matches; otherwise restore the registered checkout."),
        s(baseline_running, "Wait for the running baseline to settle, or cancel it from the baseline list, then run it again."),
        s(|t| t.contains("already has an active writer"), "Another workflow's writer holds this repository. Wait for it to settle, or cancel it from its ticket, then try again."),
        s(|t| contains_any(t, &["settled without changing any file", "made no in-scope change"]), "The writer changed nothing. Create the next plan revision with the paths the change needs, or a clearer acceptance criterion."),
        s(missing_tool, "Add a dependency-preparation recipe (for example npm ci) before the tests in the manifest, confirm it, run a new baseline, then plan again."),
        s(|t| t.contains("no longer the planned base"), "Confirm a manifest revision for the current HEAD, run its baseline, then create the next plan revision."),
        s(|t| t.contains("split the task"), "Create a plan revision with narrower paths, or split the ticket, so each candidate fits the independent review."),
        s(budget_range, "Correct the plan budgets in the run settings (1 to 10 writer attempts, 1 to 86400 seconds, at most $1000), then plan again."),
        s(|t| contains_any(t, &["budget", "exhausted", "repair limit", "max_task_repairs"]), "The approved budgets are spent. Create the next plan revision (with larger budgets if the work needs them) and approve it to continue."),
        s(|t| contains_any(t, &["unreported provider spend", "remaining approved cost budget is reserved"]), "Spend from the interrupted model session is reserved. Create the next plan revision to continue."),
        s(|t| contains_any(t, &["hash changed", "is stale", "reload", "manifest changed", "state changed"]), "The runtime state moved on; this panel has refreshed. Review the current candidate or plan before acting again."),
        s(|t| contains_any(t, &["already has active work", "already active", "another session is active", "no active local process"]), "Wait for the active work to finish, or cancel it, then act on the settled state."),
        s(|t| t.contains("executor infrastructure failure"), "The check runner failed on this host, not the candidate. Check the runtime log and the host, run a new baseline, then validate again or create the next plan revision."),
        s(|t| contains_any(t, &["no usable testing setup", "testing-setup ticket is offered", "prerequisite testing-setup"]), "Create the testing-setup ticket the runtime offers for that repository, plan it with the check recipes that will become its baseline, approve the exact plan hash and implement it; once its candidate is reviewed, merge it, confirm those recipes in the next manifest revision and run a passing baseline, then plan the feature again."),
        s(|t| t.contains("dependency_overrides"), "Add the dependency the confirmed relationship implies, or record the quoted dependency override with a real justification in the plan's overrides, then plan again."),
        s(|t| t.contains("baseline"), "Run a passing baseline for the current manifest on this host, then try again."),
        s(|t| t.contains("approved_by"), "Enter the approver's name (at most 200 UTF-8 bytes) in the run settings, then approve again."),
        s(|t| contains_any(t, &["create a new plan", "create and approve a new plan"]), "Create the next plan revision from the current ticket and selected resources, then approve it."),
        s(|t| contains_any(t, &["superseded", "approval does not", "approval is stale", "stored approval", "requires an approved workflow", "not approved", "approve the latest"]), "Approve the current plan revision first; approval binds to its exact hash."),
        s(|t| t.contains("no candidate was recorded"), "The writer left no candidate; its worktree is kept. Create the next plan revision and implement again."),
        Step { matches: |t| contains_any(t, &["interrupted by runtime shutdown", "runtime restarted", "interrupted"]), step: "The service stopped during this stage. Validate again for fresh check and review evidence; a writer that was interrupted needs a new plan revision, and its worktree is preserved.", requires: Some(Action::Validate), otherwise: Some("Create the next plan revision to continue. A writer that was interrupted keeps its worktree.") },
        Step { matches: |t| contains_any(t, &["invalid structured reviewer response", "reviewer response", "reviewer returned no", "reviewer settled without", "review deadline exceeded"]), step: "The reviewer produced no usable verdict. Re-validate the candidate to start a fresh reviewer session under the same approval.", requires: Some(Action::Revalidate), otherwise: Some(REPLAN) },
        Step { matches: |t| t.contains("independent review did not pass"), step: "Read the findings, then repair the candidate or create the next plan revision.", requires: Some(Action::Repair), otherwise: Some("Read the findings, then create the next plan revision.") },
        Step { matches: |t| contains_any(t, &["required candidate checks failed", "checks failed", "check failed"]), step: "Open the failed check's log, then repair the candidate.", requires: Some(Action::Repair), otherwise: Some("Open the failed check's log, then create the next plan revision.") },
        s(|t| contains_any(t, &["could not run meaningfully", "testing blocked", "blocked"]), "A required check could not run on this host. Fix the check recipe or the host, then run a new baseline."),
        s(|t| contains_any(t, &["scope", "outside", "not permitted", "unrelated"]), "The change reached outside the approved scope. Create the next plan revision with the paths the change needs."),
        s(|t| t.contains("cancelled"), "This work was cancelled. Create the next plan revision to try again."),
        s(dirty, "Commit or stash the developer checkout's changes, then try again."),
        s(|t| t.contains("approv"), "Approve the current plan revision first; approval binds to its exact hash."),
    ]
}

/// JavaScript's `toLowerCase` for the reasons met here (Unicode-aware like Rust's).
fn lower(reason: &str) -> String {
    reason.to_lowercase()
}

/// What the developer can do next, derived from the runtime's recorded reason. With the runtime's
/// current decisions it never recommends an action the runtime refuses.
pub fn next_step(reason: &str, actions: Option<&AllowedActions>) -> String {
    let text = lower(reason);
    let Some(entry) = steps().into_iter().find(|step| (step.matches)(&text)) else {
        return String::new();
    };
    let Some(required) = entry.requires else {
        return entry.step.into();
    };
    let (allowed, name, index) = match (required, actions) {
        (_, None) => return entry.step.into(),
        (Action::Validate, Some(a)) => (a.validate, "Validation", 0),
        (Action::Revalidate, Some(a)) => (a.revalidate, "Re-validation", 1),
        (Action::Repair, Some(a)) => (a.repair, "Repair", 2),
    };
    if allowed != Some(false) {
        return entry.step.into();
    }
    let refusal = actions
        .and_then(|a| a.reasons[index].clone())
        .filter(|r| !r.is_empty());
    format!(
        "{name} is not available{}. {}",
        refusal.map(|r| format!(": {r}")).unwrap_or_default(),
        entry.otherwise.unwrap_or(REPLAN)
    )
}

/// The next step for a baseline that did not pass: fixed in the repository or its recipe.
pub fn baseline_step(status: &str, reason: &str) -> String {
    if status == "passed" || status == "running" {
        return String::new();
    }
    if status == "interrupted" || status == "cancelled" {
        return "Run the baseline again; only a passed baseline admits feature work.".into();
    }
    let text = lower(reason);
    if identity(&text) || missing_tool(&text) || dirty(&text) || baseline_running(&text) {
        return next_step(reason, None);
    }
    if status == "blocked" {
        return "A required check could not run meaningfully on this host. Fix the recipe or the host, confirm the manifest if it changed, then run the baseline again.".into();
    }
    "Open the failing recipe's log, fix the repository or its recipe and commit, then run the baseline again.".into()
}

/// `<Action> refused: <reason> <step>`, the sentence every client shows.
pub fn explain_failure(action: &str, failure: &Failure) -> String {
    let reason = describe_failure(failure);
    let step = next_step(&reason, None);
    if step.is_empty() {
        format!("{action} refused: {reason}")
    } else {
        format!("{action} refused: {reason} {step}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hand_ported_patterns_match_like_the_regular_expressions() {
        assert!(missing_tool("cannot start npm"));
        assert!(!missing_tool("cannot start pi: no binary"));
        assert!(!missing_tool("cannot start the scope guard"));
        assert!(missing_tool("command `pytest` was not found"));
        assert!(!missing_tool("command `pytest is gone` x"));
        assert!(budget_range(
            "budgets.max_attempts must be between 1 and 10"
        ));
        assert!(budget_range("budget must be positive"));
        assert!(!budget_range("budgetary must be between"));
        assert!(!budget_range("budget x; y must be between"));
        assert!(identity("registered checkout c:/x no longer exists"));
        assert!(baseline_running("baseline run r1 is already running"));
        assert_eq!(next_step("repository app already has an active writer; one writer per repository", None), "Another workflow's writer holds this repository. Wait for it to settle, or cancel it from its ticket, then try again.");
        let refused = AllowedActions {
            repair: Some(false),
            reasons: [None, None, Some("budget spent".into())],
            ..Default::default()
        };
        assert_eq!(next_step("required candidate checks failed", Some(&refused)), "Repair is not available: budget spent. Open the failed check's log, then create the next plan revision.");
        assert_eq!(explain_failure("Connection", &Failure::Type("fetch failed".into())), "Connection refused: The runtime did not answer. Start the service, or check its address and that it is still running; this panel reconnects by itself once it answers.");
    }
}
