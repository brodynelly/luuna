import type { ViewMotion } from "@luuna/ui";
export type { ViewMotion };

export type TransitionHandle = { finished: Promise<unknown>; ready?: Promise<unknown>; skipTransition(): void };
export type TransitionHost = { startViewTransition?: (update: () => void) => TransitionHandle; hidden?: boolean };

/** Reduced motion beats support; the native API needs both the function and the CSS (`@supports`). */
export function viewMotion(host: TransitionHost | undefined, supportsCss: boolean, reducedMotion: boolean): ViewMotion {
  if (reducedMotion) return "none";
  return typeof host?.startViewTransition === "function" && supportsCss ? "native" : "css";
}

const ignore = () => undefined;

/**
 * Runs `update` exactly once, inside a view transition when the motion is native. A superseded
 * transition is skipped, and a skipped or aborted one never surfaces an unhandled rejection.
 */
export function changeView(host: TransitionHost | undefined, motion: ViewMotion, update: () => void, previous?: TransitionHandle | null): TransitionHandle | null {
  if (motion !== "native" || !host || host.hidden || typeof host.startViewTransition !== "function") { update(); return null; }
  previous?.skipTransition();
  let ran = false;
  const once = () => { if (!ran) { ran = true; update(); } };
  try {
    const handle = host.startViewTransition(once);
    handle.finished.catch(ignore);
    handle.ready?.catch(ignore);
    return handle;
  } catch {
    once();
    return null;
  }
}
