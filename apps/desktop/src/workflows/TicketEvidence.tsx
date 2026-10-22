import type { AttemptRecord, PlanRevision, RunRecord, TaskRecord, Ticket } from "@luuna/api-client";
import { advisoryRole } from "@luuna/api-client";
import { Button, Id, Inline, Meta, StatusBadge, Stack, runTone } from "@luuna/ui";
import { dollars, stateText } from "./model";
import type { RunSnapshot } from "./read";
import { TaskGraph } from "./TaskGraph";
import type { TicketActions } from "./TicketCard";

/** Usage across every plan revision of the ticket, including work whose price was not reported. */
export function TicketUsage({ ticket }: { ticket: Ticket }) {
  const usage = ticket.usage;
  return <Meta block label="Cumulative ticket usage">{usage ? <>
    All plan revisions: {usage.workflows} workflow(s), {usage.attempts} writer attempt(s), {usage.repairs} repair(s), {usage.elapsed_seconds}s, {dollars(usage.cost_usd_micros, 4)} recorded or reserved.
    {usage.cost_unreported && " Some provider usage has no reported price; this is not the complete cost."} A new revision does not erase this usage.
  </> : "Cumulative ticket usage is unavailable from this runtime."}</Meta>;
}

/** The latest plan's identity and budgets, then each earlier revision with its run's state. */
export function PlanMeta({ plan, earlier }: { plan: PlanRevision; earlier: { plan: PlanRevision; run?: RunRecord }[] }) {
  const settled = earlier.flatMap(({ plan: revision, run }) => run ? [{ plan: revision, run }] : []);
  const budgets = plan.budgets;
  return <>
    <Meta className="plan-meta">
      plan <Id>{plan.id}</Id> r{plan.revision} · base <Id>{Object.values(plan.base_commits)[0]?.slice(0, 12)}</Id> · paths {plan.tasks[0]?.paths.join(", ")} · budget {budgets.max_attempts} attempt(s), {budgets.timeout_seconds}s, {dollars(budgets.cost_usd_micros, 2)}
    </Meta>
    {settled.length > 0 && <Meta className="plan-history">Earlier revisions: {settled.map(({ plan: revision, run }, index) => <span key={revision.id}>
      {index > 0 && " · "}r{revision.revision} <StatusBadge tone={runTone[run.state]}>{stateText(run.state)}</StatusBadge>
    </span>)}</Meta>}
  </>;
}

export interface RunEvidenceProps {
  run: RunRecord;
  plan?: PlanRevision;
  snapshot?: RunSnapshot;
  attempts?: AttemptRecord[];
  tasks?: TaskRecord[];
  busy: boolean;
  connected: boolean;
  /** A held-back next revision also holds back deriving one from a proposal. */
  blocked: boolean;
  reconcile: boolean;
  actions: TicketActions;
}

/** The run's worktrees, its task graph (several tasks or an advisory one) and its writer attempts. */
export function RunEvidence({ run, plan, snapshot, attempts, tasks, busy, connected, blocked, reconcile, actions }: RunEvidenceProps) {
  const offline = busy || !connected;
  const graph = plan && (plan.tasks.length > 1 || plan.tasks.some((task) => advisoryRole(task.role)));
  return <>
    {(snapshot?.leases ?? []).map((lease) => <Meta key={lease.id} className="worktree-line" data-capability="runs.worktrees">
      worktree <Id>{lease.path}</Id> · {lease.state}{lease.candidate_commit && <> · candidate <Id>{lease.candidate_commit.slice(0, 12)}</Id></>}{lease.reason && ` · ${lease.reason}`}
    </Meta>)}
    {plan && graph && <Stack gap={2} className="tasks-inspection">
      <Inline><Button variant="text" disabled={offline} data-capability="runs.tasks" onClick={() => actions.tasks(run)}>Show task graph</Button></Inline>
      {tasks && <TaskGraph run={run} tasks={tasks} overrides={plan.dependency_overrides ?? []} busy={offline || reconcile}
        onResume={(taskId) => actions.implement(run, taskId)} onDerive={actions.derive && !blocked ? (task) => actions.derive?.(task) : undefined} />}
    </Stack>}
    <Inline wrap gap={2} className="attempts-inspection">
      <Button variant="text" disabled={offline} data-capability="runs.attempts" onClick={() => actions.attempts(run)}>Show writer attempts</Button>
      {attempts && <Meta label="Writer attempts">{attempts.length === 0 ? "No writer attempts recorded." : attempts.map((attempt) => `attempt ${attempt.number} (${attempt.task_id}): ${attempt.state}`).join(" · ")}</Meta>}
    </Inline>
  </>;
}
