import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";

/**
 * Context menus (HIG › Context menus; cross-platform › Desktop: "right-click context menus").
 * A secondary click, Shift+F10 or the Menu key opens the commands of the item under it. The menu
 * holds shortcuts to actions that also exist elsewhere in the interface, never the only way to
 * reach one. Arrow keys move, Enter or Space chooses, Escape closes and focus returns to the item.
 */
export interface MenuCommand {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Starts a separate group of commands. */
  group?: boolean;
}

interface OpenMenu { x: number; y: number; trigger: HTMLElement | null }

/** Wraps an item (a card, a row) so it offers its commands as a context menu. */
export function ContextMenuArea({ label, commands, children }: { label: string; commands: () => readonly MenuCommand[]; children: ReactNode }) {
  const [open, setOpen] = useState<OpenMenu | null>(null);
  const list = open ? commands() : [];

  function show(event: ReactMouseEvent<HTMLElement>) {
    if (!commands().length) return;
    event.preventDefault();
    setOpen({ x: event.clientX, y: event.clientY, trigger: event.target instanceof HTMLElement ? event.target : null });
  }

  function key(event: ReactKeyboardEvent<HTMLElement>) {
    if (!(event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) || !commands().length) return;
    event.preventDefault();
    const target = event.target instanceof HTMLElement ? event.target : null;
    const box = target?.getBoundingClientRect();
    setOpen({ x: box ? box.left + box.width / 2 : 0, y: box ? box.bottom : 0, trigger: target });
  }

  return <div className="context-area" onContextMenu={show} onKeyDown={key}>
    {children}
    {open && <ContextMenu label={label} commands={list} x={open.x} y={open.y} onClose={() => { setOpen(null); open.trigger?.focus(); }} />}
  </div>;
}

function ContextMenu({ label, commands, x, y, onClose }: { label: string; commands: readonly MenuCommand[]; x: number; y: number; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const items = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>("button[role=menuitem]:not(:disabled)") ?? [])];

  // Placed at the pointer, kept inside the window; the position is a custom property, never an inline literal.
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    // offsetWidth/offsetHeight, not getBoundingClientRect: the entrance scales the menu, and the rect would include that.
    element.style.setProperty("--menu-x", `${Math.max(0, Math.min(x, window.innerWidth - element.offsetWidth))}px`);
    element.style.setProperty("--menu-y", `${Math.max(0, Math.min(y, window.innerHeight - element.offsetHeight))}px`);
    items()[0]?.focus();
  }, [x, y]);

  useEffect(() => {
    const close = (event: Event) => { if (!(event.target instanceof Node && menu.current?.contains(event.target))) onClose(); };
    const dismiss = () => onClose();
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => { window.removeEventListener("pointerdown", close, true); window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", dismiss, true); };
  }, [onClose]);

  function navigate(event: ReactKeyboardEvent<HTMLDivElement>) {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    const move = (next: number) => { event.preventDefault(); all[(next + all.length) % all.length]?.focus(); };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(all.length - 1);
    else if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); onClose(); }
    event.stopPropagation();
  }

  return <div ref={menu} className="context-menu" role="menu" aria-label={label} onKeyDown={navigate} onContextMenu={(event) => event.preventDefault()}>
    {commands.map((command, index) => <div key={command.label} role="none">
      {command.group && index > 0 && <hr className="context-separator" role="separator" />}
      <button type="button" role="menuitem" disabled={command.disabled} onClick={() => { onClose(); command.onSelect(); }}>{command.label}</button>
    </div>)}
  </div>;
}

/** Copies text to the clipboard; the caller confirms it with a notice. */
export function copyText(text: string): Promise<void> {
  return navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("The clipboard is not available."));
}
