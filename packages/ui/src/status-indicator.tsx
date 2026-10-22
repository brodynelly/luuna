import type { ReactNode } from "react";
import type { Tone } from "./tone/tone";

/**
 * Status indicator (Ledger StatusIndicator): a tone shape, a word and optional detail, for a live
 * state such as the runtime connection. The shape and the word say the state, never colour alone.
 * `live` announces changes politely. It shows the runtime's tone and decides nothing.
 */
export function StatusIndicator({ tone, label, detail, live = false }: { tone?: Tone; label: ReactNode; detail?: ReactNode; live?: boolean }) {
  return <span className="status-indicator" role={live ? "status" : undefined} aria-live={live ? "polite" : undefined}><i className="tone-mark" aria-hidden="true" data-tone={tone} /><span className="status-label">{label}</span>{detail && <span className="status-detail">{detail}</span>}</span>;
}
