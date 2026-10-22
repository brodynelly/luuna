import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { indicatorGeometry } from "./motion-math";

/**
 * Tabs (WAI-ARIA tabs pattern, automatic activation): the selection is the caller's state, the
 * component shows it. One indicator slides under the selected tab with a transform only; before
 * the first measurement (server rendering, or no layout yet) the selected tab draws its own
 * underline instead, so nothing slides in from zero.
 */
export interface TabItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
  "data-capability"?: string;
}

const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

export interface TabsProps {
  label: string;
  tabs: readonly TabItem[];
  selected: string;
  onSelect: (id: string) => void;
  /** Pairs each tab with its `TabPanel`; defaults to a generated id. */
  idPrefix?: string;
}

/** A row of tabs. Left and Right wrap, Home and End jump, disabled tabs are skipped. */
export function Tabs({ label, tabs, selected, onSelect, idPrefix }: TabsProps) {
  const generated = useId();
  const prefix = idPrefix ?? generated;
  const list = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const indicator = element.querySelector<HTMLElement>(".tab-indicator");
    const place = () => {
      const tab = [...element.querySelectorAll<HTMLElement>("[role=tab]")].find((item) => item.getAttribute("aria-selected") === "true");
      if (!tab || !indicator) return;
      const geometry = indicatorGeometry(element.getBoundingClientRect(), tab.getBoundingClientRect());
      indicator.style.setProperty("--tab-x", `${geometry.x}px`);
      indicator.style.setProperty("--tab-y", `${geometry.y}px`);
      indicator.style.setProperty("--tab-scale", String(geometry.scale));
      // The first position is flushed while transitions are still off, then measured is set: the indicator never slides in from zero.
      if (!element.hasAttribute("data-measured")) {
        void indicator.getBoundingClientRect();
        element.setAttribute("data-measured", "");
      }
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => observer.disconnect();
  }, [selected, tabs]);

  function key(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = tabs.filter((tab) => !tab.disabled);
    if (!enabled.length) return;
    const index = enabled.findIndex((tab) => tab.id === selected);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    let next: TabItem | undefined;
    if (step) next = enabled[(index + step + enabled.length) % enabled.length];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    onSelect(next.id);
    list.current?.querySelector<HTMLElement>(`[id="${tabId(prefix, next.id)}"]`)?.focus();
  }

  return <div ref={list} className="tabs" role="tablist" aria-label={label} onKeyDown={key}>
    {tabs.map((tab) => {
      const on = tab.id === selected;
      return <button key={tab.id} type="button" role="tab" id={tabId(prefix, tab.id)} aria-selected={on} aria-controls={panelId(prefix, tab.id)} tabIndex={on ? 0 : -1} disabled={tab.disabled} data-capability={tab["data-capability"]} onClick={() => onSelect(tab.id)}>{tab.label}</button>;
    })}
    <span className="tab-indicator" aria-hidden="true" />
  </div>;
}

/** The content of one tab; hidden unless selected. `idPrefix` must match the `Tabs`. */
export function TabPanel({ id, idPrefix, selected, children }: { id: string; idPrefix: string; selected: boolean; children: ReactNode }) {
  return <div role="tabpanel" id={panelId(idPrefix, id)} aria-labelledby={tabId(idPrefix, id)} hidden={!selected}>{children}</div>;
}
