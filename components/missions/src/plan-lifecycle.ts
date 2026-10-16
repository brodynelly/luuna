// Plan status state machine (PLAN_SPEC.md:109-127). Plan status is derived
// from its children — `sd plan submit` sets the initial `approved` state,
// then update.ts/close.ts call `applyPlanTransitions` to recompute on every
// child status change.
//
// Transition rules:
//   draft → draft (manual; never auto-derived)
//   approved → active   when any child is in_progress
//   active → done       when all children are closed
//   done → active       when a closed child re-opens (reopen path)
//   active → active     while at least one child is non-closed (no regress)
//   approved → approved when no child has moved yet (idempotent)
//
// All transitions happen under the plans-lock held by the caller (update.ts /
// close.ts wrap their issue writes in `withLock(plansPath, () => withLock(issuesPath, ...))`).

import type { Issue, Plan, PlanStatus } from "./types.ts";

export function computeNextPlanStatus(plan: Plan, planChildren: Issue[]): PlanStatus {
	if (plan.status === "draft") return "draft";
	if (planChildren.length === 0) return plan.status;
	const allClosed = planChildren.every((c) => c.status === "closed");
	if (allClosed) return "done";
	// Has at least one non-closed child.
	if (plan.status === "active" || plan.status === "done") return "active";
	const anyInProgress = planChildren.some((c) => c.status === "in_progress");
	return anyInProgress ? "active" : "approved";
}

// Recompute and apply transitions for any plan whose children may have changed.
// Mutates `plans` in place; returns the count of rows that changed.
export function applyPlanTransitions(
	plans: Plan[],
	allIssues: Issue[],
	affectedPlanIds: Iterable<string>,
	now: string,
): number {
	const targets = new Set(affectedPlanIds);
	let changed = 0;
	for (let i = 0; i < plans.length; i++) {
		const p = plans[i];
		if (!p || !targets.has(p.id)) continue;
		const children: Issue[] = [];
		for (const cid of p.children) {
			const c = allIssues.find((iss) => iss.id === cid);
			if (c) children.push(c);
		}
		const next = computeNextPlanStatus(p, children);
		if (next !== p.status) {
			plans[i] = { ...p, status: next, updatedAt: now };
			changed++;
		}
	}
	return changed;
}

// Find every plan whose `children` array contains any of the given issue ids.
export function affectedPlanIds(plans: Plan[], issueIds: string[]): string[] {
	const ids = new Set(issueIds);
	const out: string[] = [];
	for (const p of plans) {
		if (p.children.some((cid) => ids.has(cid))) out.push(p.id);
	}
	return out;
}
