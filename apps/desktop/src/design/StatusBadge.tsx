import type { ReactNode } from "react";
import type { Tone } from "./tone";

/**
 * The one status chip. Its text is exactly the runtime's value (smokes read it); the tone adds
 * colour and a shape mark, never words. An in-progress tone also pulses its mark, in CSS only (components.css). Without a tone it is a plain descriptor chip.
 */
export function StatusBadge({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return <span className="state" data-tone={tone}>{children}</span>;
}
