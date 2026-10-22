/** The width at and below which the sidebar is an off-canvas panel (Ledger AppShell). Mirrors screens/shell.css. */
export const NARROW_QUERY = "(max-width: 768px)";

/** What Ctrl+\ and the native `sidebar:toggle` command do: open the panel when narrow, collapse the rail otherwise. */
export function sidebarCommand(narrow: boolean): "drawer" | "collapse" {
  return narrow ? "drawer" : "collapse";
}

/** Where focus goes after the panel closes: the menu button (Escape, scrim, Ctrl+\), the content (a view was chosen) or nowhere. */
export type FocusTarget = "menu" | "main" | null;

export function closeTarget(options: { restoreFocus?: boolean; focusMain?: boolean }): FocusTarget {
  return options.restoreFocus ? "menu" : options.focusMain ? "main" : null;
}

type Focusable = { focus: () => void } | null;
export interface FocusDocument { querySelector: (selector: string) => Focusable; getElementById: (id: string) => Focusable }

/** Opening focuses the current view's item; closing focuses the pending target, if any. Returns the target still pending. */
export function settleFocus(doc: FocusDocument, open: boolean, target: FocusTarget): FocusTarget {
  if (open) {
    doc.querySelector("#app-sidebar [aria-current=\"page\"]")?.focus();
    return target;
  }
  if (target) doc.getElementById(target === "menu" ? "nav-menu" : "main")?.focus();
  return null;
}

export interface NarrowQuery { matches: boolean; addEventListener: (type: "change", listener: () => void) => void; removeEventListener: (type: "change", listener: () => void) => void }

/** Reports the breakpoint now and on every change; returns the cleanup. Without matchMedia nothing is watched. */
export function watchNarrow(match: ((query: string) => NarrowQuery) | undefined, apply: (narrow: boolean) => void): () => void {
  if (!match) return () => undefined;
  const query = match(NARROW_QUERY);
  const change = () => apply(query.matches);
  change();
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}

/** Escape closes the panel, and only while it is open. */
export function navKey(event: Pick<KeyboardEvent, "key">, open: boolean): "close" | null {
  return open && event.key === "Escape" ? "close" : null;
}
