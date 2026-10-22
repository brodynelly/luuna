import type { HTMLAttributes } from "react";
import { joinClass } from "./identity";

export interface ButtonGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Names the group. Required so the grouping is announced. */
  label: string;
  /** Joins the buttons into one segment with shared borders. */
  attached?: boolean;
}

/** Related buttons in one labelled group. Order is DOM order; Tab moves through them as usual. */
export function ButtonGroup({ label, attached = false, className, children, ...rest }: ButtonGroupProps) {
  return <div {...rest} role="group" aria-label={label} className={joinClass("button-group", className)} data-attached={attached ? "true" : undefined}>{children}</div>;
}
