/**
 * DOM-free active-index logic for a single-select combobox (ARIA 1.2: the input keeps focus and points at the
 * active option with aria-activedescendant). No wrapping: Down stops at the last option, Up at the first.
 */
export interface ListState { open: boolean; active: number; count: number }
export interface ListStep { open: boolean; active: number; select: boolean }

/** The next state for a key, or null when the key is not the list's (the browser keeps its default, such as caret movement). */
export function nextListState(key: string, state: ListState, selectedIndex = -1): ListStep | null {
  const { open, active, count } = state;
  const last = count - 1;
  const none = count === 0;
  switch (key) {
    case "ArrowDown":
      if (!open) return { open: true, active: none ? -1 : selectedIndex >= 0 && selectedIndex <= last ? selectedIndex : 0, select: false };
      return { open: true, active: none ? -1 : Math.min(active + 1, last), select: false };
    case "ArrowUp":
      if (!open) return { open: true, active: none ? -1 : selectedIndex >= 0 && selectedIndex <= last ? selectedIndex : last, select: false };
      return { open: true, active: none ? -1 : active < 0 ? last : Math.max(active - 1, 0), select: false };
    // Home and End move the list only once an option is active; before that they move the text caret.
    case "Home": return open && active >= 0 ? { open: true, active: 0, select: false } : null;
    case "End": return open && active >= 0 ? { open: true, active: last, select: false } : null;
    case "Enter": return open && active >= 0 && active <= last ? { open: false, active, select: true } : null;
    case "Escape": return open ? { open: false, active: -1, select: false } : null;
    default: return null;
  }
}

/** The options whose label contains the query, case-insensitively; every option for an empty query. */
export function filterOptions<T extends { label: string }>(options: readonly T[], query: string, matches?: (option: T, query: string) => boolean): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...options];
  const test = matches ?? ((option: T) => option.label.toLowerCase().includes(needle));
  return options.filter((option) => test(option, query.trim()));
}

/** The first match is active after typing, none when nothing matches. */
export const firstActive = (count: number): number => (count > 0 ? 0 : -1);
