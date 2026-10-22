import { expect, test } from "vitest";
import { ApiError } from "@luuna/api-client";
import { actionFailure, baselineStep, describeFailure, nextStep, utf8Bytes } from "./failures";

test("transport and status failures become plain developer sentences, never server bodies", () => {
  expect(describeFailure(new TypeError("Failed to fetch"))).toContain("did not answer");
  expect(describeFailure(new DOMException("aborted", "AbortError"))).toContain("abandoned");
  expect(describeFailure(new ApiError(404, "run not found"))).toContain("no longer has this record");
  expect(describeFailure(new ApiError(429, "four runs are already active"))).toContain("four active runs");
  expect(describeFailure(new ApiError(500, "<html>stack trace</html>"))).not.toContain("stack trace");
  expect(describeFailure(new ApiError(422, "candidate hash changed; reload"))).toBe("candidate hash changed; reload");
  expect(describeFailure("odd")).toBe("The runtime could not be reached.");
});

test("runtime reasons map to the next allowed action", () => {
  expect(nextStep("budget exceeded: timeout_seconds 600 elapsed")).toContain("next plan revision");
  expect(nextStep("workflow time or cost budget exhausted; re-plan required")).toContain("next plan revision");
  expect(nextStep("candidate hash changed; reload")).toContain("moved on");
  expect(nextStep("workflow already has active work")).toContain("active work");
  expect(nextStep("implementation requires a passed baseline")).toContain("baseline");
  expect(nextStep("interrupted by runtime shutdown: cancelled; check process group reaped")).toContain("Validate again");
  expect(nextStep("invalid structured reviewer response: expected value")).toContain("Re-validate");
  expect(nextStep("independent review did not pass; repair or re-plan required")).toContain("repair");
  expect(nextStep("required candidate checks failed")).toContain("log");
  expect(nextStep("required candidate checks could not run meaningfully")).toContain("host");
  expect(nextStep("The service rejected this token. Reconnect using its current token.")).toContain("connect again");
  expect(nextStep("every required check passed")).toBe("");
});

test("an action failure names the action, the reason and the next step", () => {
  const text = actionFailure("Validation", new ApiError(409, "workflow already has active work"));
  expect(text.startsWith("Validation refused: workflow already has active work")).toBe(true);
  expect(text).toContain("Wait for the active work");
  expect(actionFailure("Registration", new ApiError(422, "path is not a git repository root"))).toBe("Registration refused: path is not a git repository root");
});

// Reasons the runtime records or refuses with, each paired with what its next step must name.
const RUNTIME_REASONS: Array<[string, string]> = [
  ["writer settled without changing any file", "next plan revision with the paths"],
  ["repository app already has an active writer; one writer per repository", "Wait for it to settle"],
  ["revision conflict: expected 2, current 1", "Discover again"],
  ["repository app identity changed since registration: remote changed from https://example.invalid/a.git to https://example.invalid/b.git", "Rebind repository"],
  ["repository app: the registered checkout /srv/app no longer exists; move it back, or rebind the repository to its new location", "Rebind repository"],
  ["review deadline exceeded", "Re-validate"],
  ["executor infrastructure failure: failed to spawn the check process", "check runner failed"],
  ["Runtime request failed (HTTP 422).", "schemas/project.schema.json"],
  ["Failed to deserialize the JSON body into the target type: manifest.repositories[0].checks[0].required: invalid type: string \"true\", expected a boolean at line 1 column 345", "schemas/project.schema.json"],
  ["runtime is shutting down", "Start it again"],
  ["missing dependency: command `vitest` was not found (exit code 127); add a dependency-preparation recipe (for example `npm ci`) before the tests in the manifest", "dependency-preparation recipe"],
  ["cannot start /usr/local/bin/pytest: No such file or directory (os error 2)", "dependency-preparation recipe"],
  ["baseline run 445b7205 is already running for repository app; wait for it to settle or cancel it", "running baseline"],
  ["budget exceeded: attempt 3 exceeds max_attempts 2", "next plan revision"],
  ["workflow time budget exhausted during required checks; re-plan required", "next plan revision"],
  ["plan revision 1 was superseded by revision 2 before implementation; approve the latest revision", "Approve the current plan revision"],
  ["no candidate was recorded before the writer was interrupted; its worktree is kept and the next plan revision is required", "implement again"],
  ["runtime restarted before attempt settled", "Validate again"],
  ["repository HEAD 1234 is no longer the planned base 5678; re-confirm the manifest and re-plan", "manifest revision for the current HEAD"],
  ["candidate diff exceeds bounded review context; split the task", "narrower paths"],
  ["scope violation: the writer changed src/other.py outside the approved paths", "paths the change needs"],
  ["approved_by must name the approver", "approver's name"],
  ["implementation refused: baseline lacks a passed result for required check unit", "passing baseline"],
  ["approval does not authorize this exact plan revision and permissions", "Approve the current plan revision"],
  ["Ticket changed since plan approval; create a new plan", "Create the next plan revision"],
  ["changed path src/other.py is outside the approved permissions for repository app", "paths the change needs"],
  ["budgets.max_attempts must be between 1 and 10", "Correct the plan budgets"],
  ["worker, attempt and time budgets must be positive", "Correct the plan budgets"],
  ["repair requires durable approval", "Approve the current plan revision"],
  ["workflow is Validating; an exact approval is required before implementation", "Approve the current plan revision"],
];

