import { isValidElement, useId } from "react";
import type { ButtonHTMLAttributes, FormEvent, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/**
 * Controls: every button, field and form in the client renders through these, so a control looks
 * and behaves the same on every view (docs/DESIGN-SYSTEM.md › Components). Markup is the plain
 * element the smokes and the accessibility audit read: a label wraps its field, a button is a
 * button. A control that starts a cataloged action carries its catalog id in a data-capability attribute, written
 * literally where it is used, because the parity contracts read the markers from source.
 */
export type ButtonVariant = "secondary" | "primary" | "quiet" | "danger" | "text";

const BUTTON_CLASS: Record<ButtonVariant, string | undefined> = { secondary: undefined, primary: "primary", quiet: "quiet", danger: "danger", text: "text-button" };

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  /** Submit buttons belong to a form; everything else is an explicit `type="button"`. */
  submit?: boolean;
  "data-capability"?: string;
}

/** A push button. One `primary` per action group; `danger` and `text` are small. */
export function Button({ variant = "secondary", submit = false, className, children, ...rest }: ButtonProps) {
  const classes = [BUTTON_CLASS[variant], className].filter(Boolean).join(" ") || undefined;
  return <button type={submit ? undefined : "button"} className={classes} {...rest}>{children}</button>;
}

/** The plain text of a label, for the default `name` of its field. */
function labelText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(labelText).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return labelText(node.props.children);
  return "";
}

/**
 * Every control carries a stable unique `id` (useId) and a `name`, so the browser's autofill and
 * form audits see an identified field. An explicit `id` or `name` from the caller always wins; the
 * default name is a slug of the label, or the id when the label has no text.
 */
function useIdentity(label: ReactNode, id?: string, name?: string): { id: string; name: string } {
  const generated = useId();
  const slug = labelText(label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const fieldId = id ?? generated;
  return { id: fieldId, name: name ?? (slug || fieldId) };
}

interface LabelledProps { label: ReactNode; labelClassName?: string }

export type TextFieldProps = LabelledProps & InputHTMLAttributes<HTMLInputElement> & {
  /** Typed identifiers (paths, ids, URLs) render monospace with spell checking off. */
  mono?: boolean;
};

/** A single-line field under its label. */
export function TextField({ label, labelClassName, mono = false, id, name, ...input }: TextFieldProps) {
  const identity = useIdentity(label, id, name);
  return <label className={labelClassName}>{label}<input {...input} {...identity} spellCheck={mono ? false : input.spellCheck} /></label>;
}

export type TextAreaProps = LabelledProps & TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean };

/** A multi-line field under its label. */
export function TextArea({ label, labelClassName, mono = false, id, name, ...area }: TextAreaProps) {
  const identity = useIdentity(label, id, name);
  return <label className={labelClassName}>{label}<textarea {...area} {...identity} spellCheck={mono ? false : area.spellCheck} /></label>;
}

export interface Option { value: string; label: ReactNode }

export type SelectFieldProps = LabelledProps & SelectHTMLAttributes<HTMLSelectElement> & { options: readonly Option[] };

/** A pop-up button of fixed choices; prefer it to typing when the choices are known. */
export function SelectField({ label, labelClassName, options, id, name, ...select }: SelectFieldProps) {
  const identity = useIdentity(label, id, name);
  return <label className={labelClassName}>{label}<select {...select} {...identity}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

/** The options of a select from plain values, each shown as its value or a mapped label. */
export function options(values: readonly string[], label: (value: string) => ReactNode = (value) => value): Option[] {
  return values.map((value) => ({ value, label: label(value) }));
}

export type CheckboxProps = { label: ReactNode; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className">;

/** A checkbox on one row with its label. */
export function Checkbox({ label, className, id, name, ...input }: CheckboxProps) {
  const identity = useIdentity(label, id, name);
  return <label className={className}><input type="checkbox" {...input} {...identity} /> {label}</label>;
}

export type SwitchProps = { label: ReactNode; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role" | "className">;

/** An on/off setting that applies at once: a checkbox with the switch role. Use a Checkbox for a choice submitted with a form. */
export function Switch({ label, className, id, name, ...input }: SwitchProps) {
  const identity = useIdentity(label, id, name);
  return <label className={["switch", className].filter(Boolean).join(" ")}><input type="checkbox" role="switch" {...input} {...identity} /> {label}</label>;
}

export interface FormProps {
  onSubmit: (event: FormEvent) => void;
  className?: string;
  id?: string;
  /** Disables every control of the form at once (busy, offline, or not yet allowed). */
  disabled?: boolean;
  children: ReactNode;
}

/** A form whose controls sit in one fieldset, so a single flag disables them all. */
export function Form({ onSubmit, className, id, disabled, children }: FormProps) {
  return <form onSubmit={onSubmit} className={className} id={id}><fieldset disabled={disabled}>{children}</fieldset></form>;
}

/** Submits after preventing the browser's navigation. */
export function submitted(action: () => void) {
  return (event: FormEvent) => { event.preventDefault(); action(); };
}

/** A form's last row: the hint on the leading side, the one primary action on the trailing side. */
export function FormFooter({ hint, hintId, children }: { hint?: ReactNode; hintId?: string; children: ReactNode }) {
  return <div className="form-footer">{hint !== undefined && <small id={hintId}>{hint}</small>}{children}</div>;
}

/** Side-by-side fields that wrap one per line when narrow. */
export function FieldRow({ className, label, children }: { className?: string; label?: string; children: ReactNode }) {
  return <div className={["field-row", className].filter(Boolean).join(" ")} role={label ? "group" : undefined} aria-label={label}>{children}</div>;
}

/** A wrapping row of actions; a trailing `small` takes the full row and `danger` sits at the end. */
export function Actions({ className, label, children }: { className?: string; label?: string; children: ReactNode }) {
  return <div className={[className, "actions"].filter(Boolean).join(" ")} role={label ? "group" : undefined} aria-label={label}>{children}</div>;
}
