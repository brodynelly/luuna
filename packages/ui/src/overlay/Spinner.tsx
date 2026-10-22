import type { HTMLAttributes } from "react";

export interface SpinnerProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** What is in progress, in plain words. Read by screen readers; shown as text when reduced motion hides the ring. */
  label?: string;
}

/**
 * A rotating ring for indeterminate waits (transform only). role="status" announces the label politely. Under reduced
 * motion the ring is hidden and the label shows as static text, so meaning never depends on movement. Use ProgressBar
 * for known progress and Skeleton for content that is about to appear.
 */
export function Spinner({ label = "Loading", className, ...rest }: SpinnerProps) {
  return <span {...rest} className={["ov-spinner", className].filter(Boolean).join(" ")} role="status">
    <span className="ov-spinner-ring" aria-hidden="true" />
    <span className="ov-spinner-label">{label}</span>
  </span>;
}
