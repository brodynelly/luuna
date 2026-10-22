import { createElement } from "react";
import type { HTMLAttributes } from "react";
import { cx } from "./tokens";
import type { Gap } from "./tokens";

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  /** `muted` is a quiet ground for grouped settings; `raised` is a card (shadow in light, none in dark). */
  level?: "muted" | "raised";
  /** The panel padding. */
  padded?: boolean;
  /** A step on the space scale instead of the panel padding. */
  pad?: Gap;
  /** `section`, `aside` and `article` are landmarks only with an aria-label or aria-labelledby. `li` makes a card ground a list item (put it directly inside a `ul`/`ol`). */
  as?: "div" | "section" | "aside" | "article" | "li";
  /** The card shadow token (none in dark). Unset keeps the level's own: raised has it, muted does not. `true` adds it to muted; `false` removes it from raised. */
  shadow?: boolean;
}

/** The one border, radius and ground that cards, trays and panels share. */
export function Surface({ level = "raised", padded, pad, as = "div", shadow, className, ...rest }: SurfaceProps) {
  const padding = pad ?? (padded ? "panel" : undefined);
  return createElement(as, { ...rest, className: cx("prim-surface", padding !== undefined && "prim-pad", className), "data-level": level, "data-pad": padding, "data-shadow": shadow === undefined ? undefined : String(shadow) });
}
