import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { sidebarCommand } from "./offCanvas";
import { useOffCanvas } from "./useOffCanvas";
import { changeView, viewMotion } from "./viewTransition";
import type { TransitionHandle } from "./viewTransition";
import { viewForShortcut, viewFromHash } from "../content/views";
import type { View } from "../content/views";

/** Keeps the current view in the location hash and answers the window's keyboard shortcuts. */
export function useWindowNavigation() {
  const [initial] = useState<View>(() => viewFromHash(typeof location === "undefined" ? "" : location.hash));
  const [view, setView] = useState<View>(initial);
  // The view that was entered last: its slot plays the one-time enter fade (screens/shell.css).
  const [entering, setEntering] = useState<View>(initial);
  // Static support only; reduced motion is read per navigation.
  const [motion] = useState(() => viewMotion(typeof document === "undefined" ? undefined : document, typeof CSS !== "undefined" && CSS.supports("view-transition-name: none"), false));
  const transition = useRef<TransitionHandle | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  // The off-canvas sidebar (under 768 px); choosing a view closes it and moves focus to the content.
  const nav = useOffCanvas();
  const navRef = useRef(nav);
  navRef.current = nav;
  /** Every view change goes through here: inside a view transition where supported, instant otherwise. */
  const navigate = (next: View, extra?: () => void) => {
    if (navRef.current.open) navRef.current.close({ focusMain: true });
    if (next === viewRef.current) { extra?.(); return; }
    const update = () => { extra?.(); setView(next); setEntering(next); };
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    transition.current = changeView(document, reduced ? "none" : motion, motion === "native" && !reduced ? () => flushSync(update) : update, transition.current);
  };
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [collapsed, setCollapsed] = useState(false);
  const [palette, setPalette] = useState(false);
  // Ctrl+\ and the native menu: the off-canvas panel when narrow, the icon rail otherwise.
  const sidebar = () => { if (sidebarCommand(navRef.current.narrow) === "drawer") navRef.current.toggle(); else setCollapsed((value) => !value); };
  const sidebarRef = useRef(sidebar);
  sidebarRef.current = sidebar;
  useEffect(() => {
    history.replaceState(null, "", `#${view}`);
    window.scrollTo({ top: 0 });
  }, [view]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "\\") { event.preventDefault(); sidebarRef.current(); return; }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") { event.preventDefault(); navRef.current.close(); setPalette(true); return; }
      const next = viewForShortcut(event);
      if (next) { event.preventDefault(); navigateRef.current(next); }
    };
    // The native menu bar (src-tauri/src/menu.rs) sends the same commands as DOM events.
    const command = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === "sidebar:toggle") sidebarRef.current();
      else if (detail === "palette:open") { navRef.current.close(); setPalette(true); }
      else if (detail?.startsWith("view:")) navigateRef.current(viewFromHash(`#${detail.slice(5)}`));
    };
    window.addEventListener("keydown", shortcut);
    window.addEventListener("luuna:command", command);
    return () => { window.removeEventListener("keydown", shortcut); window.removeEventListener("luuna:command", command); };
  }, []);
  return { view, navigate, entering, motion, collapsed, toggle: () => setCollapsed((value) => !value), toggleSidebar: () => sidebarRef.current(), palette, setPalette, nav };
}
