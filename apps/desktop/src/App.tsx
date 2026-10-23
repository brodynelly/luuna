import { memo, useState } from "react";
import { Projects } from "./Projects";
import type { ProjectRequest } from "./Projects";
import { Home } from "./Home";
import type { OpenRequest } from "./Home";
import { Board } from "./Board";
import { Help } from "./Help";
import { Settings } from "./Settings";
import { Orbit } from "./Orbit";
import { Sessions } from "./sessions/Sessions";
import { ConnectPage, RuntimeCard } from "./shell/Connection";
import { WindowSidebar } from "./shell/WindowSidebar";
import { ACTIVE_STATES } from "./shell/runtime";
import { useRuntime } from "./shell/useRuntime";
import { usePalette } from "./shell/usePalette";
import { useWindowNavigation } from "./shell/useWindowNavigation";
import { OUTAGE_LABEL, OUTAGE_NOTE } from "./content/views";
import { AppShell, Alert, Banner, CommandPalette, NoticeProvider, NoticeRegion, TopBar, ViewSlot } from "@luuna/ui";

export { authenticationLost, historySelection, sessionStatus, watchRuns } from "./shell/runtime";
export { VIEWS, viewFromHash } from "./content/views";
export type { View } from "./content/views";

const ProjectPanel = memo(Projects);

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
      {error && <Alert tone="danger" onDismiss={() => setError("")}>{error}</Alert>}
      <NoticeRegion />
      {gated && <ConnectPage runtime={runtime} />}
      <ViewSlot hidden={gated || view !== "home"} entering={entering === "home"}><Home client={client} connectionEpoch={connectionEpoch} refreshEpoch={refresh} onOpen={open} onNavigate={navigate} /></ViewSlot>
      <ViewSlot hidden={gated || view !== "board"} entering={entering === "board"}><Board client={client} connectionEpoch={connectionEpoch} refreshEpoch={refresh} onOpen={open} /></ViewSlot>
      <ViewSlot hidden={gated || view !== "projects"} entering={entering === "projects"}><ProjectPanel client={client} connectionEpoch={connectionEpoch} requested={requested} /></ViewSlot>
      <ViewSlot hidden={gated || view !== "orbit"} entering={entering === "orbit"}><Orbit client={client} connectionEpoch={connectionEpoch} refreshEpoch={refresh} /></ViewSlot>
      <ViewSlot hidden={gated || view !== "sessions"} entering={entering === "sessions"}><Sessions runtime={runtime} /></ViewSlot>
      <ViewSlot hidden={gated || view !== "settings"} entering={entering === "settings"}><Settings client={client} connectionEpoch={connectionEpoch} refreshEpoch={refresh}><RuntimeCard runtime={runtime} /></Settings></ViewSlot>
      <ViewSlot hidden={view !== "help"} entering={entering === "help"}><Help /></ViewSlot>
      <CommandPalette open={palette} commands={finder.commands} loading={finder.loading} onClose={() => setPalette(false)} />
    </AppShell>
  </NoticeProvider>;
}
