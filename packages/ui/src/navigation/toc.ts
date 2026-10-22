export interface TocItem { id: string; label: string; /** 1 (default) or 2 for a nested entry. */ level?: 1 | 2 }

/** The in-page anchor for a heading id; ids are never rewritten, only prefixed. */
export const tocHref = (id: string): string => `#${id.replace(/^#/, "")}`;

/** Drops items that cannot be linked (no id or no label) and clamps levels. */
export function tocItems(items: ReadonlyArray<TocItem>): Array<Required<TocItem>> {
  return items.filter((item) => item.id.trim() !== "" && item.label.trim() !== "").map((item) => ({ ...item, level: item.level === 2 ? 2 : 1 }));
}
