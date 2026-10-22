import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * The command palette (Ctrl+K, or Command-K on a Mac): one field that finds any view, project,
 * ticket or window command by name. It is a modal dialog (`<dialog>` with `showModal`), so focus
 * stays in it and Escape closes it; focus then returns where it was. Every command it offers is
 * also reachable elsewhere: the palette is a shortcut, never the only way.
 */
export interface PaletteCommand {
  id: string;
  label: string;
  /** Where the command belongs (View, Project, Ticket, Window), shown after the label. */
  group: string;
  /** Extra words it is found by (an id, a project name). */
  keywords?: string;
  shortcut?: string;
  run: () => void;
}

/** Commands whose label, group or keywords contain every word of the query, best match first. */
export function filterCommands(commands: readonly PaletteCommand[], query: string, limit = 50): PaletteCommand[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = commands.map((command) => {
    const label = command.label.toLowerCase();
    const haystack = `${label} ${command.group.toLowerCase()} ${(command.keywords ?? "").toLowerCase()}`;
    if (!words.every((word) => haystack.includes(word))) return null;
    const score = words.length === 0 ? 0 : label.startsWith(words[0]) ? 0 : label.includes(words[0]) ? 1 : 2;
    return { command, score };
  }).filter((item): item is { command: PaletteCommand; score: number } => item !== null);
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((item) => item.command);
}

export function CommandPalette({ open, commands, loading = false, onClose }: { open: boolean; commands: readonly PaletteCommand[]; loading?: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const shown = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setQuery("");
      setActive(0);
      element.showModal?.();
      field.current?.focus();
    } else if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => setActive(0), [query]);

  function choose(command: PaletteCommand | undefined) {
    if (!command) return;
    onClose();
    command.run();
  }

  function key(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, shown.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
    else if (event.key === "Enter") { event.preventDefault(); choose(shown[active]); }
  }

  const option = (index: number) => `${listId}-${index}`;
  return <dialog ref={dialog} className="palette" aria-label="Command palette" onClose={onClose} onCancel={onClose}
    onClick={(event) => { if (event.target === dialog.current) onClose(); }}>
    <label className="palette-field">
      <span className="visually-hidden">Find a view, project, ticket or command</span>
      <input ref={field} type="search" role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={shown[active] ? option(active) : undefined} placeholder="Find a view, project, ticket or command…"
        value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={key} autoComplete="off" spellCheck={false} />
    </label>
    <ul className="palette-list" id={listId} role="listbox" aria-label="Commands">
      {shown.map((command, index) => <li key={command.id} id={option(index)} role="option" aria-selected={index === active}
        className="palette-option" onMouseMove={() => setActive(index)} onClick={() => choose(command)}>
        <span className="palette-label">{command.label}</span>
        <span className="palette-group">{command.group}</span>
        {command.shortcut && <kbd className="palette-shortcut">{command.shortcut}</kbd>}
      </li>)}
    </ul>
    {shown.length === 0 && <p className="palette-empty" role="status">{loading ? "Reading projects and tickets…" : `Nothing matches “${query}”.`}</p>}
    <p className="palette-hint"><kbd>↑</kbd> <kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close</p>
  </dialog>;
}
