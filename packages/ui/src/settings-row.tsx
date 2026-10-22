import { useId } from "react";
import type { ReactNode } from "react";

/**
 * Settings row (Ledger SettingsRow): a titled setting with an optional status badge, a description
 * and a trailing control. It presents what the runtime reports and decides nothing. The title is not
 * a heading, so the outline stays with `Section`. A control without a visible label of its own (a
 * `Switch` whose label is `VisuallyHidden`) passes `aria-labelledby` pointing at the row title.
 */
export function SettingsRow({ title, description, badge, control, stacked = false, className, children, ...marker }: { title: ReactNode; description?: ReactNode; badge?: ReactNode; control?: ReactNode; stacked?: boolean; className?: string; children?: ReactNode; "data-capability"?: string }) {
  const id = useId();
  const classes = ["settings-row", stacked ? "settings-row-stacked" : undefined, className].filter(Boolean).join(" ");
  return <div className={classes} role="group" aria-labelledby={id} {...marker}>
    <div className="settings-row-text"><span className="settings-row-title" id={id}>{title}{badge}</span>{description && <span className="settings-row-desc">{description}</span>}{children}</div>
    {control && <div className="settings-row-control">{control}</div>}
  </div>;
}
