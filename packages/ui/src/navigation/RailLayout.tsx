import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface RailLayoutProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  main: ReactNode;
  /** The side rail; the layout is single-column without it. */
  rail?: ReactNode;
  /** The rail's accessible name (it is an `aside` landmark). */
  railLabel?: string;
}

/** Main content with an optional trailing rail (`--rail-width`); below 920px the rail stacks under the main column. */
export function RailLayout({ main, rail, railLabel = "Details", className, ...rest }: RailLayoutProps) {
  return <div className={cx("rail-layout", className)} data-rail={rail ? "" : undefined} {...rest}>
    <div className="rail-main">{main}</div>
    {rail && <aside className="rail-aside" aria-label={railLabel}>{rail}</aside>}
  </div>;
}
