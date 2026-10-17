import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanReview } from "./Workflows";
import type { EventEnvelope, PlanRevision, RunState } from "@luuna/api-client";
import { canCancel, workflowReason } from "./workflow-state";

test("approval presents every immutable field and full hash before acknowledgment", () => {
  const plan = { id: "plan-1", revision: 7, hash: `sha256:${"abcdef01".repeat(8)}`, permissions: { operations: ["write"] }, required_checks: [{ command: "private-check" }], tasks: [{ acceptance_criteria: ["all criteria visible"] }], manifest_hash: "manifest-identity", future_field: "also visible" } as unknown as PlanRevision;
  const html = renderToStaticMarkup(<PlanReview plan={plan} canApprove busy={false} onApprove={() => { throw new Error("unreviewed approval"); }} />);
  expect(html).toContain(plan.hash);
  for (const value of ["permissions", "operations", "private-check", "all criteria visible", "manifest-identity", "also visible"]) expect(html).toContain(value);
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
