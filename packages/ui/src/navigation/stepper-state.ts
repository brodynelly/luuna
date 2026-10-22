import type { Tone } from "../tone/tone";

export type StepState = "complete" | "current" | "upcoming" | "attention" | "blocked";

/** Each state is a tone plus visible text, so the list reads without colour. */
export const STEP_STATES: Record<StepState, { tone: Tone; text: string }> = {
  complete: { tone: "success", text: "Complete" },
  current: { tone: "active", text: "In progress" },
  upcoming: { tone: "neutral", text: "Not started" },
  attention: { tone: "attention", text: "Needs you" },
  blocked: { tone: "danger", text: "Blocked" },
};

export interface StepInput { id: string; label: string; state?: StepState; /** Supporting text under the label. */ detail?: string }
export interface ResolvedStep { id: string; label: string; state: StepState; isCurrent: boolean; detail?: string }

/**
 * Resolves each step's state. A step is complete, blocked or waiting on the developer only when the caller
 * says so (the runtime decides); without a state, the `current` step is in progress and every other is not
 * started. Position alone never completes a step.
 */
export function resolveSteps(steps: ReadonlyArray<StepInput>, current?: string): ResolvedStep[] {
  return steps.map((step) => {
    const isCurrent = step.id === current;
    const state = step.state ?? (isCurrent ? "current" : "upcoming");
    return { id: step.id, label: step.label, state, isCurrent, detail: step.detail };
  });
}
