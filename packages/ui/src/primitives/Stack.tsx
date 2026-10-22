import { createElement } from "react";
import type { HTMLAttributes } from "react";
import { cx } from "./tokens";
import type { StackAlign, Gap, StackJustify } from "./tokens";

export interface StackProps extends HTMLAttributes<HTMLElement> {
  /** A step on the space scale; no free values. */
  gap?: Gap;
  align?: StackAlign;
  justify?: Exclude<StackJustify, "between">;
  /** `ul` and `ol` keep their list role (list-style none drops it in WebKit); `section` needs an aria-label to be a landmark. */
  as?: "div" | "ul" | "ol" | "section";
}

/** Children in one column, spaced by the token scale. */
export function Stack({ gap, align, justify, as = "div", className, ...rest }: StackProps) {
  const list = as === "ul" || as === "ol";
  return createElement(as, { role: list ? "list" : undefined, ...rest, className: cx("prim-stack", gap !== undefined && "prim-gap", className), "data-gap": gap, "data-align": align, "data-justify": justify });
}

export interface InlineProps extends HTMLAttributes<HTMLElement> {
  /** A step on the space scale; no free values. */
  gap?: Gap;
  align?: StackAlign | "baseline";
  justify?: StackJustify;
  /** Let items continue on the next line instead of shrinking. */
  wrap?: boolean;
  /** `ul` and `ol` keep their list role; `section` needs an aria-label to be a landmark. */
  as?: "div" | "span" | "ul" | "ol" | "section";
}

/** Children in one row, spaced by the token scale. */
export function Inline({ gap, align, justify, wrap, as = "div", className, ...rest }: InlineProps) {
  const list = as === "ul" || as === "ol";
  return createElement(as, { role: list ? "list" : undefined, ...rest, className: cx("prim-inline", gap !== undefined && "prim-gap", className), "data-gap": gap, "data-align": align, "data-justify": justify, "data-wrap": wrap ? "" : undefined });
}

export interface CenterProps extends HTMLAttributes<HTMLElement> {
  /** Shrink to the content instead of filling the line. */
  inline?: boolean;
  /** Reserve the empty-state height so a lone child sits mid-region. */
  fill?: boolean;
  as?: "div" | "section";
}

/** Centres its children on both axes. */
export function Center({ inline, fill, as = "div", className, ...rest }: CenterProps) {
  return createElement(as, { ...rest, className: cx("prim-center", className), "data-inline": inline ? "" : undefined, "data-fill": fill ? "" : undefined });
}

export interface SpacerProps extends HTMLAttributes<HTMLElement> {
  /** A fixed step on the space scale; without it the spacer grows to push its neighbours apart. */
  size?: Gap;
}

/** Empty space: flexible inside a row, fixed when sized. Never announced. */
export function Spacer({ size, className, ...rest }: SpacerProps) {
  return <div aria-hidden="true" {...rest} className={cx("prim-spacer", className)} data-size={size} />;
}
