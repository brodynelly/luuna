import type { ReactNode } from "react";

/**
 * Metric tiles (Ledger MetricCard): a short row of counts or values. A tile carries no tone, because a
 * count is a projection of records, not evidence. The value is static, already formatted by the caller.
 */

/** A labelled group of stat tiles (`dl.stat-grid`). Not `.facts`: that class is read as exact identities. */
export function StatGrid({ label, children }: { label: string; children: ReactNode }) {
  return <dl className="stat-grid" aria-label={label}>{children}</dl>;
}

/** One term and its value, with an optional comparison line (for example "+3 since yesterday"). */
export function StatTile({ term, value, comparison }: { term: ReactNode; value: number | string; comparison?: ReactNode }) {
  return <div className="stat-tile"><dt>{term}</dt><dd className="stat-value">{value}</dd>{comparison !== undefined && <dd className="stat-comparison">{comparison}</dd>}</div>;
}
