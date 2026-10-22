import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";

/**
 * Test helper (no DOM available): walk a React element tree without rendering it. Function components are
 * called to expand them; a component that needs hooks is kept as an element, props visible.
 */
export type Props = Record<string, unknown> & { children?: ReactNode };

export function walk(node: ReactNode, visit: (element: ReactElement<Props>) => void): void {
  if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return; }
  if (!isValidElement<Props>(node)) return;
  visit(node);
  if (typeof node.type === "function") {
    try { walk((node.type as (props: Props) => ReactNode)(node.props), visit); return; } catch { /* needs a renderer: keep its props only */ }
  }
  walk(node.props.children, visit);
}

export function findAll(node: ReactNode, test: (element: ReactElement<Props>) => boolean): ReactElement<Props>[] {
  const found: ReactElement<Props>[] = [];
  walk(node, (element) => { if (test(element)) found.push(element); });
  return found;
}

export const text = (element: ReactElement<Props>): string => {
  const parts: string[] = [];
  const collect = (child: ReactNode): void => {
    if (Array.isArray(child)) child.forEach(collect);
    else if (typeof child === "string" || typeof child === "number") parts.push(String(child));
    else if (isValidElement<Props>(child)) collect(child.props.children);
  };
  collect(element.props.children);
  return parts.join("");
};
