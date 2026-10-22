import { renderToStaticMarkup } from "react-dom/server";
import type { CandidateView, PlanRevision, RunRecord, RunState, TestingPrerequisite, Ticket } from "@luuna/api-client";
import { TicketCard } from "../Workflows";
import type { RunSnapshot, TicketActions } from "../Workflows";

// Shared fixtures of the workflow tests: one ticket, plan and run builders, and a rendered card.
export const ticket: Ticket = { schema_version: "0.1", id: "ticket-1", project_id: "p", revision: 1, source: "luuna_sqlite_temporary", title: "Implement the greeting", intent: "Print it", acceptance_criteria: ["prints"], repository_ids: ["app"], created_at: "", updated_at: "" };
export const planOf = (revision: number) => ({ id: "plan-1", revision, hash: `sha256:${String(revision).repeat(64)}`, base_commits: { app: "c".repeat(40) }, tasks: [{ paths: ["src"] }], budgets: { max_workers: 1, max_attempts: 2, timeout_seconds: 600, cost_usd_micros: 1_000_000 } }) as unknown as PlanRevision;
export const runOf = (id: string, state: RunState, revision = 1, planRevision = 1): RunRecord => ({ id, project_id: "p", state, revision, metadata: { kind: "workflow", plan_id: "plan-1", plan_revision: planRevision }, created_at: "", updated_at: `t${revision}` });
export const noActions: TicketActions = { reconcile() {}, update() {}, plan() {}, approve() {}, implement() {}, cancel() {}, validate() {}, repair() {}, diff() {}, attempts() {}, tasks() {}, artifact() {}, publish() {}, publication() {}, reconcilePublication() {}, repairPublication() {} };
export const pendingEvidence = { candidate: { schema_version: "0.1", id: "c", revision: 1, plan_hash: "sha256:p", repository_commits: { app: "b".repeat(40) }, dependency_bindings: {}, hash: `sha256:${"a".repeat(64)}` }, run_id: "run-1", implementer_session: "w", repository_trees: {}, status: "pending" as const, results: [], started_at: "", elapsed_seconds: 1, cost_usd_micros: 1, validation_generation: 1 };
export const snapshot = (candidate: CandidateView, reason = ""): RunSnapshot => ({ revision: 1, updated: "t1", cursor: 0, reason, leases: [], candidate });
export function card(run: RunRecord, candidate: CandidateView, reason = "", earlier: { plan: PlanRevision; run?: RunRecord }[] = []) {
  const latest = planOf(earlier.length + 1);
  return renderToStaticMarkup(<TicketCard ticket={ticket} revisions={[...earlier, { plan: latest, run }]} snapshots={new Map([[run.id, snapshot(candidate, reason)]])} diffs={{}} logs={{}} busy={false} connected actions={noActions} />);
}
export const offer: TestingPrerequisite = { kind: "testing_setup", project_id: "p", repository_id: "app", baseline_id: "b1", reason: "the manifest names no required check for repository app", next: "POST /api/v1/projects/p/tickets with purpose testing_setup and repository_ids [\"app\"], then POST /api/v1/tickets/{id}/plans with the check recipes (checks)" };
