import { useRef } from "react";
import type { InputHTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { Field } from "./Field";
import { slugName } from "./identity";
import { searchKeyAction } from "./logic";

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "onSubmit" | "id" | "required"> {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** Called with the query on Enter. */
  onSubmit?: (value: string) => void;
  /** The accessible name of the clear button. */
  clearLabel?: string;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
  /** Default true: a clear button appears with a query and Esc clears it. `false` renders neither (a filter that owns Esc or its own reset). */
  clearable?: boolean;
}

/** A native search input with a clear button. Esc clears a non-empty query (unless `clearable` is false); Enter submits. Controlled. */
export function SearchField({ label, value, onChange, onSubmit, clearLabel = "Clear search", hint, error, id, name, onKeyDown, clearable = true, ...input }: SearchFieldProps) {
  const field = useRef<HTMLInputElement>(null);
  const clear = () => { onChange(""); field.current?.focus(); };
  function key(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const action = searchKeyAction(event.key, clearable ? value : "");
    if (action === "clear") { event.preventDefault(); event.stopPropagation(); clear(); }
    else if (action === "submit" && onSubmit) { event.preventDefault(); onSubmit(value); }
  }
  return (
    <Field label={label} hint={hint} error={error} id={id} className="search-field-wrap">
      {(control) => (
        <div className="search-field">
          <input autoComplete="off" spellCheck={false} {...input} {...control} ref={field} type="search" name={name ?? slugName(label, control.id)}
            value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={key} />
          {clearable && value !== "" && <button type="button" className="quiet search-clear" aria-label={clearLabel} disabled={input.disabled} onClick={clear}><span aria-hidden="true">×</span></button>}
        </div>
      )}
    </Field>
  );
}
