import type { ReactNode } from "react";

/**
 * Layout: the page template every view renders through, and the containers inside it. One
 * template means every view opens the same way: a large title, one sentence on what the view is
 * for, its toolbar actions on the trailing side, then its content (docs/DESIGN-SYSTEM.md › Page).
 * Headings come only from here, so the outline (h2 per view, h3 per section, h4 inside a
 * section) is the same everywhere.
 */
export type HeadingLevel = 2 | 3 | 4;

export function Heading({ level, id, children }: { level: HeadingLevel; id?: string; children: ReactNode }) {
  if (level === 2) return <h2 id={id}>{children}</h2>;
  if (level === 3) return <h3 id={id}>{children}</h3>;
  return <h4 id={id}>{children}</h4>;
}

/** A heading row: the heading, then descriptors and actions on the trailing side. */
export function HeadingRow({ level, id, title, accessory, className }: { level: HeadingLevel; id?: string; title: ReactNode; accessory?: ReactNode; className?: string }) {
  return <div className={["panel-heading", className].filter(Boolean).join(" ")}><Heading level={level} id={id}>{title}</Heading>{accessory}</div>;
}

export interface PageProps {
  /** The view's id: its heading is `<id>-heading` and its container `data-surface` when given. */
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** Toolbar actions for the whole view, on the trailing side of the title. */
  actions?: ReactNode;
  /** The experience surface the contracts trace, written literally as a data-surface attribute. */
  "data-surface"?: string;
  className?: string;
  children: ReactNode;
}

/** A row of controls on the heading's rhythm, without a heading (paging, secondary actions). */
export function Toolbar({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={["panel-heading", className].filter(Boolean).join(" ")}>{children}</div>;
}

/** The template of every view. */
export function Page({ id, title, description, actions, className, children, ...marker }: PageProps) {
  return <section className={["panel page", className].filter(Boolean).join(" ")} aria-labelledby={`${id}-heading`} {...marker}>
    <HeadingRow level={2} id={`${id}-heading`} title={title} accessory={actions} />
    {description && <p className="scope">{description}</p>}
    {children}
  </section>;
}

export interface SectionProps {
  /** The heading's id; the section is labelled by it. */
  id: string;
  title: ReactNode;
  level?: 3 | 4;
  description?: ReactNode;
  /** Descriptor chips and actions on the trailing side of the heading. */
  accessory?: ReactNode;
  /** `card` is a raised panel of its own; `subpanel` is ruled off inside a card; `plain` has no chrome. */
  variant?: "card" | "subpanel" | "plain";
  as?: "section" | "aside";
  className?: string;
  "data-capability"?: string;
  "data-tone"?: string;
  children: ReactNode;
}

const SECTION_CLASS = { card: "panel", subpanel: "subpanel", plain: "section-plain" } as const;

/** A titled section of a view. */
export function Section({ id, title, level = 3, description, accessory, variant = "card", as = "section", className, children, ...marker }: SectionProps) {
  const classes = [className, SECTION_CLASS[variant]].filter(Boolean).join(" ");
  const body = <>
    <HeadingRow level={level} id={id} title={title} accessory={accessory} />
    {description && <p className="scope">{description}</p>}
    {children}
  </>;
  return as === "aside" ? <aside className={classes} aria-labelledby={id} {...marker}>{body}</aside> : <section className={classes} aria-labelledby={id} {...marker}>{body}</section>;
}

/** An untitled card: a raised group with the panel's padding (a project's detail, a candidate). */
export function Card({ className, label, children }: { className?: string; label?: string; children: ReactNode }) {
  return <div className={["card", className].filter(Boolean).join(" ")} role={label ? "group" : undefined} aria-label={label}>{children}</div>;
}

/** A raised group of related settings inside a card. */
export function Tray({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={["tray", className].filter(Boolean).join(" ")}>{children}</div>;
}

/** A bordered, unfilled group around a form or a set of fields. */
export function Group({ className, label, children }: { className?: string; label?: string; children: ReactNode }) {
  return <div className={[className, "form-group"].filter(Boolean).join(" ")} role={label ? "group" : undefined} aria-label={label}>{children}</div>;
}

export interface DisclosureProps {
  summary: ReactNode;
  /** A section-level disclosure (diff, evidence, event record) uses the larger summary. */
  section?: boolean;
  open?: boolean;
  className?: string;
  "data-capability"?: string;
  /** Called with the new state when people open or close it. */
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}

/** Progressive disclosure: content that most people need only sometimes. */
export function Disclosure({ summary, section = true, open, className, onToggle, children, ...marker }: DisclosureProps) {
  return <details className={[className, section ? "section" : undefined].filter(Boolean).join(" ") || undefined} open={open} onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined} {...marker}><summary>{summary}</summary>{children}</details>;
}

/** A labelled, focusable, bounded scroll region of machine output (a plan, a diff, a log). */
export function CodeBlock({ label, className, children, ...marker }: { label: string; className?: string; "data-capability"?: string; children: ReactNode }) {
  return <pre className={className} aria-label={label} tabIndex={0} {...marker}>{children}</pre>;
}

/** Machine output that is short enough not to scroll on its own. */
export function Output({ children }: { children: ReactNode }) {
  return <pre>{children}</pre>;
}

/** A side-by-side layout: a rail and a detail column that stack at 920 px. */
export function Split({ className, rail, children }: { className: string; rail: ReactNode; children: ReactNode }) {
  return <div className={className}>{rail}{children}</div>;
}
