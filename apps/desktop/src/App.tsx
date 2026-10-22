import { memo, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Projects } from "./Projects";
import type { ProjectRequest } from "./Projects";
import { Home } from "./Home";
import type { OpenRequest } from "./Home";
import { Board } from "./Board";
import { Help } from "./Help";
import { Settings } from "./Settings";
import { Sessions } from "./sessions/Sessions";
import { ConnectPage, RuntimeCard } from "./shell/Connection";
import { WindowSidebar } from "./shell/WindowSidebar";
import { ACTIVE_STATES } from "./shell/runtime";
import { useRuntime } from "./shell/useRuntime";
import { usePalette } from "./shell/usePalette";
import { sidebarCommand } from "./shell/offCanvas";
import { useOffCanvas } from "./shell/useOffCanvas";
import { changeView, viewMotion } from "./shell/viewTransition";
import type { TransitionHandle } from "./shell/viewTransition";
import { OUTAGE_LABEL, OUTAGE_NOTE, viewForShortcut, viewFromHash } from "./content/views";
import type { View } from "./content/views";
import { AppShell, Banner, CommandPalette, ErrorBanner, NoticeProvider, NoticeRegion, TopBar, ViewSlot } from "./ui";

export { authenticationLost, historySelection, sessionStatus, watchRuns } from "./shell/runtime";
export { VIEWS, viewFromHash } from "./content/views";
export type { View } from "./content/views";

const ProjectPanel = memo(Projects);

/** Keeps the current view in the location hash and answers the window's keyboard shortcuts. */
function useWindowNavigation() {
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

/** The window: a sidebar of views beside the content (ADR 0030). The token stays in memory only. */
export function App() {
  const runtime = useRuntime();
  const { client, connectionEpoch, refresh, error, setError, outage } = runtime;
  const { view, navigate, entering, motion, collapsed, toggle, toggleSidebar, palette, setPalette, nav } = useWindowNavigation();
  // A Home or Board control opens a project (and a ticket, or the ticket form) in Projects.
  const [requested, setRequested] = useState<ProjectRequest | null>(null);
  const open = (request: OpenRequest) => navigate("projects", () => setRequested({ ...request, nonce: Date.now() }));
  // Help reads without a runtime; every other view needs one, so it shows the connect page instead.
  const gated = !client && view !== "help";
  const activeRuns = runtime.runs.filter((run) => ACTIVE_STATES.includes(run.state)).length;
  const sidebar = <WindowSidebar view={view} onSelect={navigate} connection={runtime.connectionState} address={client?.baseUrl} activeRuns={activeRuns} collapsed={collapsed} onToggle={toggle} />;
  // The one app-wide notice: the runtime is unreachable (the connect page covers having no runtime).
  const banner = client && outage ? <Banner label={OUTAGE_LABEL} className="outage" title={`${OUTAGE_LABEL}: ${outage} ${OUTAGE_NOTE}`}>{outage} {OUTAGE_NOTE}</Banner> : undefined;
  const topbar = <TopBar onMenu={nav.toggle} menuOpen={nav.open} onSearch={() => setPalette(true)} />;
  const finder = usePalette({ client, open: palette, onView: navigate, onOpen: open, onToggleSidebar: toggleSidebar, onDisconnect: runtime.disconnect });

  return <NoticeProvider scope={client}>
    <AppShell collapsed={collapsed && !nav.narrow} sidebar={sidebar} banner={banner} topbar={topbar} navOpen={nav.open} onDismissNav={() => nav.close({ restoreFocus: true })} motion={motion}>
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <NoticeRegion />
      {gated && <ConnectPage runtime={runtime} />}
      <ViewSlot hidden={gated || view !== "home"} entering={entering === "home"}><Home client={client} connectionEpoch={connectionEpoch} refreshEpoch={refresh} onOpen={open} onNavigate={navigate} /></ViewSlot>
      <ViewSlot hidden={gated || view !== "board"} entering={entering === "board"}><Board client={client} connectionEpoch={connectionEpoch} refreshEpoch={refresh} onOpen={open} /></ViewSlot>
      <ViewSlot hidden={gated || view !== "projects"} entering={entering === "projects"}><ProjectPanel client={client} connectionEpoch={connectionEpoch} requested={requested} /></ViewSlot>
      <ViewSlot hidden={gated || view !== "sessions"} entering={entering === "sessions"}><Sessions runtime={runtime} /></ViewSlot>
      <ViewSlot hidden={gated || view !== "settings"} entering={entering === "settings"}><Settings client={client} connectionEpoch={connectionEpoch} refreshEpoch={refresh}><RuntimeCard runtime={runtime} /></Settings></ViewSlot>
      <ViewSlot hidden={view !== "help"} entering={entering === "help"}><Help /></ViewSlot>
      <CommandPalette open={palette} commands={finder.commands} loading={finder.loading} onClose={() => setPalette(false)} />
    </AppShell>
  </NoticeProvider>;
}
