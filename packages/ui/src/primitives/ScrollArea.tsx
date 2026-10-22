import type { HTMLAttributes } from "react";
import { cx } from "./tokens";
import type { ScrollHeight } from "./tokens";
import type { ScrollAxis } from "./scroll";
import { useOverflow } from "./useOverflow";

export interface ScrollAreaProps extends Omit<HTMLAttributes<HTMLDivElement>, "aria-label"> {
  /** Names the region for people who reach it by keyboard or a screen reader. */
  label: string;
  /** A bounded height from the token scale: a plan, a scrolling region or a list. */
  maxHeight?: ScrollHeight;
  axis?: ScrollAxis;
}

/** A bounded scroll region. It is a focusable, named region only while its content overflows, so a short one adds no tab stop. */
export function ScrollArea({ label, maxHeight = "scroll", axis = "y", className, ...rest }: ScrollAreaProps) {
  const { ref, scrolls } = useOverflow<HTMLDivElement>(axis);
  return <div {...rest} ref={ref} className={cx("prim-scroll", className)} data-scroll-area="" data-axis={axis} data-max={maxHeight} data-scrolls={scrolls ? "" : undefined} role={scrolls ? "region" : undefined} aria-label={scrolls ? label : undefined} tabIndex={scrolls ? 0 : undefined} />;
}
