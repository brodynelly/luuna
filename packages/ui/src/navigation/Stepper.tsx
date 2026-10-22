import type { OlHTMLAttributes } from "react";
import { cx } from "./cx";
import { resolveSteps, STEP_STATES } from "./stepper-state";
import type { StepInput } from "./stepper-state";

export interface StepperProps extends OlHTMLAttributes<HTMLOListElement> {
  /** Required: names the list. */
  "aria-label": string;
  steps: ReadonlyArray<StepInput>;
  /** The id of the step in progress; it carries `aria-current="step"`. */
  current?: string;
}

/**
 * Ordered steps. Each shows its state as a tone mark and as text (never colour alone). Only the runtime's
 * state completes a step; without one a step is in progress (if current) or not started.
 */
export function Stepper({ steps, current, className, ...rest }: StepperProps) {
  return <ol className={cx("stepper", className)} {...rest}>
    {resolveSteps(steps, current).map((step) => {
      const { tone, text } = STEP_STATES[step.state];
      return <li key={step.id} className="stepper-step" data-state={step.state} data-tone={tone} aria-current={step.isCurrent ? "step" : undefined}>
        <i className="tone-mark" data-tone={tone} aria-hidden="true" />
        <span className="stepper-text"><span className="stepper-label">{step.label}</span>{step.detail !== undefined && <span className="stepper-detail">{step.detail}</span>}</span>
        <span className="stepper-state">{text}</span>
      </li>;
    })}
  </ol>;
}
