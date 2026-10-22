import { useId } from "react";
import type { FieldsetHTMLAttributes, ReactNode } from "react";
import { describedBy, hasContent, joinClass } from "./identity";

export interface RadioOption { value: string; label: ReactNode; hint?: ReactNode; disabled?: boolean }

export interface RadioGroupProps extends Omit<FieldsetHTMLAttributes<HTMLFieldSetElement>, "onChange"> {
  /** The group's visible name. Required: a radio group without a legend has no accessible name. */
  legend: ReactNode;
  /** Shared by every radio, which makes the arrow keys move between them natively. */
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly RadioOption[];
  hint?: ReactNode;
  error?: ReactNode;
}

/** One choice from a few, as native radios in a fieldset. Controlled. */
export function RadioGroup({ legend, name, value, onChange, options, hint, error, className, ...rest }: RadioGroupProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasError = hasContent(error);
  return (
    <fieldset {...rest} className={joinClass("radio-group", className)}
      aria-describedby={describedBy(rest["aria-describedby"], hasContent(hint) && hintId, hasError && errorId)}>
      <legend>{legend}</legend>
      {options.map((option, index) => {
        const optionHint = hasContent(option.hint) ? `${id}-option-${index}-hint` : undefined;
        return (
          <label key={option.value} className="radio-option">
            <input type="radio" name={name} value={option.value} checked={option.value === value} disabled={option.disabled}
              aria-describedby={optionHint} aria-invalid={hasError ? true : undefined} onChange={() => onChange(option.value)} />
            <span className="radio-text">{option.label}{optionHint && <small id={optionHint}>{option.hint}</small>}</span>
          </label>
        );
      })}
      {hasContent(hint) && <small id={hintId} className="field-hint">{hint}</small>}
      <span className="field-error-slot" aria-live="polite">
        {hasError && <small id={errorId} className="field-error"><span className="tone-mark" data-tone="danger" aria-hidden="true" />{error}</small>}
      </span>
    </fieldset>
  );
}
