import { distanceToBottom, isNearBottom, settled, snapToDevicePixel, springStep, type SpringState } from "./glide";

/**
 * Keeps a scroll region pinned to its newest content with a short eased glide. Pure of the DOM:
 * it drives an injected surface and frame scheduler, so it is unit-testable. Presentation only;
 * it never decides run state. Release is by user intent, not by a decreasing scrollTop, because
 * scroll anchoring (rows trimmed from the top) and our own writes also move scrollTop.
 */

export interface ScrollSurface {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export interface StickyDeps {
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
  now: () => number;
  devicePixelRatio: () => number;
  readTokens: () => { durationMs: number; thresholdPx: number };
}

export interface StickyScroll {
  contentChanged: () => void;
  userIntent: () => void;
  scrolled: () => void;
  setEnabled: (enabled: boolean) => void;
  reset: () => void;
  dispose: () => void;
  isPinned: () => boolean;
}

export function createStickyScroll(surface: ScrollSurface, deps: StickyDeps): StickyScroll {
  let pinned = true;
  let enabled = true;
  let gliding = false;
  let firstFill = true;
  let handle: number | null = null;
  let spring: SpringState = { x: 0, v: 0 };
  let position = 0;
  let lastWritten = 0;
  let lastFrame = 0;

  function cancel(): void {
    if (handle !== null) deps.cancelFrame(handle);
    handle = null;
    gliding = false;
    spring = { x: 0, v: 0 };
  }

  function schedule(): void {
    if (handle === null) handle = deps.requestFrame(frame);
  }

  /** One read phase, then at most one write. */
  function frame(): void {
    handle = null;
    if (!gliding) return;
    const { durationMs } = deps.readTokens();
    const top = surface.scrollTop;
    const height = surface.scrollHeight;
    const client = surface.clientHeight;
    if (Math.abs(top - lastWritten) > 1) {
      // User intent cancels the glide before a frame runs, so an unexplained change while pinned
      // is scroll anchoring (rows trimmed from the top): re-seed from the read position and go on.
      if (!pinned || !enabled) { cancel(); return; }
      position = top;
      lastWritten = top;
      spring = { x: 0, v: 0 };
    }
    const target = Math.max(0, height - client);
    const at = deps.now();
    spring = springStep({ x: position - target, v: spring.v }, at - lastFrame, durationMs);
    lastFrame = at;
    let next = target + spring.x;
    if (next < 0 || next > target) { next = Math.min(Math.max(next, 0), target); spring = { x: 0, v: 0 }; }
    const done = settled(spring) && Math.abs(next - target) < 0.5;
    if (done) next = target;
    position = next;
    lastWritten = snapToDevicePixel(next, deps.devicePixelRatio());
    surface.scrollTop = lastWritten;
    if (done) { gliding = false; spring = { x: 0, v: 0 }; return; }
    schedule();
  }

  function contentChanged(): void {
    if (!enabled || !pinned) return;
    const { durationMs } = deps.readTokens();
    const top = surface.scrollTop;
    const target = Math.max(0, surface.scrollHeight - surface.clientHeight);
    if (firstFill || durationMs <= 0) {
      cancel();
      if (target > 0) firstFill = false;
      const jump = snapToDevicePixel(target, deps.devicePixelRatio());
      if (jump !== top) surface.scrollTop = jump;
      position = target;
      lastWritten = jump;
      return;
    }
    if (!gliding) {
      position = top;
      lastWritten = top;
      spring = { x: 0, v: 0 };
      lastFrame = deps.now();
      gliding = true;
    }
    schedule();
  }

  return {
    contentChanged,
    userIntent() { cancel(); },
    scrolled() {
      if (gliding) return;
      pinned = isNearBottom(distanceToBottom(surface.scrollTop, surface.scrollHeight, surface.clientHeight), deps.readTokens().thresholdPx);
    },
    setEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      cancel();
      if (next) { pinned = true; firstFill = true; contentChanged(); }
    },
    reset() { cancel(); pinned = true; firstFill = true; },
    dispose() { cancel(); enabled = false; },
    isPinned: () => pinned,
  };
}
