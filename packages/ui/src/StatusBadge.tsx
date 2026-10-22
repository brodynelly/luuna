import type { ReactNode } from "react";
import type { Tone } from "./tone/tone";

/**
 * The one status chip. Its text is exactly the runtime's value (smokes read it); the tone adds
 * colour and a shape mark, never words. It never animates (ADR 0033: status is a word plus a shape). Without a tone it is a plain descriptor chip.
 */
export function StatusBadge({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return <span className="state" data-tone={tone}>{children}</span>;
}
