import type { ReactNode } from "react";

/**
 * Feedback states: loading rows, the empty-pane placeholder, an indeterminate progress bar,
 * streaming dots and the static success check. All motion is CSS (design/motion.css) and is
 * functional only, with a static reduced-motion fallback (ADR 0033).
 */

/** Shown while a view reads the runtime: placeholder rows in the shape of the content, announced once. */
export function Loading({ label, rows = 3 }: { label: string; rows?: number }) {
  return <div className="skeleton" role="status" aria-live="polite">
    <span className="visually-hidden">{label}</span>
    {Array.from({ length: rows }, (_, index) => <span key={index} className="skeleton-row" aria-hidden="true" />)}
  </div>;
}

/** The empty-activity placeholder of a pane that shows a selection. */
export function Placeholder({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return <div className="activity-empty empty-box"><span aria-hidden="true">◌</span><p>{title}</p>{children && <small>{children}</small>}</div>;
}

/** A thin indeterminate bar: work is under way, how far is unknown (no `aria-valuenow`). */
export function ProgressBar({ label }: { label: string }) {
  return <div className="progress-bar" role="progressbar" aria-label={label} />;
}

/** Three dots that pulse while output streams. Decorative unless `label` is given. */
export function StreamingDots({ label }: { label?: string }) {
  return <span className="streaming-dots" aria-hidden={label ? undefined : "true"} role={label ? "img" : undefined} aria-label={label}><span /><span /><span /></span>;
}

export type CheckSize = "sm" | "md" | "lg";

/** A static check beside a recorded success (a passed verdict, a healthy environment). It never animates. Decorative unless `label` is given. */
export function CheckDraw({ label, size }: { label?: string; size?: CheckSize }) {
  const named = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const, focusable: "false" as const };
  return <svg className="check-draw" data-size={size} viewBox="0 0 24 24" {...named}>
    <circle cx="12" cy="12" r="9" pathLength={1} />
    <path d="M8 12.5l2.7 2.7L16 9.5" pathLength={1} />
  </svg>;
}
