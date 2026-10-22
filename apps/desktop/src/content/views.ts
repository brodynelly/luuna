/**
 * The views of the window, in sidebar order, with the words each page opens with. Titles and
 * descriptions live here, not in the views, so every page is described the same way and the
 * sidebar, the shortcuts and the page template read one source.
 */
export const VIEWS = [
  { id: "home", label: "Home", description: "What needs your attention, and how each project's checks stand." },
  { id: "board", label: "Board", description: "Every ticket, in the column of its latest plan's state. Select a card to open it." },
  { id: "projects", label: "Projects", description: "Add a repository to plan, implement and review changes. Luuna reads your checkout but never changes it." },
  { id: "sessions", label: "Sessions", description: "Every run the runtime recorded, with its live output and durable event record." },
  { id: "settings", label: "Settings", description: "The connected runtime and its environment." },
  { id: "help", label: "Help", description: "How Luuna works, what each status means and where its evidence is kept." },
] as const;

export type View = (typeof VIEWS)[number]["id"];

/** The sidebar's sections, in VIEWS order so the Ctrl+N shortcuts stay stable. */
export const NAV_SECTIONS = [
  { id: "workspace", label: "Workspace", views: ["home", "board", "projects", "sessions"] },
  { id: "general", label: "General", views: ["settings", "help"] },
] as const satisfies ReadonlyArray<{ id: string; label: string; views: readonly View[] }>;

/** The shortcut that selects a view: Ctrl+, for Settings, otherwise Ctrl with the view's position. */
export function viewShortcut(id: View): string {
  return id === "settings" ? "Ctrl+," : `Ctrl+${VIEWS.findIndex((item) => item.id === id) + 1}`;
}

export function viewInfo(id: View) {
  return VIEWS.find((item) => item.id === id)!;
}

/** The view named by the location hash (`#projects`), or Home. */
export function viewFromHash(hash: string): View {
  return VIEWS.find((item) => `#${item.id}` === hash)?.id ?? "home";
}

/**
 * The window's keyboard shortcuts: Ctrl (Command on a Mac) with the view's position, and the
 * platform's own Ctrl+, for Settings. Returns the view a key press selects, or null.
 */
export function viewForShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): View | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return null;
  if (event.key === ",") return "settings";
  return VIEWS[Number(event.key) - 1]?.id ?? null;
}

/** The connection status line, in the words the sidebar and the smokes use. */
export const CONNECTION_LABEL = { connected: "Local runtime connected", reconnecting: "Reconnecting to runtime", offline: "Local runtime offline" } as const;
