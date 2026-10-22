import { useId } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { fieldWiring, hasContent, joinClass } from "./identity";
import type { FieldControlProps } from "./identity";

export type { FieldControlProps } from "./identity";

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "id"> {
  label: ReactNode;
  /** Help that stays visible; linked to the control with aria-describedby. */
  hint?: ReactNode;
  /** The problem and how to fix it. Shown with a danger mark and text; sets aria-invalid on the control. */
  error?: ReactNode;
  required?: boolean;
  /** The control's id; generated when omitted. */
  id?: string;
  /** Renders the control with the generated id and aria attributes spread onto it. */
  children: (control: FieldControlProps) => ReactNode;
}

/** A visible label, a control, a hint and an error, wired with generated ids. The label is always visible. */
export function Field({ label, hint, error, required, id, className, children, ...rest }: FieldProps) {
  const generated = useId();
  const wiring = fieldWiring(id ?? generated, { hint, error, required });
  return (
    <div {...rest} className={joinClass("field", className)}>
      <label htmlFor={wiring.control.id}>{label}{required && <span className="field-required"> (required)</span>}</label>
      {children(wiring.control)}
      {hasContent(hint) && <small id={wiring.hintId} className="field-hint">{hint}</small>}
      <span className="field-error-slot" aria-live="polite">
        {hasContent(error) && <small id={wiring.errorId} className="field-error"><span className="tone-mark" data-tone="danger" aria-hidden="true" />{error}</small>}
      </span>
    </div>
  );
}
