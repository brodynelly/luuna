// DOM-free: when a scroll region needs the keyboard. A region that fits needs no tab stop; one that scrolls must be
// focusable and named, or keyboard users cannot reach what is past its edge.
export interface ScrollMetrics { scrollHeight: number; clientHeight: number; scrollWidth: number; clientWidth: number }

export type ScrollAxis = "y" | "x" | "both";

/** Whether content extends past the visible box on an axis the region scrolls along (a one-pixel rounding error is not overflow). */
export function overflows(metrics: ScrollMetrics, axis: ScrollAxis = "y"): boolean {
  const tall = metrics.scrollHeight - metrics.clientHeight > 1;
  const wide = metrics.scrollWidth - metrics.clientWidth > 1;
  return axis === "y" ? tall : axis === "x" ? wide : tall || wide;
}
