import type { ReactNode } from "react";

/** A keyboard key cap (Help's shortcuts topic). The cap style is design/overlays.css `kbd`. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
