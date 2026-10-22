import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import { clampPage, pageRange, pageWindow } from "./paginate";

export interface PaginationProps extends Omit<HTMLAttributes<HTMLElement>, "onChange"> {
  /** Current page, 1-based. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Accessible name of the nav landmark, for example "Runs pages". */
  label: string;
  /** With `totalItems`, the summary reads "Showing 11 to 20 of 53". */
  pageSize?: number;
  totalItems?: number;
  siblings?: number;
}

/** Page navigation: Previous and Next stop at the ends, the current page carries `aria-current="page"`. */
export function Pagination({ page, pageCount, onPageChange, label, pageSize, totalItems, siblings = 1, className, ...rest }: PaginationProps) {
  const last = Math.max(1, Math.trunc(pageCount) || 1);
  const current = clampPage(page, last);
  const range = pageSize !== undefined && totalItems !== undefined ? pageRange(current, pageSize, totalItems) : null;
  const go = (target: number) => { if (target !== current && target >= 1 && target <= last) onPageChange(target); };
  return <nav className={cx("pagination", className)} aria-label={label} {...rest}>
    <p className="pagination-summary" role="status">{range ? `Showing ${range.from} to ${range.to} of ${totalItems}` : `Page ${current} of ${last}`}</p>
    <ul>
      <li><button type="button" disabled={current <= 1} onClick={() => go(current - 1)}>Previous</button></li>
      {pageWindow(current, last, siblings).map((item, index) => item === "gap"
        ? <li key={`gap-${index}`} className="pagination-gap" aria-hidden="true">...</li>
        : <li key={item}><button type="button" aria-current={item === current ? "page" : undefined} aria-label={`Page ${item}`} onClick={() => go(item)}>{item}</button></li>)}
      <li><button type="button" disabled={current >= last} onClick={() => go(current + 1)}>Next</button></li>
    </ul>
  </nav>;
}
