import type { DetailsHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface NavGroupProps extends Omit<DetailsHTMLAttributes<HTMLDetailsElement>, "open"> {
  label: string;
  /** Open on first render; toggling afterwards is native and uncontrolled. */
  defaultOpen?: boolean;
  /** `NavItem` list items. */
  children: ReactNode;
}

/** A collapsible group of views on a native `<details>`: Tab reaches the summary, Enter and Space toggle it. */
export function NavGroup({ label, defaultOpen, className, children, ...rest }: NavGroupProps) {
  return <details className={cx("nav-group", className)} open={defaultOpen} {...rest}>
    <summary className="nav-group-summary sidebar-label">{label}</summary>
    <ul className="nav-group-list" aria-label={label}>{children}</ul>
  </details>;
}
