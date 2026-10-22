import { CONNECTION_LABEL, NAV_SECTIONS, viewInfo, viewShortcut } from "../content/views";
import type { View } from "../content/views";
import { connectionTone, ConnectionStatus, NavItem, NavSection, Sidebar } from "@luuna/ui";

/** The window's sidebar: the wordmark, the views in sections and the connection status. */
export function WindowSidebar({ view, onSelect, connection, address, activeRuns, collapsed, onToggle }: {
  view: View; onSelect: (view: View) => void; connection: keyof typeof CONNECTION_LABEL; address?: string; activeRuns: number; collapsed: boolean; onToggle: () => void;
}) {
  const status = <ConnectionStatus tone={connectionTone[connection]} label={CONNECTION_LABEL[connection]} title={address} />;
  return <Sidebar status={status} collapsed={collapsed} onToggle={onToggle}>
    {NAV_SECTIONS.map((section) => <NavSection key={section.id} id={section.id} label={section.label}>
      {section.views.map((id) => <NavItem key={id} icon={id} label={viewInfo(id).label} current={view === id}
        shortcut={viewShortcut(id)} count={id === "sessions" ? activeRuns : undefined} onSelect={() => onSelect(id)} />)}
    </NavSection>)}
  </Sidebar>;
}
