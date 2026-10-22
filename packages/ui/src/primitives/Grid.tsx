import type { HTMLAttributes } from "react";
import { columnAttributes, cx } from "./tokens";
import type { Columns, Gap, MinItem, ResponsiveColumns } from "./tokens";

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /** Equal columns: a count that holds at every width, or one per named breakpoint (compact, narrow). */
  cols: Columns | ResponsiveColumns;
  gap?: Gap;
}

/** A grid of equal columns that can drop to fewer at the two breakpoints. */
export function Grid({ cols, gap, className, ...rest }: GridProps) {
  return <div {...rest} {...columnAttributes(cols)} className={cx("prim-grid", gap !== undefined && "prim-gap", className)} data-gap={gap} />;
}

export interface SimpleGridProps extends HTMLAttributes<HTMLDivElement> {
  /** The narrowest an item may get before the grid adds a row: a field or a hint column. */
  minItem?: MinItem;
  gap?: Gap;
}

/** As many columns as fit, none narrower than `minItem`; needs no breakpoint. */
export function SimpleGrid({ minItem = "field", gap, className, ...rest }: SimpleGridProps) {
  return <div {...rest} className={cx("prim-simple-grid", gap !== undefined && "prim-gap", className)} data-gap={gap} data-min={minItem} />;
}
