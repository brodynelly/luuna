import type { HTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * Pins the connection status to the bottom of the sidebar. Keeps the `.sidebar-footer` class the shell sheet
 * styles; it sits inside the sidebar landmark and adds none of its own.
 */
export function SidebarFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("sidebar-footer", className)} {...rest}>{children}</div>;
}
