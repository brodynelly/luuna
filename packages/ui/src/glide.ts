/**
 * Pure math for following live output: a critically damped spring solved in closed form, the
 * pin test, and token parsing. No DOM; presentation only (docs/DESIGN-SYSTEM.md, Following live output).
 */

/** From rest, the offset is under 1% of its start after `durationMs` ((1 + 6.64) * e^-6.64 is about 0.00998). */
const SETTLE = 6.64;
const SNAP_DISTANCE_PX = 0.5;
const SNAP_SPEED_PX_PER_MS = 0.02;

/** `x` is the signed offset from the target in px and `v` its rate in px per ms. */
export interface SpringState { x: number; v: number }

/**
 * Advances the spring by `dtMs`. The closed form is stable for any step, so a long frame or a
 * backgrounded window cannot blow up. A non-positive duration lands on the target at once.
 */
export function springStep(state: SpringState, dtMs: number, durationMs: number): SpringState {
  if (!(durationMs > 0)) return { x: 0, v: 0 };
  const dt = dtMs > 0 ? dtMs : 0;
  if (dt === 0) return { x: state.x, v: state.v };
  const omega = SETTLE / durationMs;
  const decay = Math.exp(-omega * dt);
  const carry = state.v + omega * state.x;
  const next = { x: (state.x + carry * dt) * decay, v: (state.v - omega * carry * dt) * decay };
  return settled(next) ? { x: 0, v: 0 } : next;
}

export function settled(state: SpringState): boolean {
  return Math.abs(state.x) < SNAP_DISTANCE_PX && Math.abs(state.v) < SNAP_SPEED_PX_PER_MS;
}

export function distanceToBottom(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight - scrollTop);
}

export function isNearBottom(distance: number, thresholdPx: number): boolean {
  return distance <= thresholdPx;
}

/** Parses a CSS time (`160ms`, `0.16s`) to milliseconds; an empty or invalid value gives the fallback. */
export function parseCssTime(value: string, fallbackMs: number): number {
  const match = /^\s*(-?\d*\.?\d+)\s*(ms|s)\s*$/i.exec(value);
  if (!match) return fallbackMs;
  const amount = Number(match[1]) * (match[2]!.toLowerCase() === "s" ? 1000 : 1);
  return Number.isFinite(amount) && amount >= 0 ? amount : fallbackMs;
}

/** Parses a CSS pixel length (`48px`); an empty or invalid value gives the fallback. */
export function parseCssPx(value: string, fallbackPx: number): number {
  const match = /^\s*(-?\d*\.?\d+)\s*px\s*$/i.exec(value);
  if (!match) return fallbackPx;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : fallbackPx;
}

/** Rounds to a device pixel so text never rests at a fractional offset. */
export function snapToDevicePixel(value: number, dpr: number): number {
  const scale = dpr > 0 ? dpr : 1;
  return Math.round(value * scale) / scale;
}
