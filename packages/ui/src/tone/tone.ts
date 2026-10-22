import type { BaselineStatus, CandidateStatus, CheckStatus, LeaseState, ProposedCheck, ReviewFinding, ReviewResult, RunState } from "@luuna/api-client";

/**
 * Six outcome tones, each carried by colour, a shape mark and the unchanged runtime text.
 * Green (success) is earned: only passed durable evidence and a live connection use it.
 * The maps are exhaustive over the api-client unions, so a new runtime state fails
 * `npm run typecheck` until it is given a tone here. Presentation only: the runtime decides.
 */
export type Tone = "success" | "active" | "danger" | "attention" | "neutral" | "interrupted";
export const TONES: readonly Tone[] = ["success", "active", "danger", "attention", "neutral", "interrupted"];

/** A finished process is not evidence; waiting on the developer is attention. */
export const runTone: Record<RunState, Tone> = {
  queued: "neutral",
  running: "active",
  completed: "neutral",
  failed: "danger",
  cancelled: "neutral",
  interrupted: "interrupted",
  discovered: "neutral",
  exploring: "active",
  testing_blocked: "danger",
  plan_ready: "attention",
  approved: "attention",
  implementing: "active",
  validating: "active",
  reviewing: "active",
  reviewed: "success",
  paused: "attention",
};

export const candidateTone: Record<CandidateStatus, Tone> = {
  pending: "neutral",
  validating: "active",
  reviewing: "active",
  reviewed: "success",
  failed: "danger",
  testing_blocked: "danger",
  paused: "attention",
  cancelled: "neutral",
  interrupted: "interrupted",
};

export const checkTone: Record<CheckStatus, Tone> = {
  passed: "success",
  failed: "danger",
  blocked: "danger",
  cancelled: "neutral",
  interrupted: "interrupted",
};

export const baselineTone: Record<BaselineStatus, Tone> = { ...checkTone, running: "active" };

export const verdictTone: Record<ReviewResult["verdict"], Tone> = {
  passed: "success",
  changes_required: "danger",
  blocked: "danger",
};

export const severityTone: Record<ReviewFinding["severity"], Tone> = {
  info: "neutral",
  warning: "attention",
  blocking: "danger",
};

/** An abandoned lease keeps its worktree: interrupted, not failed. */
export const leaseTone: Record<LeaseState, Tone> = {
  active: "active",
  released: "neutral",
  abandoned: "interrupted",
};

/** An inferred recipe is an uncertainty marker; an observed one is a plain descriptor. */
export const confidenceTone: Record<ProposedCheck["confidence"], Tone | undefined> = {
  observed: undefined,
  inferred: "attention",
};

/** An unconfirmed project blocks tickets; a confirmed revision is a plain descriptor. */
export function manifestTone(revision: number): Tone | undefined {
  return revision > 0 ? undefined : "attention";
}

export type ConnectionState = "connected" | "reconnecting" | "offline";
/** A lost runtime is an interruption, never a failure: its work is durable. */
export const connectionTone: Record<ConnectionState, Tone> = {
  connected: "success",
  reconnecting: "interrupted",
  offline: "neutral",
};