test("every runtime reason the walkthrough can show carries its next allowed action", () => {
  for (const [reason, action] of RUNTIME_REASONS) expect(nextStep(reason), reason).toContain(action);
  // Runtime-side scheduling refusals arrive as action failures with the same next step.
  expect(actionFailure("Implementation", new ApiError(409, "repository app already has an active writer; one writer per repository", true))).toContain("Wait for it to settle");
  expect(actionFailure("Baseline", new ApiError(409, "baseline run r1 is already running for repository app; wait for it to settle or cancel it", true))).toContain("cancel it from the baseline list");
  // An out-of-range budget is the request's problem, not a spent budget.
  expect(actionFailure("Planning", new Error("budgets.timeout_seconds must be between 1 and 86400"))).not.toContain("spent");
});

test("a stopping runtime names itself; other server failures stay generic", () => {
  expect(describeFailure(new ApiError(503, "runtime is shutting down", true))).toBe("runtime is shutting down");
  expect(actionFailure("Planning", new ApiError(503, "runtime is shutting down", true))).toContain("Start it again with the same data directory and token");
  expect(describeFailure(new ApiError(503, "Runtime request failed (HTTP 503)."))).toContain("internal error");
  expect(describeFailure(new ApiError(500, "storage detail", true))).not.toContain("storage detail");
});

test("the next step never recommends an action the runtime refuses, and names the refusal", () => {
  const review = "independent review did not pass; repair or re-plan required";
  expect(nextStep(review, { repair: true })).toContain("repair the candidate");
  const refused = nextStep(review, { repair: false, reasons: { repair: "budget exceeded: attempt 3 exceeds max_attempts 2" } });
  expect(refused).toBe("Repair is not available: budget exceeded: attempt 3 exceeds max_attempts 2. Read the findings, then create the next plan revision.");
  expect(nextStep(review, { repair: false })).toBe("Repair is not available. Read the findings, then create the next plan revision.");
  expect(nextStep("required candidate checks failed", { repair: false })).not.toContain("repair the candidate");
  const interrupted = nextStep("interrupted by runtime shutdown", { validate: false, reasons: { validate: "budget exceeded: cost reserved" } });
  expect(interrupted).toContain("Validation is not available: budget exceeded: cost reserved.");
  expect(interrupted).toContain("next plan revision");
  expect(nextStep("invalid structured reviewer response: x", { revalidate: false })).toBe("Re-validation is not available. Create the next plan revision to continue.");
  expect(nextStep("invalid structured reviewer response: x", { revalidate: true })).toContain("Re-validate");
  // Without decisions (an action failure), the table's own step stands.
  expect(nextStep(review)).toContain("repair the candidate");
});

test("baseline reasons lead to a baseline step, never to candidate repair", () => {
  expect(baselineStep("failed", "required check unit failed")).toContain("run the baseline again");
  expect(baselineStep("failed", "required check unit failed")).not.toContain("repair");
  expect(baselineStep("blocked", "required check unit reported zero tests")).toContain("could not run meaningfully");
  expect(baselineStep("blocked", "missing dependency: command `vitest` was not found (exit code 127)")).toContain("dependency-preparation recipe");
  expect(baselineStep("blocked", "repository has uncommitted changes: src/main.py")).toContain("Commit or stash");
  expect(baselineStep("interrupted", "interrupted by runtime shutdown")).toBe("Run the baseline again; only a passed baseline admits feature work.");
  expect(baselineStep("passed", "")).toBe("");
});

test("text limits count UTF-8 bytes as the runtime does", () => {
  expect(utf8Bytes("a".repeat(200))).toBe(200);
  expect(utf8Bytes("漢".repeat(100))).toBe(300);
  expect(utf8Bytes("é")).toBe(2);
  expect(utf8Bytes("🙂")).toBe(4);
});
