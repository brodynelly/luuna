import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import type { Tone } from "../design/tone";

/**
 * Content: lists, facts, notes and the feedback states every view shares. Tones follow
 * design/tone.ts; nothing here decides a state, it only shows the runtime's.
 */

type Marked = { "data-capability"?: string; "data-surface"?: string; "data-tone"?: string };

/** A block of layout inside a view: a row, a column or a group (labelled with `role="group"`). */
export function Box({ children, ...props }: HTMLAttributes<HTMLDivElement> & Marked) {
  return <div {...props}>{children}</div>;
}

/** A paragraph of body text. */
export function Text({ children, ...props }: HTMLAttributes<HTMLParagraphElement> & Marked) {
  return <p {...props}>{children}</p>;
}

/** Secondary text under or beside a control: a hint, a scope, a count. */
export function Hint({ children, ...props }: HTMLAttributes<HTMLElement> & Marked) {
  return <small {...props}>{children}</small>;
}

/** A link that leaves the window (documentation, a pull request); it opens in the browser. */
export function ExternalLink({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>;
}

/** A bordered list of records (baselines, recipes, tickets, checks, findings). */
export function RecordList({ label, className, children, ...marker }: { label?: string; className?: string; "data-capability"?: string; children: ReactNode }) {
  return <ul className={[className, "record-list"].filter(Boolean).join(" ")} aria-label={label} {...marker}>{children}</ul>;
}

export interface RecordProps {
  /** A leaf record (a baseline, a check, a finding) carries a toned rule on its leading edge. */
  tone?: Tone;
  /** Title and badge on the first line; every later child on its own full-width line. */
  headed?: boolean;
  className?: string;
  id?: string;
  /** A record a request lands on (a ticket) can take programmatic focus. */
  focusable?: boolean;
  children: ReactNode;
}

export function RecordItem({ tone, headed = false, className, id, focusable = false, children }: RecordProps) {
  const classes = ["record", headed ? "record-headed" : undefined, className].filter(Boolean).join(" ");
  return <li className={classes} id={id} tabIndex={focusable ? -1 : undefined} data-tone={tone}>{children}</li>;
}

/** A labelled, focusable, bounded scroll region of records (an event log). */
export function ScrollList({ label, children, ...marker }: { label: string; "data-capability"?: string; children: ReactNode }) {
  return <ol className="events" aria-label={label} tabIndex={0} {...marker}>{children}</ol>;
}

/** A plain, unstyled list (rows inside a record, links in Help). */
export function List({ label, className, ordered = false, labelledBy, children, ...marker }: { label?: string; className?: string; ordered?: boolean; labelledBy?: string; "data-capability"?: string; children: ReactNode }) {
  return ordered
    ? <ol className={className} aria-label={label} aria-labelledby={labelledBy} {...marker}>{children}</ol>
    : <ul className={className} aria-label={label} aria-labelledby={labelledBy} {...marker}>{children}</ul>;
}

/** A list shown as a toned callout (a discovery's open questions). */
export function CalloutList({ tone, label, className, children }: { tone: Tone; label: string; className?: string; children: ReactNode }) {
  return <ul className={[className, "callout"].filter(Boolean).join(" ")} data-tone={tone} aria-label={label}>{children}</ul>;
}

/** A sentence the runtime's answer produced (an import or scaffold result), announced politely when `status` is set. */
export function StatusLine({ status = true, className = "reason", children }: { status?: boolean; className?: string; children: ReactNode }) {
  return <p className={className} role={status ? "status" : undefined}>{children}</p>;
}

/** Saves a document the client already holds (a project or memory export) under a file name. */
export function DownloadLink({ href, file, children }: { href: string; file: string; children: ReactNode }) {
  return <a href={href} download={file}>{children}</a>;
}

export function Item({ className, children }: { className?: string; children: ReactNode }) {
  return <li className={className}>{children}</li>;
}

export interface Fact { term: ReactNode; value: ReactNode; key?: string }

/** A definition list of exact, full identities. */
export function Facts({ items, className }: { items: readonly Fact[]; className?: string }) {
  return <dl className={["facts", className].filter(Boolean).join(" ")}>{items.map((item, index) => <div key={item.key ?? index}><dt>{item.term}</dt><dd>{item.value}</dd></div>)}</dl>;
}

/** A muted evidence sentence; its `code` identities keep full contrast. */
export function Meta({ block = false, className, label, id, children, ...marker }: { block?: boolean; className?: string; label?: string; id?: string; "data-capability"?: string; children: ReactNode }) {
  const classes = [className, "meta"].filter(Boolean).join(" ");
  return block
    ? <p className={classes} aria-label={label} id={id} {...marker}>{children}</p>
    : <small className={classes} aria-label={label} id={id} {...marker}>{children}</small>;
}

/** A static descriptor chip. */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}

