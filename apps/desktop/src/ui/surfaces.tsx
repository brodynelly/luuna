import { useCallback, useRef, type ReactNode, type RefCallback } from "react";
import { prefersReducedMotion } from "./motion-math";
import { createGlowTracker, type Disposable } from "./motionControllers";

/**
 * Decorative surfaces: a card whose glow follows a fine pointer, and the aurora wash for an empty
 * state. Both are presentation only; text never sits on the vivid aurora, and the glow is a
 * pale layer behind the content.
 */

/** A card (same markup as `Card`) with a pointer glow. Only a fine pointer without reduced motion attaches the tracker. */
export function GlowSurface({ className, label, children }: { className?: string; label?: string; children: ReactNode }) {
  const tracker = useRef<Disposable | null>(null);
  const ref: RefCallback<HTMLDivElement> = useCallback((element: HTMLDivElement | null) => {
    tracker.current?.dispose();
    tracker.current = null;
    if (!element || typeof window.matchMedia !== "function" || !window.matchMedia("(pointer: fine)").matches || prefersReducedMotion()) return;
    const resize = { add: (listener: () => void) => window.addEventListener("resize", listener, { passive: true }), remove: (listener: () => void) => window.removeEventListener("resize", listener) };
    tracker.current = createGlowTracker(element, { requestFrame: (callback) => window.requestAnimationFrame(callback), cancelFrame: (handle) => window.cancelAnimationFrame(handle) }, resize);
  }, []);
  return <div ref={ref} className={["card", "glow-surface", className].filter(Boolean).join(" ")} role={label ? "group" : undefined} aria-label={label}>{children}</div>;
}

/** A soft drifting colour wash. Decorative; needs a positioned, isolated parent (`EmptyState wash` provides one). */
export function Aurora({ className, intensity = "subtle" }: { className?: string; intensity?: "subtle" | "vivid" }) {
  return <div className={["aurora", className].filter(Boolean).join(" ")} data-intensity={intensity} aria-hidden="true" />;
}
