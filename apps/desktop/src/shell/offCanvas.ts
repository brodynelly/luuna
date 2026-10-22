/** The width at and below which the sidebar is an off-canvas panel (Ledger AppShell). Mirrors screens/shell.css. */
export const NARROW_QUERY = "(max-width: 768px)";

/** What Ctrl+\ and the native `sidebar:toggle` command do: open the panel when narrow, collapse the rail otherwise. */
export function sidebarCommand(narrow: boolean): "drawer" | "collapse" {
  return narrow ? "drawer" : "collapse";
}

/** Escape closes the panel, and only while it is open. */
export function navKey(event: Pick<KeyboardEvent, "key">, open: boolean): "close" | null {
  return open && event.key === "Escape" ? "close" : null;
}
