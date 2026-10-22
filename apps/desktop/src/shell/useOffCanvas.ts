import { useCallback, useEffect, useRef, useState } from "react";
import { closeTarget, NARROW_QUERY, navKey, settleFocus, watchNarrow } from "./offCanvas";
import type { FocusTarget } from "./offCanvas";

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
  const pending = useRef<FocusTarget>(null);
  useEffect(() => watchNarrow(typeof matchMedia === "function" ? matchMedia : undefined, (now) => { setNarrow(now); if (!now) setOpen(false); }), []);
  useEffect(() => { pending.current = settleFocus(document, open, pending.current); }, [open]);
  const close = useCallback((options: CloseOptions = {}) => {
    pending.current = closeTarget(options);
    setOpen(false);
  }, []);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (navKey(event, true)) close({ restoreFocus: true }); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, close]);
  // Ctrl+\ while open closes like Escape does, returning focus to the menu button.
  const toggle = useCallback(() => { if (open) close({ restoreFocus: true }); else setOpen(true); }, [open, close]);
  return { open, narrow, toggle, close };
}
