import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CandidateDiff, CandidateEvidence, CandidateView, RunRecord } from "@luuna/api-client";
import { CandidateReview, canRepairPublication } from "./CandidateReview";
import { canCancel, canRevalidate, canValidate, workflowNeedsRefresh } from "./workflow-state";

const hash = `sha256:${"a".repeat(64)}`;
const commit = "b".repeat(40);
const evidence: CandidateEvidence = {
  candidate: { schema_version: "0.1", id: "candidate-1", revision: 2, plan_hash: `sha256:${"c".repeat(64)}`, repository_commits: { app: commit }, dependency_bindings: {}, hash },
  run_id: "run-1", implementer_session: "writer-1", repository_trees: { app: "d".repeat(40) }, status: "pending", results: [], started_at: "2026-10-17T00:00:00Z", elapsed_seconds: 3, cost_usd_micros: 1000, validation_generation: 1,
};
const run: RunRecord = { id: "run-1", project_id: "project-1", revision: 3, state: "validating", metadata: { kind: "workflow" }, created_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T00:00:00Z" };
const view: CandidateView = { evidence, active: false, repair_allowed: false, revalidate_allowed: false };
const actions = { onValidate() {}, onRepair() {}, onCancel() {}, onDiff() {}, onArtifact() {} };
const render = (next: CandidateView, nextRun = run, diff?: CandidateDiff) => renderToStaticMarkup(<CandidateReview run={nextRun} view={next} diff={diff} busy={false} {...actions} />);

test("candidate actions follow authoritative worker state and repair permission", () => {
  expect(render(view)).toContain("Validate and review");
  expect(render(view)).not.toContain("Cancel workflow");
  expect(render(view)).not.toContain("Repair candidate");
  const active = { ...view, active: true, evidence: { ...evidence, status: "validating" as const } };
  expect(render(active)).not.toContain("Validate and review");
  expect(render(active)).toContain("Cancel workflow");
  expect(canCancel("validating", true)).toBe(true);
  expect(canCancel("reviewing", true)).toBe(true);
  expect(canCancel("reviewing", false)).toBe(false);
  expect(canCancel("failed", true)).toBe(true);
  expect(canCancel("reviewed", false)).toBe(false);
  expect(render({ ...view, repair_allowed: true })).toContain("Repair candidate");
  expect(render({ ...active, repair_allowed: true })).not.toContain("Repair candidate");
  expect(canValidate({ ...run, state: "reviewed" }, view)).toBe(false);
  expect(canValidate(run, { ...view, evidence: { ...evidence, status: "failed" } })).toBe(false);
  expect(canValidate({ ...run, state: "interrupted" }, { ...view, evidence: { ...evidence, status: "interrupted" } })).toBe(true);
});

test("a failed candidate offers re-validation only when the runtime allows it", () => {
  const failedRun = { ...run, state: "failed" as const };
  const failed = { ...view, evidence: { ...evidence, status: "failed" as const, reason: "invalid structured reviewer response: expected value at line 1" } };
  expect(render(failed, failedRun)).not.toContain("Validate and review");
  expect(render(failed, failedRun)).not.toContain("Re-validate and review");
  expect(canValidate(failedRun, failed)).toBe(false);
  const allowed = { ...failed, revalidate_allowed: true };
  const html = render(allowed, failedRun);
  expect(html).toContain("Re-validate and review");
  expect(html).toContain("no review verdict was recorded");
  expect(html).toContain("No writer attempt is spent");
  expect(canValidate(failedRun, allowed)).toBe(true);
  expect(canRevalidate(failedRun, allowed)).toBe(true);
  // The runtime's permission is bound to its state: an active worker, another run state or
  // another candidate status never shows the control.
  expect(render({ ...allowed, active: true }, failedRun)).not.toContain("Re-validate and review");
  expect(canRevalidate({ ...run, state: "paused" }, allowed)).toBe(false);
  expect(canRevalidate(failedRun, { ...allowed, evidence: { ...evidence, status: "paused" } })).toBe(false);
  expect(render({ ...view, revalidate_allowed: true })).toContain("Validate and review");
  expect(render({ ...view, revalidate_allowed: true })).not.toContain("Re-validate and review");
});

test("complete candidate identity, executed check evidence and structured findings are inspectable", () => {
  const result = { schema_version: "0.1", id: "check-1", run_id: run.id, repository_id: "app", recipe_id: "unit", candidate_hash: hash, commit, environment_fingerprint: `sha256:${"e".repeat(64)}`, command: ["npm", "test"], status: "passed" as const, exit_code: 0, artifact_refs: ["c2-g1-unit.stdout"], artifact_hashes: { "c2-g1-unit.stdout": "f".repeat(64) }, tests_detected: 3 };
  const review = { schema_version: "0.1", id: "review-1", candidate_hash: hash, reviewer_session: "independent-1", verdict: "changes_required" as const, findings: [{ severity: "blocking" as const, path: "src/app.ts", line: 12, explanation: "Seeded regression loses data", evidence: ["A failing case is present at src/app.ts:12"] }], evidence: ["reviewed exact candidate"] };
  const next = { ...view, evidence: { ...evidence, status: "paused" as const, reason: "Repair required: blocking review finding", results: [result], review } };
  const diff = { candidate_hash: hash, repository_id: "app", base_commit: "0".repeat(40), commit, diff: "- old\n+ changed" };
  const html = render(next, { ...run, state: "paused" }, diff);
  for (const value of [hash, commit, evidence.candidate.plan_hash, result.environment_fingerprint, "View stdout", "tests_detected", "artifact_hashes", "f".repeat(64), "Seeded regression loses data", "src/app.ts", "independent-1", "changes required", "Repair required: blocking review finding", "+ changed"]) expect(html).toContain(value);
  expect(html).not.toContain("Validate and review");
});

test("a replacement candidate never displays earlier diff, review or log as its evidence", () => {
  const oldHash = `sha256:${"0".repeat(64)}`;
  const next = { ...view, evidence: { ...evidence, review: { schema_version: "0.1", id: "old-review", candidate_hash: oldHash, reviewer_session: "old-reviewer", verdict: "passed" as const, findings: [], evidence: ["old result"] } } };
  const diff = { candidate_hash: oldHash, repository_id: "app", base_commit: "0".repeat(40), commit, diff: "old diff must not appear" };
  const html = renderToStaticMarkup(<CandidateReview run={run} view={next} diff={diff} log={{ candidateHash: oldHash, artifactId: "old.stdout", text: "old log must not appear" }} busy={false} {...actions} />);
  expect(html).not.toContain("old-reviewer");
  expect(html).not.toContain("old diff must not appear");
  expect(html).not.toContain("old log must not appear");
  expect(html).toContain("No independent review recorded for this candidate.");
});

test("an empty candidate record offers no validation or repair controls", () => {
  expect(render({ evidence: null, active: false, repair_allowed: false, revalidate_allowed: false })).toBe("");
});

test("restarting validation hides logs from the previous validation generation", () => {
  const html = renderToStaticMarkup(<CandidateReview run={run} view={view} log={{ candidateHash: hash, artifactId: "c2-g0-unit.stdout", text: "old generation log" }} busy={false} {...actions} />);
  expect(html).not.toContain("old generation log");
});

test("polling reconciles run and candidate reads that straddle settlement", () => {
  expect(workflowNeedsRefresh(run, view)).toBe(false);
  expect(workflowNeedsRefresh(run, { ...view, active: true })).toBe(true);
  expect(workflowNeedsRefresh(run, { ...view, evidence: { ...evidence, status: "validating" } })).toBe(true);
  expect(workflowNeedsRefresh(run, { ...view, evidence: { ...evidence, status: "reviewed" } })).toBe(true);
  expect(workflowNeedsRefresh({ ...run, state: "reviewing" }, { ...view, evidence: { ...evidence, status: "failed" } })).toBe(true);
  expect(workflowNeedsRefresh({ ...run, state: "reviewed" }, { ...view, evidence: { ...evidence, status: "reviewed" } })).toBe(false);
  expect(workflowNeedsRefresh({ ...run, state: "implementing" }, view)).toBe(true);
});

test("a refused repair is explained and never recommended", () => {
  const paused = { ...view, repair_allowed: false, evidence: { ...evidence, status: "paused" as const, reason: "independent review did not pass; repair or re-plan required" } };
  const legacy = render(paused, { ...run, state: "paused" });
  expect(legacy).not.toContain("Repair candidate");
  expect(legacy).not.toContain("repair the candidate");
  expect(legacy).toContain("Repair is not available. Read the findings, then create the next plan revision.");
  const explained = render({ ...paused, decision_reasons: { validate: "candidate validation is already active or cannot be resumed", repair: "budget exceeded: attempt 3 exceeds max_attempts 2", revalidate: "candidate already has a recorded review verdict" } }, { ...run, state: "paused" });
  expect(explained).toContain("Repair is not available: budget exceeded: attempt 3 exceeds max_attempts 2.");
  expect(render({ ...paused, repair_allowed: true }, { ...run, state: "paused" })).toContain("repair the candidate or create the next plan revision");
});

test("the runtime's validate decision replaces the client's guess, with its reason", () => {
  const interrupted = { ...view, evidence: { ...evidence, status: "interrupted" as const, reason: "interrupted by runtime shutdown" } };
  const interruptedRun = { ...run, state: "interrupted" as const };
  // An older runtime reports no decision: the interrupted candidate offers validation.
  expect(render(interrupted, interruptedRun)).toContain("Validate and review");
  const refused = { ...interrupted, validate_allowed: false, decision_reasons: { validate: "budget exceeded: the remaining approved cost budget is reserved", repair: null, revalidate: "x" } };
  const html = render(refused, interruptedRun);
  expect(html).not.toContain("Validate and review");
  expect(html).toContain("Validation is not available: budget exceeded: the remaining approved cost budget is reserved.");
  expect(html).toContain("next plan revision");
  expect(html.match(/Validation is not available/g)).toHaveLength(1);
  // A pending candidate records no reason of its own; the runtime's refusal explains the missing button.
  const pendingRefused = render({ ...view, validate_allowed: false, decision_reasons: { validate: "manifest changed; re-plan", repair: null, revalidate: null } });
  expect(pendingRefused).not.toContain("Validate and review");
  expect(pendingRefused).toContain("Validation is not available: manifest changed; re-plan. Create the next plan revision to continue.");
  expect(render({ ...view, validate_allowed: true })).not.toContain("is not available");
  expect(canValidate(run, { ...view, validate_allowed: false })).toBe(false);
  expect(canValidate({ ...run, state: "reviewed" }, { ...view, validate_allowed: true })).toBe(true);
  expect(canValidate(run, { ...view, active: true, validate_allowed: true })).toBe(false);
  // Re-validation needs both the validate gate and the re-validation decision.
  const failedRun = { ...run, state: "failed" as const };
  const failed = { ...view, revalidate_allowed: true, evidence: { ...evidence, status: "failed" as const } };
  expect(canRevalidate(failedRun, { ...failed, validate_allowed: false })).toBe(false);
  expect(render({ ...failed, validate_allowed: true }, failedRun)).toContain("Re-validate and review");
});

test("workflow usage is shown against the approved budgets when the runtime reports it", () => {
  const usage = { attempts: 2, max_attempts: 2, elapsed_seconds: 312, timeout_seconds: 600, cost_usd_micros: 420_000, cost_budget_usd_micros: 1_000_000, cost_unreported: false, repairs: 1, max_repairs: 2 };
  const html = render({ ...view, usage });
  expect(html).toContain("Workflow usage: 2 of 2 writer attempt(s) · 312s of 600s · $0.4200 of $1.0000 · 1 of 2 repair(s).");
  expect(html).not.toContain("Runtime usage recorded for this candidate");
  expect(render({ ...view, usage: { ...usage, cost_unreported: true, max_repairs: null } })).toContain("1 repair(s). Some model spend was reported without a cost");
  expect(render(view)).toContain("Runtime usage recorded for this candidate: 3s · $0.0010.");
});

test("an oversized diff lists omissions instead of claiming there are no changes", () => {
  const html = render(view, run, { candidate_hash: hash, repository_id: "app", base_commit: commit, commit, diff: "", truncated: true, files: [{ path: "src/large.ts", status: "M", shown: "omitted" }], worktree_drift: "worktree differs from frozen candidate" });
  expect(html).not.toContain("No changes.");
  expect(html).toContain("This diff is truncated");
  expect(html).toContain("src/large.ts");
  expect(html).toContain("worktree differs from frozen candidate");
});

test("a CI repair is offered only for an open publication of this candidate with an observed CI failure", () => {
  const reviewedRun = { ...run, state: "reviewed" as const };
  const reviewed: CandidateView = { ...view, evidence: { ...evidence, status: "reviewed", review: { schema_version: "0.1", candidate_hash: hash, reviewer_session: "review-1", verdict: "passed", findings: [], evidence: [], attention_paths: [], mutation_attempts: [], tool_calls: [], exact_candidate_bound: true } as never } };
  const repository = { branch: "luuna/t/abc", commit, remote: "https://github.com/o/r.git", owner: "o", repo: "r", base_branch: "main", push: "done" as const, pull_request_step: "done" as const, pull_request: { number: 1, url: "https://github.com/o/r/pull/1" }, ci: { state: "failure" as const, checks: [{ name: "ci-unit", status: "completed", conclusion: "failure" }] }, merge: { merged: false } };
  const publication = { schema_version: "0.1", run_id: "run-1", project_id: "project-1", ticket_id: "t", candidate_hash: hash, idempotency_key: "k", publication_state: "pr_open" as const, repositories: { app: repository }, created_at: "", updated_at: "", contract: { schema_version: "0.1", ticket_id: "t", candidate_hash: hash, per_repository_branch: { app: "luuna/t/abc" }, pull_request_urls: { app: "https://github.com/o/r/pull/1" }, publication_state: "pr_open" as const }, active: false };
  expect(canRepairPublication(reviewedRun, reviewed, publication)).toBe(true);
  expect(canRepairPublication(reviewedRun, reviewed, undefined)).toBe(false);
  expect(canRepairPublication(reviewedRun, reviewed, { ...publication, superseded_by_repair: true })).toBe(false);
  expect(canRepairPublication(reviewedRun, reviewed, { ...publication, active: true })).toBe(false);
  expect(canRepairPublication(reviewedRun, reviewed, { ...publication, publication_state: "failed" })).toBe(false);
  expect(canRepairPublication(reviewedRun, reviewed, { ...publication, candidate_hash: `sha256:${"e".repeat(64)}` })).toBe(false);
  expect(canRepairPublication(reviewedRun, reviewed, { ...publication, repositories: { app: { ...repository, ci: { state: "success", checks: [] } } } })).toBe(false);
  expect(canRepairPublication(reviewedRun, reviewed, { ...publication, repositories: { app: { ...repository, ci: { state: "pending", checks: [] } } } })).toBe(false);
  expect(canRepairPublication({ ...reviewedRun, state: "failed" }, { ...reviewed, evidence: { ...reviewed.evidence!, status: "failed" } }, publication)).toBe(false);
  const markup = renderToStaticMarkup(<CandidateReview run={reviewedRun} view={reviewed} busy={false} {...actions} publication={publication} onRepairPublication={() => {}} />);
  expect(markup).toContain("Repair after CI failure");
  expect(markup).toContain('data-capability="runs.publication.repair"');
  const superseded = renderToStaticMarkup(<CandidateReview run={reviewedRun} view={reviewed} busy={false} {...actions} publication={{ ...publication, superseded_by_repair: true, superseded_reason: "CI failed on the published pull request" }} onRepairPublication={() => {}} />);
  expect(superseded).not.toContain("Repair after CI failure");
  expect(superseded).toContain("Superseded");
});

// ---- ADR 0022 handoff and the editor handoff of ADR 0027 point 4. ----
import { copyPath } from "./CandidateReview";

test("a setup workflow's candidate shows the proposed checks and the runtime's handoff text", () => {
  const handoff = { kind: "testing_setup" as const, repository_id: "app", checks: [{ id: "unit", executable: "python", args: ["-m", "unittest"], required: true, timeout_seconds: 120, capabilities: [], cwd: "." }, { id: "lint", executable: "ruff", args: [], required: true, timeout_seconds: 60, capabilities: ["shell"], cwd: "src" }], candidate_commit: commit, reviewed: true, next: "the setup candidate passed its checks and review: merge it into the developer checkout of repository app, then PUT /api/v1/projects/project-1/manifest with the next revision listing these checks" };
  const html = renderToStaticMarkup(<CandidateReview run={{ ...run, state: "reviewed" }} view={{ ...view, evidence: { ...evidence, status: "reviewed" } }} busy={false} {...actions} handoff={handoff} />);
  expect(html).toContain('aria-label="Testing-setup handoff"');
  expect(html).toContain("reviewed with a passed verdict");
  expect(html).toContain(`Candidate commit <code>${commit}</code>`);
  expect(html).toContain("<code>unit</code>: <code>python -m unittest</code> · 120s");
  expect(html).toContain("<code>lint</code>: <code>ruff</code> in <code>src</code> · 60s · shell");
  expect(html).toContain(handoff.next);
  expect(html).toMatch(/class="setup-handoff callout" data-tone="attention"/);
  expect(render(view)).not.toContain("Testing-setup handoff");
  const pending = renderToStaticMarkup(<CandidateReview run={run} view={view} busy={false} {...actions} handoff={{ ...handoff, reviewed: false, candidate_commit: null, next: "the setup candidate must pass these checks" }} />);
  expect(pending).toContain("not yet reviewed with a passed verdict");
  expect(pending).not.toContain("Candidate commit");
});

test("the editor handoff shows each worktree path whole with a copy control, and nothing else", () => {
  const lease = { id: "lease-1", run_id: "run-1", project_id: "project-1", repository_id: "app", path: "/home/dev/.luuna/worktrees/run-1/app", base_commit: commit, state: "active" as const, created_at: "" };
  const html = renderToStaticMarkup(<CandidateReview run={run} view={view} busy={false} {...actions} worktrees={[lease]} />);
  expect(html).toContain('data-surface="editor-handoff"');
  expect(html).toContain(`<code class="worktree-path">${lease.path}</code>`);
  expect(html).toContain("Copy path for app");
  expect(html).toContain("grants no permission");
  expect(html).not.toMatch(/href="(?:vscode|idea|editor):/);
  expect(render(view)).not.toContain("editor-handoff");
  const written: string[] = [];
  const navigatorRef = globalThis as unknown as { navigator?: { clipboard?: { writeText: (text: string) => Promise<void> } } };
  const previous = navigatorRef.navigator;
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (text: string) => { written.push(text); } } }, configurable: true, writable: true });
  try {
    copyPath(lease.path);
    expect(written).toEqual([lease.path]);
  } finally {
    Object.defineProperty(globalThis, "navigator", { value: previous, configurable: true, writable: true });
  }
});

test("a passed verdict shows its badge word and draws no check, and the review carries no motion wrapper", () => {
  const review = (verdict: "passed" | "changes_required") => ({ ...view, evidence: { ...evidence, status: "reviewed" as const, review: { schema_version: "0.1", id: "r", candidate_hash: hash, reviewer_session: "review-1", verdict, findings: [], evidence: [], attention_paths: [], mutation_attempts: [], tool_calls: [], exact_candidate_bound: true } as never } });
  const passed = render(review("passed"), { ...run, state: "reviewed" });
  expect(passed).toMatch(/Verdict: <strong><span class="state" data-tone="success">passed<\/span><\/strong>/);
  expect(passed).not.toContain("check-draw");
  expect(render(review("changes_required"), { ...run, state: "reviewed" })).not.toContain("check-draw");
  for (const html of [passed, render(view)]) for (const motion of ["reveal", "glow-surface", "aurora"]) expect(html).not.toContain(motion);
});
