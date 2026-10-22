import type { HTMLAttributes } from "react";
import { cx } from "./tokens";
import type { TitleSize } from "./tokens";

export interface TitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /** The outline level: h2 per view, h3 per section, h4 inside a section. */
  order: 2 | 3 | 4;
  /** A Ledger type style when the visual size should differ from the level; omitted, the level's own style applies. */
  size?: TitleSize;
}

/** A heading. The outline stays the same on every view because headings are emitted from the library alone. */
export function Title({ order, size, className, ...rest }: TitleProps) {
  const props = { ...rest, className: cx("prim-title", className), "data-size": size };
  if (order === 2) return <h2 {...props} />;
  if (order === 3) return <h3 {...props} />;
  return <h4 {...props} />;
}
