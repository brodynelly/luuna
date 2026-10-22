import { useCallback, useLayoutEffect, useRef, type ReactNode, type RefCallback } from "react";
import { parseCssTime } from "./glide";
import { createCountUp, createRevealController, type Disposable } from "./motionControllers";

/**
 * Motion primitives: staggered entrance, number count-up and the drawn checkmark. The look is
 * CSS (design/motion.css); behaviour is the DOM-free controllers in motionControllers.ts, wired
 * here to real elements. Static markup is final markup: server rendering shows the settled
 * state, and animation starts only after mount. Nothing here sets React state per frame, and
 * nothing decides a state; it only presents the runtime's.
 */

/**
 * A ref callback that numbers an element's children (`--i`, capped at 10) and marks the element
 * `data-revealed` once the entrance has played, so children added later never animate. Plays once
 * per mount and causes no React state change.
 */
export function useReveal<T extends HTMLElement>(): RefCallback<T> {
  const controller = useRef<Disposable | null>(null);
  return useCallback((element: T | null) => {
    controller.current?.dispose();
    controller.current = null;
    if (!element) return;
    const style = window.getComputedStyle(element);
    controller.current = createRevealController({ children: [...element.children].filter((child): child is HTMLElement => child instanceof HTMLElement), setAttribute: (name, value) => element.setAttribute(name, value) }, {
      stepMs: parseCssTime(style.getPropertyValue("--duration-stagger"), 35),
      durationMs: parseCssTime(style.getPropertyValue("--duration-large"), 340),
      setTimer: (callback, ms) => window.setTimeout(callback, ms),
      clearTimer: (handle) => window.clearTimeout(handle),
    });
  }, []);
}

/** A group whose children fade and rise in one after another, once, when it mounts. */
export function Reveal({ className, label, children }: { className?: string; label?: string; children: ReactNode }) {
  const ref = useReveal<HTMLDivElement>();
  return <div ref={ref} className={["reveal", className].filter(Boolean).join(" ")} role={label ? "group" : undefined} aria-label={label}>{children}</div>;
}

const plain = (value: number) => String(value);

/** A number that counts up to `value` once when it mounts. The markup always holds the final value; a later change shows at once. */
export function CountUp({ value, format = plain, className }: { value: number; format?: (value: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const formatRef = useRef(format);
  formatRef.current = format;
  const mounted = useRef(value);
  useLayoutEffect(() => {
    const element = ref.current;
    const node = element?.firstChild;
    if (!element || !node || node.nodeType !== 3 || value !== mounted.current) return;
    const durationMs = parseCssTime(window.getComputedStyle(element).getPropertyValue("--duration-count"), 800);
    const run = createCountUp({
      node, value, format: (next) => formatRef.current(next), durationMs,
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (handle) => window.cancelAnimationFrame(handle),
      now: () => performance.now(),
    });
    return () => {
      run.dispose();
      // A cancelled tween must not leave a partial number behind.
      node.nodeValue = formatRef.current(value);
    };
  }, [value]);
  return <span ref={ref} className={["count-up", className].filter(Boolean).join(" ")}>{format(value)}</span>;
}

export type CheckSize = "sm" | "md" | "lg";

/** A circle and a check that draw themselves once (success moments). Decorative unless `label` is given. */
export function CheckDraw({ label, size }: { label?: string; size?: CheckSize }) {
  const named = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const, focusable: "false" as const };
  return <svg className="check-draw" data-size={size} viewBox="0 0 24 24" {...named}>
    <circle cx="12" cy="12" r="9" pathLength={1} />
    <path d="M8 12.5l2.7 2.7L16 9.5" pathLength={1} />
  </svg>;
}
