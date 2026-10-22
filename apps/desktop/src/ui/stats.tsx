import type { ReactNode } from "react";
import { CountUp } from "./motion";

/**
 * Stat tiles: a short row of counts. A tile carries no tone, because a count is a projection of
 * records, not evidence. The markup holds the final number; CountUp only animates the first
 * paint (design/motion.css).
 */

/** A labelled group of stat tiles (`dl.stat-grid`). Not `.facts`: that class is read as exact identities. */
export function StatGrid({ label, children }: { label: string; children: ReactNode }) {
  return <dl className="stat-grid" aria-label={label}>{children}</dl>;
}

/** One term and its count. */
export function StatTile({ term, value }: { term: ReactNode; value: number }) {
  return <div className="stat-tile"><dt>{term}</dt><dd><CountUp value={value} /></dd></div>;
}
