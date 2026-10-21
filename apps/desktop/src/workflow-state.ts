import type { CandidateView, EventEnvelope, RunRecord, RunState, WorkflowUsage } from "@luuna/api-client";
import type { AllowedActions } from "./failures";

export function canCancel(state: RunState, candidateActive = false): boolean {
  return candidateActive || state === "running" || state === "implementing";
}

/** The runtime's validate gate when it reports one; older runtimes leave it to the run and candidate states. */
export function canValidate(run: RunRecord, view: CandidateView): boolean {
  if (view.active) return false;
  if (view.validate_allowed !== undefined) return view.validate_allowed;
  return (run.state === "validating" && view.evidence?.status === "pending") || (run.state === "interrupted" && view.evidence?.status === "interrupted") || canRevalidate(run, view);
}

/** A failed candidate whose checks passed and whose reviewer left no verdict; the runtime decides. */
export function canRevalidate(run: RunRecord, view: CandidateView): boolean {
  return !view.active && run.state === "failed" && view.evidence?.status === "failed" && view.revalidate_allowed === true && view.validate_allowed !== false;
}

export function canRepair(view: CandidateView): boolean {
  return view.repair_allowed && !view.active;
}

/** What the runtime admits for this workflow now, with its refusal reasons when it reports them. */
export function allowedActions(run: RunRecord, view?: CandidateView): AllowedActions {
  if (!view) return {};
  const revalidate = canRevalidate(run, view);
  return {
    validate: canValidate(run, view) && !revalidate,
    revalidate,
    repair: canRepair(view),
    reasons: view.decision_reasons ?? {},
  };
}

/** Run and candidate reads may straddle a transition; reconcile before stopping. */
export function workflowNeedsRefresh(run: RunRecord, view?: CandidateView): boolean {
  if (run.state === "implementing" || view?.active) return true;
  const status = view?.evidence?.status;
  if (status === "validating" || status === "reviewing") return true;
  return (run.state === "validating" && status !== undefined && status !== "pending") || run.state === "reviewing";
}

/**
 * Why planning the next revision now would strand this revision's work, or "" when it would not.
 * The runtime records a new revision whatever the earlier run is doing, so the client holds it back
 * while work is active; cancelling that work releases it.
 */
export function planBlocker(revision: number, run?: RunRecord, view?: CandidateView): string {
  if (!run) return "";
  const status = view?.evidence?.status;
  if (view?.active || run.state === "implementing" || run.state === "reviewing" || (run.state === "validating" && status !== "pending")) {
    return `Plan r${revision + 1} is available once r${revision}'s active work settles; cancel it to stop sooner.`;
  }
  return "";
}

/**
 * What planning the next revision would leave behind, for the developer to confirm first, or ""
 * when nothing is. A pending candidate is confirmed rather than held back: when the runtime refuses
 * to validate it (a moved manifest or HEAD, spent budgets), a new revision is the only way on.
 */
export function planSupersedes(revision: number, run?: RunRecord, view?: CandidateView): string {
  if (!run || planBlocker(revision, run, view)) return "";
  const next = `r${revision + 1}`;
  if (run.state === "validating" && view?.evidence?.status === "pending") return `r${revision}'s candidate is waiting for validation and can no longer be validated once ${next} exists.`;
  if (run.state === "approved") return `r${revision}'s approval no longer authorizes implementation once ${next} exists.`;
  if (run.state === "reviewed") return `r${revision}'s reviewed candidate keeps its evidence, but this ticket then follows ${next}.`;
  return "";
}

/**
 * Why the runtime refuses to validate a candidate whose state would otherwise offer it (pending or
 * interrupted), so a missing button is explained; "" when it admits validation or does not say.
 */
export function validationRefusal(run: RunRecord, view: CandidateView): string {
  if (view.active || view.validate_allowed !== false) return "";
  const status = view.evidence?.status;
  if (!((run.state === "validating" && status === "pending") || (run.state === "interrupted" && status === "interrupted"))) return "";
  const reason = view.decision_reasons?.validate;
  return `Validation is not available${reason ? `: ${reason}` : ""}. Create the next plan revision to continue.`;
}

export function workflowReason(events: EventEnvelope[]): string {
  const event = [...events].reverse().find((event) => typeof event.payload.reason === "string");
  return typeof event?.payload.reason === "string" ? event.payload.reason : "";
}

/** Whether two run listings show the same records in the same states, so nothing needs rendering. */
export function sameRuns(previous: RunRecord[], next: RunRecord[]): boolean {
  return previous.length === next.length && previous.every((run, index) => run.id === next[index].id && run.state === next[index].state && run.revision === next[index].revision && run.updated_at === next[index].updated_at);
}

function dollars(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

/** The whole workflow's usage against its approved budgets, as the runtime reports it. */
export function usageSummary(usage: WorkflowUsage): string {
  const repairs = usage.max_repairs === null ? `${usage.repairs} repair(s)` : `${usage.repairs} of ${usage.max_repairs} repair(s)`;
  const unreported = usage.cost_unreported ? " Some model spend was reported without a cost, so the cost budget does not meter it." : "";
  return `Workflow usage: ${usage.attempts} of ${usage.max_attempts} writer attempt(s) · ${usage.elapsed_seconds}s of ${usage.timeout_seconds}s · ${dollars(usage.cost_usd_micros)} of ${dollars(usage.cost_budget_usd_micros)} · ${repairs}.${unreported}`;
}

/**
 * Runs a developer action under its own controller and reports the outcome, unless the
 * controller was aborted meanwhile (disconnect, another runtime or project): a late result
 * from an earlier connection must not refresh, report into or re-populate the current view.
 */
export async function settleAction(controller: AbortController, action: (signal: AbortSignal) => Promise<void>, report: { succeeded: () => void; failed: (failure: unknown) => void; settled: () => void }): Promise<void> {
  try {
    await action(controller.signal);
    if (!controller.signal.aborted) report.succeeded();
  } catch (failure) {
    if (!controller.signal.aborted) report.failed(failure);
  } finally {
    if (!controller.signal.aborted) report.settled();
  }
}
