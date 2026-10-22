import { useId, useMemo, useState } from "react";
import type { InputHTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { Field } from "./Field";
import { labelText, slugName } from "./identity";
import { filterOptions, firstActive, nextListState } from "./listbox";

export interface ComboboxOption { value: string; label: string; hint?: string }

export interface ComboboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "id" | "required" | "role"> {
  label: ReactNode;
  options: readonly ComboboxOption[];
  /** The selected option's value, or "" for none. */
  value: string;
  onChange: (value: string) => void;
  /** Replaces the default case-insensitive label match. */
  filter?: (option: ComboboxOption, query: string) => boolean;
  /** Shown when the typed text matches nothing. */
  emptyLabel?: string;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
  required?: boolean;
}

/**
 * A single-select ARIA 1.2 combobox. Focus stays in the input; Down opens and moves aria-activedescendant,
 * Enter selects, Esc closes and restores the selected label, Home and End move once an option is active.
 * `text` is null while the user is not editing, so the field shows the selected label.
 */
export function Combobox({ label, options, value, onChange, filter, emptyLabel = "No matches", hint, error, id, required, name, onKeyDown, onBlur, onClick, ...input }: ComboboxProps) {
  const listId = useId();
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const selected = options.find((option) => option.value === value);
  const visible = useMemo(() => (text === null ? [...options] : filterOptions(options, text, filter)), [options, text, filter]);
  const selectedIndex = visible.findIndex((option) => option.value === value);
  const optionId = (index: number) => `${listId}-option-${index}`;
  const showList = open && visible.length > 0;

  function choose(option: ComboboxOption | undefined) {
    if (option) onChange(option.value);
    setText(null); setOpen(false); setActive(-1);
  }
  function key(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const step = nextListState(event.key, { open, active, count: visible.length }, selectedIndex);
    if (!step) return;
    event.preventDefault();
    if (event.key === "Escape") event.stopPropagation();
    if (step.select) { choose(visible[step.active]); return; }
    setOpen(step.open); setActive(step.active);
    if (!step.open) setText(null);
  }
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id} className="combobox-wrap">
      {(control) => (
        <div className="combobox">
          <input autoComplete="off" spellCheck={false} {...input} {...control} required={required} type="text" role="combobox" name={name ?? slugName(label, control.id)}
            aria-expanded={showList} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
            value={text ?? selected?.label ?? ""}
            onChange={(event) => { const next = event.target.value; setText(next); setOpen(true); setActive(firstActive(filterOptions(options, next, filter).length)); }}
            onKeyDown={key}
            onClick={(event) => { onClick?.(event); if (!open) { setOpen(true); setActive(selectedIndex); } }}
            onBlur={(event) => { onBlur?.(event); setOpen(false); setText(null); setActive(-1); }} />
          <ul id={listId} role="listbox" className="combobox-list" aria-label={labelText(label) || "Options"} hidden={!showList}>
            {showList && visible.map((option, index) => (
              <li key={option.value} id={optionId(index)} role="option" className="combobox-option" aria-selected={option.value === value}
                data-active={index === active ? "true" : undefined}
                onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => choose(option)}>
                <span>{option.label}</span>{option.hint && <small>{option.hint}</small>}
              </li>
            ))}
          </ul>
          {open && visible.length === 0 && <p className="combobox-empty">{emptyLabel}</p>}
          <span className="visually-hidden" role="status">{open ? (visible.length > 0 ? `${visible.length} options` : emptyLabel) : ""}</span>
        </div>
      )}
    </Field>
  );
}
