import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface PropertyItem {
  term: ReactNode;
  value: ReactNode;
  /** Render the value whole in monospace (identities, paths). Never truncated. */
  mono?: boolean;
  key?: string;
}

export interface PropertyListProps extends HTMLAttributes<HTMLDListElement> {
  items: readonly PropertyItem[];
  layout?: "stacked" | "inline";
}

/** Terms and values on a native `dl`. Pass className="facts" where a smoke still reads `.facts`. */
export function PropertyList({ items, layout = "stacked", className, ...rest }: PropertyListProps) {
  return <dl className={cx("property-list", className)} data-layout={layout} {...rest}>
    {items.map((item, index) => <div key={item.key ?? index}><dt>{item.term}</dt><dd>{item.mono ? <code>{item.value}</code> : item.value}</dd></div>)}
  </dl>;
}
