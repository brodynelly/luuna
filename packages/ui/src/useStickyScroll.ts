import { useCallback, useLayoutEffect, useRef, type RefCallback } from "react";
import { parseCssPx, parseCssTime } from "./glide";
import { createStickyScroll, type StickyScroll } from "./stickyScroll";

const INTENT_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/**
 * Thin wiring of the sticky-scroll controller to a real element: rAF, listeners and the
 * `--duration-follow` / `--follow-threshold` tokens. It sets no React state, so following never
 * re-renders. `followKey` changes mean "content changed"; a numeric key that drops means reset.
 */
export function useStickyScroll<T extends HTMLElement>({ enabled, followKey }: { enabled: boolean; followKey: unknown }): RefCallback<T> {
  const controller = useRef<StickyScroll | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const previousKey = useRef<unknown>(followKey);
  const cleanups = useRef<Array<() => void>>([]);

  const ref = useCallback((element: T | null) => {
    controller.current?.dispose();
    controller.current = null;
    cleanups.current.forEach((cleanup) => cleanup());
    cleanups.current = [];
    if (!element) return;
    const sticky = createStickyScroll(element, {
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (handle) => window.cancelAnimationFrame(handle),
      now: () => performance.now(),
      devicePixelRatio: () => window.devicePixelRatio || 1,
      readTokens: () => {
        const style = window.getComputedStyle(element);
        return {
          durationMs: parseCssTime(style.getPropertyValue("--duration-follow"), 160),
          thresholdPx: parseCssPx(style.getPropertyValue("--follow-threshold"), 48),
        };
      },
    });
    const on = <K extends keyof HTMLElementEventMap>(type: K, listener: (event: HTMLElementEventMap[K]) => void, passive = true) => {
      element.addEventListener(type, listener, { passive });
      cleanups.current.push(() => element.removeEventListener(type, listener));
    };
    on("wheel", (event) => { if (event.deltaY < 0) sticky.userIntent(); });
    on("touchstart", () => sticky.userIntent());
    on("pointerdown", () => sticky.userIntent());
    on("keydown", (event) => { if (INTENT_KEYS.has(event.key)) sticky.userIntent(); });
    on("scroll", () => sticky.scrolled());
    controller.current = sticky;
    if (!enabledRef.current) sticky.setEnabled(false);
    else sticky.contentChanged();
  }, []);

  useLayoutEffect(() => { controller.current?.setEnabled(enabled); }, [enabled]);
  useLayoutEffect(() => {
    const before = previousKey.current;
    previousKey.current = followKey;
    if (Object.is(before, followKey)) return;
    if (typeof before === "number" && typeof followKey === "number" && followKey < before) controller.current?.reset();
    controller.current?.contentChanged();
  }, [followKey]);
  useLayoutEffect(() => () => { controller.current?.dispose(); cleanups.current.forEach((cleanup) => cleanup()); }, []);

  return ref;
}
