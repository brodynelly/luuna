/** DOM-free paging maths for Pagination. Pages are 1-based. */
export type PageItem = number | "gap";

export function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(1, Math.trunc(page) || 1), Math.max(1, Math.trunc(pageCount) || 1));
}

/** Page numbers to show: first, last, current and `siblings` either side, with a gap marker between runs. */
export function pageWindow(page: number, pageCount: number, siblings = 1): PageItem[] {
  const count = Math.max(1, Math.trunc(pageCount) || 1);
  const current = clampPage(page, count);
  const wanted = new Set([1, count]);
  for (let n = current - siblings; n <= current + siblings; n += 1) if (n >= 1 && n <= count) wanted.add(n);
  const sorted = [...wanted].sort((a, b) => a - b);
  const items: PageItem[] = [];
  sorted.forEach((n, index) => {
    const before = sorted[index - 1];
    if (before !== undefined && n - before === 2) items.push(before + 1);
    else if (before !== undefined && n - before > 2) items.push("gap");
    items.push(n);
  });
  return items;
}

/** Figures for "Showing 11 to 20 of 53", or null when the item total is unknown or empty. */
export function pageRange(page: number, pageSize: number, totalItems: number): { from: number; to: number } | null {
  if (totalItems <= 0 || pageSize <= 0) return null;
  const from = (page - 1) * pageSize + 1;
  return { from, to: Math.min(page * pageSize, totalItems) };
}
