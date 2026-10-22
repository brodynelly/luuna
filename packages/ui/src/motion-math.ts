/**
 * Pure math for the motion helpers: easing, tweens, stagger and the tab indicator. No DOM; the
 * controllers and hooks wire these to real elements. Presentation only (ADR 0032).
 */

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export type Easing = (t: number) => number;

/** A CSS `cubic-bezier(x1, y1, x2, y2)` solved for y at a given progress t (Newton, then bisection). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const bx = (s: number) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
  const by = (s: number) => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  const dx = (s: number) => 3 * (1 - s) * (1 - s) * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2);
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const error = bx(s) - t;
      if (Math.abs(error) < 1e-6) return by(s);
      const slope = dx(s);
      if (Math.abs(slope) < 1e-6) break;
      s -= error / slope;
    }
    let low = 0;
    let high = 1;
    s = t;
    for (let i = 0; i < 40; i++) {
      const x = bx(s);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) low = s;
      else high = s;
      s = (low + high) / 2;
    }
    return by(s);
  };
}

/** The out curve of tokens-motion.css (--ease-out); a drift test keeps the two equal. */
export const EASE_OUT_POINTS = [0.16, 1, 0.3, 1] as const;
export const EASE_OUT: Easing = cubicBezier(...EASE_OUT_POINTS);

/** The stagger cap of tokens-motion.css: later children share the last step. */
export const STAGGER_CAP = 10;

/** The `--i` of child number `i`: capped, never negative. */
export function staggerIndex(i: number, cap: number = STAGGER_CAP): number {
  if (!(i > 0)) return 0;
  return Math.min(Math.floor(i), cap);
}

/** The value of a tween after `elapsedMs`; a non-positive duration or an elapsed time past it gives `to`. */
export function tweenValue(from: number, to: number, elapsedMs: number, durationMs: number, ease: Easing = EASE_OUT): number {
  if (!(durationMs > 0) || elapsedMs >= durationMs) return to;
  if (!(elapsedMs > 0)) return from;
  return lerp(from, to, ease(elapsedMs / durationMs));
}

export interface MotionBox { left: number; top: number; width: number; height: number }

/** The indicator transform: its offset inside the tab list and its width as a fraction of the list's. */
export function indicatorGeometry(list: MotionBox, tab: MotionBox): { x: number; y: number; scale: number } {
  return { x: tab.left - list.left, y: tab.top - list.top, scale: list.width > 0 ? tab.width / list.width : 0 };
}

/** True under `prefers-reduced-motion: reduce`; false when there is no window or no `matchMedia`. */
export function prefersReducedMotion(match?: (query: string) => { matches: boolean }): boolean {
  const query = match ?? (typeof window !== "undefined" && typeof window.matchMedia === "function" ? (text: string) => window.matchMedia(text) : undefined);
  return query ? query("(prefers-reduced-motion: reduce)").matches : false;
}
