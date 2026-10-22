import { useLayoutEffect, useRef, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { Field } from "./Field";
import { slugName } from "./identity";

export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "id" | "required"> {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** Show the reveal toggle. Default true. */
  revealable?: boolean;
  /** The reveal toggle's text; it stays the same when pressed, aria-pressed carries the state. */
  revealLabel?: string;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
  required?: boolean;
}

/**
 * A masked secret field. The value is pushed into the element as a property and never handed to React as a
 * `value` prop, so it is never written to a markup attribute (React mirrors a controlled value into the
 * value attribute, and server markup prints it).
 */
export function PasswordField({ label, value, onChange, revealable = true, revealLabel = "Show value", hint, error, id, required, name, ...input }: PasswordFieldProps) {
  const field = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState(false);
  useLayoutEffect(() => { if (field.current && field.current.value !== value) field.current.value = value; }, [value]);
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id} className="password-field-wrap">
      {(control) => (
        <div className="password-field">
          <input autoComplete="off" autoCapitalize="off" spellCheck={false} {...input} {...control} required={required} ref={field}
            type={shown ? "text" : "password"} name={name ?? slugName(label, control.id)} onChange={(event) => onChange(event.currentTarget.value)} />
          {revealable && <button type="button" className="quiet password-reveal" aria-pressed={shown} disabled={input.disabled} onClick={() => setShown((current) => !current)}>{revealLabel}</button>}
        </div>
      )}
    </Field>
  );
}
