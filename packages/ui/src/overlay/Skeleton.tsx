import type { HTMLAttributes } from "react";

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Rows to draw; with more than one the last row is shorter, like the end of a paragraph. */
  lines?: number;
  /** Row height on the control scale: sm 28, md 32, lg a card-sized block. */
  height?: "sm" | "md" | "lg";
}

/**
 * A static placeholder in the shape of the content that is loading: flat blocks on the fill role. It never shimmers or
 * pulses, so reduced motion looks identical. It is aria-hidden; the region it stands in for sets aria-busy="true"
 * and the surrounding status text says what is loading.
 */
export function Skeleton({ lines = 1, height = "md", className, ...rest }: SkeletonProps) {
  const count = Math.max(1, Math.floor(lines));
  return <span {...rest} className={["ov-skeleton", className].filter(Boolean).join(" ")} data-height={height} aria-hidden="true">
    {Array.from({ length: count }, (_, index) => <span key={index} className="ov-skeleton-row" />)}
  </span>;
}
