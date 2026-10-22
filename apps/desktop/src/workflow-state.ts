import type { CandidateView, EventEnvelope, RunRecord, RunState } from "@luuna/api-client";

export function canCancel(state: RunState, candidateActive = false): boolean {
  return candidateActive || state === "running" || state === "implementing";
}

export function canValidate(run: RunRecord, view: CandidateView): boolean {
  return !view.active && ((run.state === "validating" && view.evidence?.status === "pending") || (run.state === "interrupted" && view.evidence?.status === "interrupted") || canRevalidate(run, view));
}

/** A failed candidate whose checks passed and whose reviewer left no verdict; the runtime decides. */
export function canRevalidate(run: RunRecord, view: CandidateView): boolean {
  return !view.active && run.state === "failed" && view.evidence?.status === "failed" && view.revalidate_allowed === true;
}

/** Run and candidate reads may straddle a transition; reconcile before stopping. */
export function workflowNeedsRefresh(run: RunRecord, view?: CandidateView): boolean {
  if (run.state === "implementing" || view?.active) return true;
  const status = view?.evidence?.status;
  if (status === "validating" || status === "reviewing") return true;
  return (run.state === "validating" && status !== undefined && status !== "pending") || run.state === "reviewing";
}

export function workflowReason(events: EventEnvelope[]): string {
  for (let index = events.length - 1; index >= 0; index--) {
    const reason = events[index].payload.reason;
    if (typeof reason === "string") return reason;
  }
  return "";
}

export interface WorkflowReplay { cursor: number; reason: string }

/** Keep only the displayed reason and cursor, never historical model payloads. */
export function advanceWorkflowReplay(runId: string, previous: WorkflowReplay, incoming: EventEnvelope[]): WorkflowReplay {
  let { cursor, reason } = previous;
  for (const event of incoming) {
    if (event.run_id !== runId || !event.event_id || event.sequence !== cursor + 1) {
      throw new Error("Runtime event replay has a gap or invalid identity; retrying from the last contiguous sequence.");
    }
    cursor = event.sequence;
    if (typeof event.payload.reason === "string") reason = event.payload.reason;
  }
  return { cursor, reason };
}
