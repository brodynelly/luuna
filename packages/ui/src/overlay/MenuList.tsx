import type { KeyboardEventHandler, RefObject } from "react";
import type { MenuEntry } from "./Menu";

export interface MenuListProps {
  id: string;
  label: string;
  items: readonly MenuEntry[];
  /** Index of the one item in the tab order (roving tabindex); -1 when none. */
  active: number;
  panel: RefObject<HTMLDivElement | null>;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onChoose: (item: MenuEntry) => void;
}

/** The open panel of a Menu, split out so its roles and states can be checked without a browser. Not exported from the barrel. */
export function MenuList({ id, label, items, active, panel, onKeyDown, onChoose }: MenuListProps) {
  return <div ref={panel} id={id} className="ov-menu" role="menu" aria-label={label} aria-orientation="vertical" onKeyDown={onKeyDown}>
    {items.map((item, index) => <button key={item.id} type="button" role="menuitem" className="ov-menu-item" data-tone={item.tone}
      tabIndex={index === active ? 0 : -1} disabled={item.disabled} onClick={() => onChoose(item)}>
      {item.tone && item.tone !== "neutral" && <span className="tone-mark" data-tone={item.tone} aria-hidden="true" />}
      {item.label}
    </button>)}
  </div>;
}
