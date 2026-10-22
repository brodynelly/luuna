import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * Selection and confirmation: the selectable card every list of choices uses, and the notice
 * that confirms a completed action where it happened (HIG feedback: confirm significant actions,
 * never with an alert). A notice stays until it is dismissed or replaced; it is never timed.
 */
export interface SelectableCardProps {
  selected: boolean;
  onSelect: () => void;
  title: ReactNode;
  meta?: ReactNode;
  disabled?: boolean;
  label?: string;
  "data-capability"?: string;
}

/** A full-width toggle button in a list (runs, projects, board cards). */
export function SelectableCard({ selected, onSelect, title, meta, disabled, label, ...marker }: SelectableCardProps) {
  return <button type="button" className={`run-card ${selected ? "selected" : ""}`} disabled={disabled} aria-label={label} {...marker} onClick={onSelect} aria-pressed={selected}>
    <span className="run-prompt">{title}</span>
    {meta && <span className="run-meta">{meta}</span>}
  </button>;
}

/** A card that opens something rather than selecting it (a Board card opens its ticket). */
export function OpenCard({ onOpen, title, meta, disabled, label }: { onOpen: () => void; title: ReactNode; meta?: ReactNode; disabled?: boolean; label: string }) {
  return <button type="button" className="run-card" disabled={disabled} aria-label={label} onClick={onOpen}>
    <span className="run-prompt">{title}</span>
    {meta && <span className="run-meta">{meta}</span>}
  </button>;
}

interface NoticeApi { notice: { text: string; id: number } | null; notify: (text: string) => void; dismiss: () => void }

const NoticeContext = createContext<NoticeApi>({ notice: null, notify: () => undefined, dismiss: () => undefined });

/** Reports a completed action to the window's notice; outside a provider it does nothing. */
export function useNotify(): (text: string) => void {
  return useContext(NoticeContext).notify;
}

/** Holds the window's one notice; a new `scope` (another connection) clears it, so a notice never outlives what it reported. */
export function NoticeProvider({ scope, children }: { scope?: unknown; children: ReactNode }) {
  const [notice, setNotice] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => setNotice(null), [scope]);
  const notify = useCallback((text: string) => setNotice({ text, id: Date.now() }), []);
  const dismiss = useCallback(() => setNotice(null), []);
  const api = useMemo(() => ({ notice, notify, dismiss }), [notice, notify, dismiss]);
  return <NoticeContext.Provider value={api}>{children}</NoticeContext.Provider>;
}

/** Where the notice shows: a polite live region at the top of the content. */
export function NoticeRegion() {
  const { notice, dismiss } = useContext(NoticeContext);
  return <div className="notice-region" role="status" aria-live="polite">
    {notice && <p className="notice" key={notice.id}>{notice.text}<button className="text-button" type="button" onClick={dismiss}>Dismiss</button></p>}
  </div>;
}

/** The past tense of an action label, for its notice: "Approval" becomes "Approved". */
export const COMPLETED: Readonly<Record<string, string>> = {
  "Ticket creation": "Ticket created",
  "Ticket edit": "Ticket saved",
  "Ticket reconciliation": "Ticket reconciled",
  Planning: "Plan created",
  Approval: "Plan approved",
  Implementation: "Implementation started",
  "Task resumption": "Task resumed",
  Cancellation: "Cancellation requested",
  Validation: "Validation started",
  Repair: "Repair started",
  Publication: "Publication started",
  "Publication reconciliation": "Publication reconciled",
  "Repair after a CI failure": "Repair after the CI failure started",
  Registration: "Project registered",
  "Project import": "Project imported",
  Scaffolding: "Project created",
  Discovery: "Discovery finished",
  "Manifest confirmation": "Manifest confirmed",
  Baseline: "Baseline started",
  "Baseline cancellation": "Baseline cancellation requested",
  Rebind: "Repository rebound",
  "Project export": "Project exported",
};
