import type { ReactNode } from "react";
import type { Tone } from "../design/tone";
import { Icon } from "../design/Icon";
import type { IconName } from "../design/Icon";

/**
 * The window: a sidebar of views on the leading edge and one content column (ADR 0028). The
 * wordmark is the page's h1. The sidebar can be collapsed to an icon rail (HIG › Sidebars:
 * "Consider letting people hide the sidebar"); names stay as accessible names and tooltips.
 */
export function AppShell({ collapsed, sidebar, children }: { collapsed: boolean; sidebar: ReactNode; children: ReactNode }) {
  return <div className="app" data-sidebar={collapsed ? "collapsed" : undefined}>
    <a className="skip-link" href="#main">Skip to main content</a>
    {sidebar}
    <main id="main" tabIndex={-1} className="flex flex-col gap-5">{children}</main>
  </div>;
}

/** The brand mark: a lavender disc whose leading half is cut from the surface behind it. */
export function Mark({ className }: { className: string }) {
  return <svg className={className} viewBox="0 0 292 292" aria-hidden="true" focusable="false"><circle cx="146" cy="146" r="146" /><path d="M146 0a146 146 0 0 0 0 292z" /></svg>;
}

export function Sidebar({ status, onToggle, onSearch, collapsed, children }: { status: ReactNode; onToggle: () => void; onSearch: () => void; collapsed: boolean; children: ReactNode }) {
  return <aside className="sidebar flex flex-col gap-5">
    <div className="sidebar-top flex items-center gap-2">
      <h1 className="wordmark flex items-center gap-2"><Mark className="wordmark-mark" /><span className="sidebar-label">luuna</span></h1>
      <button type="button" className="sidebar-toggle" aria-label={collapsed ? "Show sidebar labels" : "Collapse sidebar"} aria-expanded={!collapsed} aria-keyshortcuts="Control+\" title={`${collapsed ? "Expand" : "Collapse"} sidebar (Ctrl+\\)`} onClick={onToggle}><Icon name="sidebar" /></button>
    </div>
    {status}
    <button type="button" className="sidebar-search" aria-label="Go to a view, project or ticket" aria-haspopup="dialog" aria-keyshortcuts="Control+K" title="Go to a view, project or ticket (Ctrl+K)" onClick={onSearch}>
      <Icon name="search" /><span className="sidebar-label">Go to…</span><kbd className="sidebar-label">Ctrl K</kbd>
    </button>
    <nav className="sidebar-nav" aria-label="Views"><ul className="flex flex-col gap-0.5">{children}</ul></nav>
  </aside>;
}

/** The connection status line under the wordmark, led by the shared tone mark. */
export function ConnectionStatus({ tone, label, title }: { tone: Tone; label: string; title?: string }) {
  return <span className="connection" data-tone={tone} role="status" aria-live="polite" title={title}><i className="tone-mark" aria-hidden="true" data-tone={tone} /><span className="sidebar-label">{label}</span></span>;
}

export interface NavItemProps {
  icon: IconName;
  label: string;
  current: boolean;
  shortcut: string;
  count?: number;
  onSelect: () => void;
}

/** One view in the sidebar; the current one carries `aria-current="page"`. */
export function NavItem({ icon, label, current, shortcut, count, onSelect }: NavItemProps) {
  return <li>
    <button type="button" className="nav-item" aria-current={current ? "page" : undefined} aria-keyshortcuts={shortcut.replace("Ctrl", "Control")} title={`${label} (${shortcut})`} onClick={onSelect}>
      <Icon name={icon} /><span className="sidebar-label">{label}</span>
      {count !== undefined && count > 0 && <span className="nav-count" aria-label={`${count} active`}>{count}</span>}
    </button>
  </li>;
}

/** One view's content; every view stays mounted and only the current one is shown. */
export function ViewSlot({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  return <div className="view" hidden={hidden}>{children}</div>;
}
