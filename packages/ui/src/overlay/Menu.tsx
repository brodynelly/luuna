import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import type { Tone } from "../tone/tone";
import { EMPTY_AHEAD, menuKeyAction, moveIndex, triggerOpenKey } from "./menuNav";
import type { TriggerOpen } from "./menuNav";
import { MenuList } from "./MenuList";
import type { Placement } from "./placement";
import { useFloatingPanel } from "./useFloatingPanel";

export interface MenuEntry {
  id: string;
  label: string;
  onSelect: () => void;
  /** `danger` adds the danger shape mark and colour; the label is still the text. */
  tone?: Tone;
  disabled?: boolean;
}

export interface MenuProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** The menu's accessible name. */
  label: string;
  /** Content of the button that opens the menu. */
  trigger: ReactNode;
  /** Only commands the caller supplies; the library invents none. A menu holds shortcuts to actions that exist elsewhere too. */
  items: readonly MenuEntry[];
  placement?: Placement;
}

/**
 * A menu button. The panel is role="menu" with roving focus: Up and Down wrap, Home and End jump, typing jumps to a
 * label, Escape closes and returns focus to the button, Tab closes and moves on. Choosing runs the caller's onSelect.
 * Key rules live in menuNav.ts; the panel follows the trigger in the DOM.
 */
export function Menu({ label, trigger, items, placement = "bottom-start", className, ...rest }: MenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const ahead = useRef(EMPTY_AHEAD);

  const close = useCallback(() => { setOpen(false); setActive(-1); ahead.current = EMPTY_AHEAD; }, []);
  useFloatingPanel({ open, onClose: close, anchor, panel, placement });

  // Roving focus: the active item is the one the browser focuses.
  useEffect(() => {
    if (open && active >= 0) panel.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[active]?.focus();
  }, [open, active]);

  function openAt(where: TriggerOpen) {
    const index = moveIndex(items, -1, where === "first" ? "ArrowDown" : "ArrowUp");
    if (index < 0) return;
    ahead.current = EMPTY_AHEAD;
    setOpen(true);
    setActive(index);
  }

  function triggerKey(event: KeyboardEvent<HTMLButtonElement>) {
    const where = triggerOpenKey(event.key);
    if (!where) return;
    event.preventDefault();
    openAt(where);
  }

  function itemKey(event: KeyboardEvent<HTMLDivElement>) {
    const result = menuKeyAction(items, active, event, ahead.current, event.timeStamp);
    ahead.current = result.ahead;
    const { action } = result;
    if (action.type === "focus") { event.preventDefault(); setActive(action.index); }
    else if (action.type === "close") {
      if (action.preventDefault) event.preventDefault();
      close();
      anchor.current?.focus();
    }
  }

  function choose(item: MenuEntry) {
    if (item.disabled) return;
    close();
    // Focus is back on the button before the command runs, so a dialog it opens returns here.
    anchor.current?.focus();
    item.onSelect();
  }

  return <div className={["ov-anchor", className].filter(Boolean).join(" ")} {...rest}>
    <button ref={anchor} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined}
      onClick={() => (open ? close() : openAt("first"))} onKeyDown={triggerKey}>{trigger}</button>
    {open && <MenuList id={`${id}-menu`} label={label} items={items} active={active} panel={panel} onKeyDown={itemKey} onChoose={choose} />}
  </div>;
}
