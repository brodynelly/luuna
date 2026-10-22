import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface MetricCardProps extends HTMLAttributes<HTMLDListElement> {
  label: ReactNode;
  /** Already formatted by the caller. Static: never counted up or animated. */
  value: number | string;
  hint?: ReactNode;
  /** No figure to show: renders `emptyLabel` instead of the value. */
  empty?: boolean;
  emptyLabel?: string;
}

/** A static, untoned metric. A count is a projection of records, not evidence, so it carries no tone. */
export function MetricCard({ label, value, hint, empty, emptyLabel = "No data", className, ...rest }: MetricCardProps) {
  return <dl className={cx("metric-card", className)} {...rest}>
    <dt>{label}</dt>
    <dd className={empty ? "metric-value metric-empty" : "metric-value"}>{empty ? emptyLabel : value}</dd>
    {hint !== undefined && <dd className="metric-hint">{hint}</dd>}
  </dl>;
}