/** An exact identity: a hash, commit, path or id, shown whole. */
export function Id({ className, children }: { className?: string; children: ReactNode }) {
  return <code className={className}>{children}</code>;
}

/** A toned callout that holds blocks (paragraphs and lists), announced as a status. */
export function CalloutBlock({ tone, className, label, children, ...marker }: { tone?: Tone; className?: string; label?: string; "data-surface"?: string; children: ReactNode }) {
  return <div className={[className, "callout"].filter(Boolean).join(" ")} data-tone={tone} role="status" aria-label={label} {...marker}>{children}</div>;
}

/** A recorded reason in the tone of the state it explains, then the next allowed step. */
export function ReasonNote({ tone, reason, next, block = false, className }: { tone?: Tone; reason: ReactNode; next?: ReactNode; block?: boolean; className?: string }) {
  const classes = ["failure-note", className].filter(Boolean).join(" ");
  const body = <>{reason}{next ? <> <span className="recovery-note">{next}</span></> : null}</>;
  return block ? <p className={classes} data-tone={tone}>{body}</p> : <small className={classes} data-tone={tone}>{body}</small>;
}

/** The next allowed step on its own, ruled in the accent. */
export function NextStep({ block = false, status = false, children }: { block?: boolean; status?: boolean; children: ReactNode }) {
  const role = status ? "status" : undefined;
  return block ? <p className="recovery-note" role={role}>{children}</p> : <span className="recovery-note" role={role}>{children}</span>;
}

/** A toned box for outages, open questions and the runtime's activity. */
export function Callout({ tone, status = false, className, label, children }: { tone?: Tone; status?: boolean; className?: string; label?: string; children: ReactNode }) {
  return <p className={[className, "callout"].filter(Boolean).join(" ")} data-tone={tone} role={status ? "status" : undefined} aria-label={label}>{children}</p>;
}

/** A refused action or a failed load: always dismissible, never used for an outage. */
export function ErrorBanner({ message, onDismiss }: { message: ReactNode; onDismiss: () => void }) {
  return <div className="error" role="alert">{message}<button className="text-button" type="button" onClick={onDismiss}>Dismiss</button></div>;
}

/** An empty screen invites the next action: what is missing, then the control that adds it. */
export function EmptyState({ boxed = false, title, action, children }: { boxed?: boolean; title?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  if (!title && !action) return <p className={boxed ? "empty empty-box" : "empty"}>{children}</p>;
  return <div className={["empty-state", boxed ? "empty-box" : undefined].filter(Boolean).join(" ")}>
    {title && <p className="empty-title">{title}</p>}
    {children && <p className="empty">{children}</p>}
    {action}
  </div>;
}

/** Shown while a view reads the runtime: placeholder rows in the shape of the content, announced once. */
export function Loading({ label, rows = 3 }: { label: string; rows?: number }) {
  return <div className="skeleton" role="status" aria-live="polite">
    <span className="visually-hidden">{label}</span>
    {Array.from({ length: rows }, (_, index) => <span key={index} className="skeleton-row" aria-hidden="true" />)}
  </div>;
}

/** Text only screen readers hear. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="visually-hidden">{children}</span>;
}

/** The empty-activity placeholder of a pane that shows a selection. */
export function Placeholder({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return <div className="activity-empty empty-box"><span aria-hidden="true">◌</span><p>{title}</p>{children && <small>{children}</small>}</div>;
}
