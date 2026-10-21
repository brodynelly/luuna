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
  const event = [...events].reverse().find((event) => typeof event.payload.reason === "string");
  return typeof event?.payload.reason === "string" ? event.payload.reason : "";
}
