import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanReview } from "./Workflows";
import type { EventEnvelope, PlanRevision, RunState } from "@luuna/api-client";
import { advanceWorkflowReplay, canCancel, workflowReason } from "./workflow-state";

test("approval presents every immutable field and full hash before acknowledgment", () => {
  const plan = { id: "plan-1", revision: 7, hash: `sha256:${"abcdef01".repeat(8)}`, permissions: { operations: ["write"] }, required_checks: [{ command: "private-check" }], tasks: [{ acceptance_criteria: ["all criteria visible"] }], manifest_hash: "manifest-identity", future_field: "also visible", component_context: { memory: [{ id: "memory-1", scope: "user", hash: "sha256:memory", content: "Explicitly selected knowledge", provenance: "Developer supplied note" }], prompt: { name: "guidance", version: 2, hash: "sha256:prompt", body: "Exact selected prompt content" } } } as unknown as PlanRevision;
  const html = renderToStaticMarkup(<PlanReview plan={plan} canApprove busy={false} onApprove={() => { throw new Error("unreviewed approval"); }} />);
  expect(html).toContain(plan.hash);
  for (const value of ["permissions", "operations", "private-check", "all criteria visible", "manifest-identity", "also visible", "Explicitly selected knowledge", "Developer supplied note", "Exact selected prompt content", "sha256:memory", "sha256:prompt"]) expect(html).toContain(value);
  expect(html).toMatch(/<button[^>]*disabled/);
  expect(html).toContain("I reviewed this complete plan and hash.");
});


test("idle workflows never offer process cancellation", () => {
  for (const state of ["plan_ready", "approved", "validating", "paused", "failed", "cancelled"] as RunState[]) expect(canCancel(state)).toBe(false);
  expect(canCancel("implementing")).toBe(true);
  expect(canCancel("running")).toBe(true);
});

test("workflow reasons come from the latest durable reason event", () => {
  const events = [{ payload: { reason: "old" } }, { payload: { reason: "writer exceeded cost budget" } }, { payload: {} }] as EventEnvelope[];
  expect(workflowReason(events)).toBe("writer exceeded cost budget");
  expect(workflowReason([])).toBe("");
});

test("workflow cursor retains reasons through empty pages and rejects incomplete replay atomically", () => {
  const event = (sequence: number, payload = {}) => ({ run_id: "run", event_id: `e${sequence}`, sequence, payload }) as EventEnvelope;
  const first = advanceWorkflowReplay("run", { cursor: 0, reason: "" }, [event(1, { reason: "blocked" }), event(2)]);
  expect(first).toEqual({ cursor: 2, reason: "blocked" });
  expect(advanceWorkflowReplay("run", first, [])).toEqual(first);
  expect(advanceWorkflowReplay("run", first, [event(3)])).toEqual({ cursor: 3, reason: "blocked" });
  expect(advanceWorkflowReplay("run", first, [event(3, { reason: "" })])).toEqual({ cursor: 3, reason: "" });
  expect(() => advanceWorkflowReplay("run", first, [event(3), event(5)])).toThrow("gap");
  expect(() => advanceWorkflowReplay("other", first, [event(3)])).toThrow("identity");
  expect(first).toEqual({ cursor: 2, reason: "blocked" });
});
