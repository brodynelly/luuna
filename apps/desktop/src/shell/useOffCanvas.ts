import { useCallback, useEffect, useRef, useState } from "react";
import { NARROW_QUERY, navKey } from "./offCanvas";

export interface CloseOptions { restoreFocus?: boolean; focusMain?: boolean }

const narrowNow = () => typeof matchMedia === "function" && matchMedia(NARROW_QUERY).matches;

/**
 * The off-canvas sidebar under 768 px: `open` (never true on load), `narrow`, and the actions. Opening
 * focuses the current view's item; closing by Escape or scrim returns focus to the top bar's menu
 * button, and closing by choosing a view focuses the content instead. Widening the window closes it.
 */
export function useOffCanvas() {
  const [narrow, setNarrow] = useState(narrowNow);
  const [open, setOpen] = useState(false);
  const pending = useRef<"menu" | "main" | null>(null);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(NARROW_QUERY);
    const change = () => { setNarrow(query.matches); if (!query.matches) setOpen(false); };
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (open) {
      document.querySelector<HTMLElement>("#app-sidebar [aria-current=\"page\"]")?.focus();
      return;
    }
    const target = pending.current;
    pending.current = null;
    if (target) document.getElementById(target === "menu" ? "nav-menu" : "main")?.focus();
  }, [open]);
  const close = useCallback((options: CloseOptions = {}) => {
    pending.current = options.restoreFocus ? "menu" : options.focusMain ? "main" : null;
    setOpen(false);
  }, []);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (navKey(event, true)) close({ restoreFocus: true }); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, close]);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  return { open, narrow, toggle, close };
}
