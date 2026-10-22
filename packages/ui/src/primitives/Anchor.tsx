import type { AnchorHTMLAttributes } from "react";
import { cx } from "./tokens";

export interface AnchorProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  /** Opens a new window, marked for sight and for screen readers. */
  external?: boolean;
  /** `subtle` reads as body text with an underline; the default is the accent. */
  variant?: "accent" | "subtle";
  underline?: "hover" | "always";
}

/** A link. External ones say so in text as well as with the mark. */
export function Anchor({ external, variant = "accent", underline = "hover", className, children, ...rest }: AnchorProps) {
  const target = external ? { target: "_blank", rel: "noopener noreferrer" } : undefined;
  return <a {...target} {...rest} className={cx("prim-anchor", className)} data-variant={variant} data-underline={underline}>
    {children}
    {external && <><span className="prim-anchor-mark" aria-hidden="true">{"↗"}</span><span className="visually-hidden"> (opens in a new window)</span></>}
  </a>;
}
