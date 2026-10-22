import type { HTMLAttributes } from "react";
import { cx } from "./tokens";

export interface CodeProps extends HTMLAttributes<HTMLElement> {
  /** Follow the surrounding text size instead of the mono style. */
  size?: "mono" | "inherit";
}

/** An identity, path, hash or command inline. It wraps anywhere and is never truncated, so it is shown whole. */
export function Code({ size = "mono", className, ...rest }: CodeProps) {
  return <code {...rest} className={cx("prim-code", className)} data-size={size} />;
}
