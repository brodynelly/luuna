import { createElement } from "react";
import type { HTMLAttributes } from "react";
import { cx } from "./tokens";
import type { ContainerSize } from "./tokens";

export interface ContainerProps extends HTMLAttributes<HTMLElement> {
  /** `content` is the page width, `measure` a readable line of prose, `narrow` a single-purpose column. */
  size?: ContainerSize;
  /** Add the page gutter on both sides. */
  gutter?: boolean;
  as?: "div" | "section" | "article";
}

/** A centred column with a token-bound maximum width. */
export function Container({ size = "content", gutter, as = "div", className, ...rest }: ContainerProps) {
  return createElement(as, { ...rest, className: cx("prim-container", className), "data-size": size, "data-gutter": gutter ? "" : undefined });
}
