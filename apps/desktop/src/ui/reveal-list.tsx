import type { ReactNode } from "react";
import { useReveal } from "./motion";

/**
 * A plain list whose items rise in one after another, once, when it mounts (the Board's cards).
 * Same markup as `List`; the list keeps its name through `aria-labelledby`.
 */
export function RevealList({ className, labelledBy, children }: { className?: string; labelledBy?: string; children: ReactNode }) {
  const ref = useReveal<HTMLUListElement>();
  return <ul ref={ref} className={["reveal", className].filter(Boolean).join(" ")} aria-labelledby={labelledBy}>{children}</ul>;
}
