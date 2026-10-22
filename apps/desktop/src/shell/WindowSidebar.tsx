import { VIEWS } from "../content/views";
import type { View } from "../content/views";
import { connectionTone } from "../design/tone";
import { CONNECTION_LABEL } from "../content/views";
import { ConnectionStatus, NavItem, Sidebar } from "../ui";

/** The window's sidebar: the wordmark, the connection status and one item per view. */
export function WindowSidebar({ view, onSelect, connection, address, activeRuns, collapsed, onToggle, onSearch }: {
  view: View; onSelect: (view: View) => void; connection: keyof typeof CONNECTION_LABEL; address?: string; activeRuns: number; collapsed: boolean; onToggle: () => void; onSearch: () => void;
}) {
  const status = <ConnectionStatus tone={connectionTone[connection]} label={CONNECTION_LABEL[connection]} title={address} />;
  return <Sidebar status={status} collapsed={collapsed} onToggle={onToggle} onSearch={onSearch}>
    {VIEWS.map((item, index) => <NavItem key={item.id} icon={item.id} label={item.label} current={view === item.id}
      shortcut={item.id === "settings" ? "Ctrl+," : `Ctrl+${index + 1}`} count={item.id === "sessions" ? activeRuns : undefined} onSelect={() => onSelect(item.id)} />)}
  </Sidebar>;
}
