import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import { tocHref, tocItems } from "./toc";
import type { TocItem } from "./toc";

export interface TableOfContentsProps extends HTMLAttributes<HTMLElement> {
  /** Required: names the navigation landmark. */
  "aria-label": string;
  items: ReadonlyArray<TocItem>;
  /** The id of the section the reader is in, if the caller tracks it; marked `aria-current="location"`. */
  current?: string;
}

/** A list of in-page links. Plain anchors, no scroll tracking of its own. */
export function TableOfContents({ items, current, className, ...rest }: TableOfContentsProps) {
  return <nav className={cx("toc", className)} {...rest}>
    <ol className="toc-list">
      {tocItems(items).map((item) => <li key={item.id} className="toc-item" data-level={item.level}>
        <a href={tocHref(item.id)} aria-current={item.id === current ? "location" : undefined}>{item.label}</a>
      </li>)}
    </ol>
  </nav>;
}
