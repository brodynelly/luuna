import { EASE_OUT, staggerIndex, tweenValue, type Easing } from "./motion-math";

/**
 * DOM-free controllers for the motion primitives, in the pattern of stickyScroll.ts: the frame
 * scheduler, the clock and the element are injected, so each is testable without a DOM. None of
 * them sets React state; they write text nodes and custom properties only.
 */

export interface Frames {
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
  now: () => number;
}

export interface Disposable { dispose: () => void }

export interface CountUpOptions extends Frames {
  node: { nodeValue: string | null };
  value: number;
  format: (value: number) => string;
  durationMs: number;
  ease?: Easing;
}

/** Tweens a text node from 0 to `value` and always ends on exactly `format(value)`. Duration 0 writes the final value at once. */
export function createCountUp(options: CountUpOptions): Disposable {
  const { node, value, format, durationMs, requestFrame, cancelFrame, now } = options;
  const ease = options.ease ?? EASE_OUT;
  const factor = 10 ** (String(value).split(".")[1] ?? "").length;
  let handle: number | undefined;
  let disposed = false;
  if (!(durationMs > 0) || !Number.isFinite(value)) {
    node.nodeValue = format(value);
    return { dispose: () => { disposed = true; } };
  }
  const start = now();
  function tick(): void {
    handle = undefined;
    if (disposed) return;
    const elapsed = now() - start;
    if (elapsed >= durationMs) { node.nodeValue = format(value); return; }
    node.nodeValue = format(Math.round(tweenValue(0, value, elapsed, durationMs, ease) * factor) / factor);
    handle = requestFrame(tick);
  }
  node.nodeValue = format(0);
  handle = requestFrame(tick);
  return { dispose: () => { disposed = true; if (handle !== undefined) cancelFrame(handle); handle = undefined; } };
}

type Listener = (event: any) => void;

export interface GlowTarget {
  getBoundingClientRect: () => { left: number; top: number };
  style: { setProperty: (name: string, value: string) => void };
  addEventListener: (type: string, listener: Listener, options?: { passive: boolean }) => void;
  removeEventListener: (type: string, listener: Listener) => void;
}

export interface ResizeSource { add: (listener: () => void) => void; remove: (listener: () => void) => void }

/** Follows the pointer over a surface: one rect read per enter or resize, one write per frame. */
export function createGlowTracker(element: GlowTarget, frames: Pick<Frames, "requestFrame" | "cancelFrame">, resize?: ResizeSource): Disposable {
  let rect = { left: 0, top: 0 };
  let pending: { x: number; y: number } | undefined;
  let handle: number | undefined;
  const measure = () => { rect = element.getBoundingClientRect(); };
  const move = (event: { clientX: number; clientY: number }) => {
    pending = { x: event.clientX, y: event.clientY };
    if (handle !== undefined) return;
    handle = frames.requestFrame(() => {
      handle = undefined;
      if (!pending) return;
      element.style.setProperty("--mx", `${pending.x - rect.left}px`);
      element.style.setProperty("--my", `${pending.y - rect.top}px`);
      pending = undefined;
    });
  };
  element.addEventListener("pointerenter", measure, { passive: true });
  element.addEventListener("pointermove", move, { passive: true });
  resize?.add(measure);
  return {
    dispose() {
      element.removeEventListener("pointerenter", measure);
      element.removeEventListener("pointermove", move);
      resize?.remove(measure);
      if (handle !== undefined) frames.cancelFrame(handle);
      handle = undefined;
      pending = undefined;
    },
  };
}

export interface RevealParent {
  children: ArrayLike<{ style: { setProperty: (name: string, value: string) => void } }>;
  setAttribute: (name: string, value: string) => void;
}

export interface RevealOptions {
  stepMs: number;
  durationMs: number;
  setTimer: (callback: () => void, ms: number) => number;
  clearTimer: (handle: number) => void;
}

/** Numbers the children once (`--i`, capped), then marks the parent revealed so later children never animate. */
export function createRevealController(parent: RevealParent, options: RevealOptions): Disposable {
  const count = parent.children.length;
  for (let index = 0; index < count; index++) parent.children[index]!.style.setProperty("--i", String(staggerIndex(index)));
  const total = staggerIndex(count - 1) * options.stepMs + options.durationMs;
  const handle = options.setTimer(() => parent.setAttribute("data-revealed", ""), Math.max(0, total));
  return { dispose: () => options.clearTimer(handle) };
}
