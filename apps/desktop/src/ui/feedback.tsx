import type { ReactNode } from "react";

/**
 * Feedback states: loading rows, the empty-pane placeholder, an indeterminate progress bar and
 * streaming dots. All motion is CSS (design/motion.css) with a static reduced-motion fallback.
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
