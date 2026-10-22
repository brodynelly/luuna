import type { InputHTMLAttributes, ReactNode } from "react";
import { Field } from "./Field";
import { slugName } from "./identity";
import { parseNumber } from "./logic";

export interface NumberFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "id" | "required" | "min" | "max" | "step"> {
  label: ReactNode;
  /** The text in the field, so a half-typed "-" or "1." is never rewritten. */
  value: string;
  /** Receives the text and the number it parses to (null when empty or not a number). */
  onChange: (value: string, parsed: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
  required?: boolean;
}

/** A native number input: the platform's up and down keys, tabular numerals, no custom stepper. */
export function NumberField({ label, value, onChange, min, max, step, hint, error, id, required, name, ...input }: NumberFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id} className="number-field-wrap">
      {(control) => (
        <input inputMode="decimal" {...input} {...control} required={required} type="number" min={min} max={max} step={step}
          name={name ?? slugName(label, control.id)} value={value} onChange={(event) => onChange(event.target.value, parseNumber(event.target.value))} />
      )}
    </Field>
  );
}
