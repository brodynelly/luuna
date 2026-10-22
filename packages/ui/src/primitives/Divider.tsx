import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./tokens";

type Base = Omit<HTMLAttributes<HTMLElement>, "children">;
export type DividerProps = Base & (
  | { orientation?: "horizontal"; /** Text set in the rule; a string is also the separator's accessible name. */ label?: ReactNode; decorative?: boolean }
  | { orientation: "vertical"; label?: never; decorative?: boolean }
);

/** A hairline between groups. Plain it is an `hr`; labelled it is a separator whose name is its text. */
export function Divider({ orientation = "horizontal", label, decorative, className, ...rest }: DividerProps) {
  const classes = cx("prim-divider", className);
  if (label !== undefined && label !== null && label !== false) {
    const name = typeof label === "string" ? label : undefined;
    return <div role={decorative ? "presentation" : "separator"} aria-label={decorative ? undefined : name} {...rest} className={classes} data-orientation="horizontal" data-labelled=""><span>{label}</span></div>;
  }
  return <hr role={decorative ? "presentation" : undefined} aria-orientation={orientation === "vertical" && !decorative ? "vertical" : undefined} {...rest} className={classes} data-orientation={orientation} />;
}
