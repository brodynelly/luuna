import { useId } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { groupName, initialOpen } from "./accordionState";

export interface AccordionItem {
  id: string;
  title: ReactNode;
  content: ReactNode;
  defaultOpen?: boolean;
}

export interface AccordionProps extends HTMLAttributes<HTMLDivElement> {
  items: readonly AccordionItem[];
  /** Several panels may be open. Otherwise the items share a `name` and the browser keeps one open. */
  multiple?: boolean;
  /** Explicit group name for single-open mode; generated when omitted. */
  name?: string;
}

/** Native `details` panels. Open state is the browser's own; nothing is animated. */
export function Accordion({ items, multiple = false, name, className, ...rest }: AccordionProps) {
  const generated = useId();
  const group = groupName(multiple, generated, name);
  const open = new Set(initialOpen(items, multiple));
  return <div className={cx("accordion", className)} {...rest}>
    {items.map((item) => <details key={item.id} name={group} open={open.has(item.id) || undefined}>
      <summary>{item.title}</summary>
      <div className="accordion-panel">{item.content}</div>
    </details>)}
  </div>;
}
