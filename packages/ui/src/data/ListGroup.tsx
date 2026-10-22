import { createElement } from "react";
import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export interface ListGroupProps extends HTMLAttributes<HTMLUListElement | HTMLOListElement> {
  /** Required: smokes and screen readers find the list by its name. */
  "aria-label": string;
  /** `ol` when the order carries meaning. */
  as?: "ul" | "ol";
}

/** A separated list of `ListRow` items. A count or heading belongs to the caller's section, not this list. */
export function ListGroup({ as = "ul", className, children, ...rest }: ListGroupProps) {
  return createElement(as, { className: cx("list-group", className), ...rest }, children);
}
