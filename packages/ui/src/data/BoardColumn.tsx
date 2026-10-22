import { createElement, useId } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface BoardColumnProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  count: number;
  /** What the count counts, read after the number by screen readers. */
  countLabel?: string;
  /** One sentence about what the column holds. */
  scope?: ReactNode;
  headingLevel?: 3 | 4;
  /** A stable id for the heading; without it one is generated. The body list is labelled by it. */
  headingId?: string;
  /** Class for the list or div that holds the cards. */
  bodyClassName?: string;
  /** `ul` or `ol` when the children are `li` items. */
  as?: "div" | "ul" | "ol";
  children?: ReactNode;
}

/** Structure only: a labelled section with a heading, a count and a body. It does not move cards. */
export function BoardColumn({ title, count, countLabel = "items", scope, headingLevel = 3, headingId: givenId, bodyClassName, as = "div", className, children, ...rest }: BoardColumnProps) {
  const generated = useId();
  const headingId = givenId ?? generated;
  const list = as === "ul" || as === "ol";
  return <section className={cx("board-column", className)} aria-labelledby={headingId} {...rest}>
    <header className="board-column-head">
      {createElement(`h${headingLevel}`, { id: headingId }, title)}
      <span className="board-column-count">{count}<span className="visually-hidden"> {countLabel}</span></span>
    </header>
    {scope !== undefined && <p className="scope">{scope}</p>}
    {createElement(as, { className: cx("board-column-body", bodyClassName), "aria-labelledby": list ? headingId : undefined }, children)}
  </section>;
}
