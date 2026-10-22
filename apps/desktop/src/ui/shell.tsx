import { useLayoutEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import type { Tone } from "../design/tone";
import { Icon } from "../design/Icon";
import type { IconName } from "../design/Icon";
import type { ViewMotion } from "../shell/viewTransition";

/**
 * The window: a sidebar of views on the leading edge and one content column (ADR 0030). The
 * wordmark is the page's h1. The sidebar can be collapsed to an icon rail (HIG › Sidebars:
 * "Consider letting people hide the sidebar"); names stay as accessible names and tooltips.
 */
export function AppShell({ collapsed, sidebar, children, motion }: { collapsed: boolean; sidebar: ReactNode; children: ReactNode; motion?: ViewMotion }) {
  return <div className="app" data-sidebar={collapsed ? "collapsed" : undefined} data-view-motion={motion}>
    <a className="skip-link" href="#main">Skip to main content</a>
    {sidebar}
    <main id="main" tabIndex={-1} className="flex flex-col gap-5">{children}</main>
  </div>;
}

/** The brand mark: a lavender disc whose leading half is cut from the surface behind it. */
export function Mark({ className }: { className: string }) {
  return <svg className={className} viewBox="0 0 292 292" aria-hidden="true" focusable="false"><circle cx="146" cy="146" r="146" /><path d="M146 0a146 146 0 0 0 0 292z" /></svg>;
}

export interface PillGeometry { y: number; height: number }

/** The pill's offset and height inside the nav, or null while the current item is missing or not laid out. */
export function pillGeometry(nav: { top: number }, item: { top: number; height: number } | null): PillGeometry | null {
  if (!item || item.height <= 0) return null;
  return { y: Math.round(item.top - nav.top), height: Math.round(item.height) };
}

/** Writes the pill's two custom properties; no React state. Null leaves the static active fill showing. */
export function applyPill(nav: Pick<HTMLElement, "style" | "setAttribute" | "removeAttribute">, geometry: PillGeometry | null) {
  if (!geometry) { nav.removeAttribute("data-pill"); return; }
  nav.style.setProperty("--pill-y", `${geometry.y}px`);
  nav.style.setProperty("--pill-h", `${geometry.height}px`);
  nav.setAttribute("data-pill", "ready");
}

/** Measures the current item once per change of view or collapse, and again when the nav resizes. */
function useNavPill(ref: RefObject<HTMLElement | null>, current: string, collapsed: boolean) {
  useLayoutEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const place = () => applyPill(nav, pillGeometry(nav.getBoundingClientRect(), nav.querySelector("[aria-current=\"page\"]")?.getBoundingClientRect() ?? null));
    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [ref, current, collapsed]);
}

export function Sidebar({ status, current, onToggle, onSearch, collapsed, children }: { status: ReactNode; current: string; onToggle: () => void; onSearch: () => void; collapsed: boolean; children: ReactNode }) {
  const navRef = useRef<HTMLElement>(null);
  useNavPill(navRef, current, collapsed);
  return <aside className="sidebar flex flex-col gap-5">
    <div className="sidebar-top flex items-center gap-2">
      <h1 className="wordmark flex items-center gap-2"><Mark className="wordmark-mark" /><span className="sidebar-label">luuna</span></h1>
      <button type="button" className="sidebar-toggle" aria-label={collapsed ? "Show sidebar labels" : "Collapse sidebar"} aria-expanded={!collapsed} aria-keyshortcuts="Control+\" title={`${collapsed ? "Expand" : "Collapse"} sidebar (Ctrl+\\)`} onClick={onToggle}><Icon name="sidebar" /></button>
    </div>
    <button type="button" className="sidebar-search" aria-label="Go to a view, project or ticket" aria-haspopup="dialog" aria-keyshortcuts="Control+K" title="Go to a view, project or ticket (Ctrl+K)" onClick={onSearch}>
      <Icon name="search" /><span className="sidebar-label">Go to…</span><kbd className="sidebar-label">Ctrl K</kbd>
    </button>
    <nav className="sidebar-nav" aria-label="Views" ref={navRef}><span className="nav-pill" aria-hidden="true" />{children}</nav>
    <div className="sidebar-footer">{status}</div>
  </aside>;
}

/** One labelled group of views; the label stays announced in the rail. */
export function NavSection({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="nav-section">
    <span className="nav-section-label sidebar-label" id={`nav-${id}`}>{label}</span>
    <ul className="flex flex-col gap-0.5" aria-labelledby={`nav-${id}`}>{children}</ul>
  </div>;
}

/** The connection status chip in the sidebar footer, led by the shared tone mark; it pulses while live. */
export function ConnectionStatus({ tone, label, title, live }: { tone: Tone; label: string; title?: string; live?: boolean }) {
  return <span className="connection" data-tone={tone} data-live={live ? "" : undefined} role="status" aria-live="polite" title={title}><i className="tone-mark" aria-hidden="true" data-tone={tone} /><span className="sidebar-label">{label}</span></span>;
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
export function ViewSlot({ hidden, entering, children }: { hidden: boolean; entering?: boolean; children: ReactNode }) {
  return <div className="view" hidden={hidden} data-entering={entering ? "" : undefined}>{children}</div>;
}
