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
import { changeView, viewMotion } from "./shell/viewTransition";
import type { TransitionHandle } from "./shell/viewTransition";
import { viewForShortcut, viewFromHash } from "./content/views";
import type { View } from "./content/views";
import { AppShell, Callout, CommandPalette, ErrorBanner, NoticeProvider, NoticeRegion, ViewSlot } from "./ui";

export { authenticationLost, historySelection, sessionStatus, watchRuns } from "./shell/runtime";
export { VIEWS, viewFromHash } from "./content/views";
export type { View } from "./content/views";

const ProjectPanel = memo(Projects);

/** Keeps the current view in the location hash and answers the window's keyboard shortcuts. */
function useWindowNavigation() {
  const [initial] = useState<View>(() => viewFromHash(typeof location === "undefined" ? "" : location.hash));
  const [view, setView] = useState<View>(initial);
  // The view that was entered last: its slot plays the one-time enter reveal (screens/shell.css).
  const [entering, setEntering] = useState<View>(initial);
  // Static support only; reduced motion is read per navigation.
  const [motion] = useState(() => viewMotion(typeof document === "undefined" ? undefined : document, typeof CSS !== "undefined" && CSS.supports("view-transition-name: none"), false));
  const transition = useRef<TransitionHandle | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  /** Every view change goes through here: inside a view transition where supported, instant otherwise. */
  const navigate = (next: View, extra?: () => void) => {
    if (next === viewRef.current) { extra?.(); return; }
    const update = () => { extra?.(); setView(next); setEntering(next); };
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    transition.current = changeView(document, reduced ? "none" : motion, motion === "native" && !reduced ? () => flushSync(update) : update, transition.current);
  };
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [collapsed, setCollapsed] = useState(false);
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    history.replaceState(null, "", `#${view}`);
    window.scrollTo({ top: 0 });
  }, [view]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "\\") { event.preventDefault(); setCollapsed((value) => !value); return; }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") { event.preventDefault(); setPalette(true); return; }
      const next = viewForShortcut(event);
      if (next) { event.preventDefault(); navigateRef.current(next); }
    };
    // The native menu bar (src-tauri/src/menu.rs) sends the same commands as DOM events.
    const command = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === "sidebar:toggle") setCollapsed((value) => !value);
      else if (detail === "palette:open") setPalette(true);
      else if (detail?.startsWith("view:")) navigateRef.current(viewFromHash(`#${detail.slice(5)}`));
    };
    window.addEventListener("keydown", shortcut);
    window.addEventListener("luuna:command", command);
    return () => { window.removeEventListener("keydown", shortcut); window.removeEventListener("luuna:command", command); };
  }, []);
  return { view, navigate, entering, motion, collapsed, toggle: () => setCollapsed((value) => !value), palette, setPalette };
}

/** The window: a sidebar of views beside the content (ADR 0030). The token stays in memory only. */
export function App() {
  const runtime = useRuntime();
  const { client, connectionEpoch, refresh, error, setError, outage } = runtime;
  const { view, navigate, entering, motion, collapsed, toggle, palette, setPalette } = useWindowNavigation();
  // A Home or Board control opens a project (and a ticket, or the ticket form) in Projects.
  const [requested, setRequested] = useState<ProjectRequest | null>(null);
  const open = (request: OpenRequest) => navigate("projects", () => setRequested({ ...request, nonce: Date.now() }));
  // Help reads without a runtime; every other view needs one, so it shows the connect page instead.
  const gated = !client && view !== "help";
  const activeRuns = runtime.runs.filter((run) => ACTIVE_STATES.includes(run.state)).length;
  const sidebar = <WindowSidebar view={view} onSelect={navigate} connection={runtime.connectionState} address={client?.baseUrl} activeRuns={activeRuns} collapsed={collapsed} onToggle={toggle} onSearch={() => setPalette(true)} />;
  const finder = usePalette({ client, open: palette, onView: navigate, onOpen: open, onToggleSidebar: toggle, onDisconnect: runtime.disconnect });

  return <NoticeProvider scope={client}>
    <AppShell collapsed={collapsed} sidebar={sidebar} motion={motion}>
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      {client && outage && <Callout tone="interrupted" status className="outage">{outage} Runs, candidates and worktrees are durable in the runtime; nothing is lost while Luuna waits.</Callout>}
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
