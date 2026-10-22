import { useId } from "react";
import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export interface SegmentedOption { value: string; label: string; disabled?: boolean }

export interface SegmentedControlProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Required: names the radio group. */
  "aria-label": string;
  options: ReadonlyArray<SegmentedOption>;
  value: string;
  onChange: (value: string) => void;
  /** Radio group name; generated when omitted. */
  name?: string;
}

/**
 * A small set of mutually exclusive choices on native radio inputs: arrow keys, Tab as one stop and form
 * semantics come from the platform. Controlled only. The selected segment is shown by fill and weight, and
 * is the checked radio for assistive technology.
 */
export function SegmentedControl({ options, value, onChange, name, className, ...rest }: SegmentedControlProps) {
  const generated = useId();
  const group = name ?? `segmented-${generated.replaceAll(":", "")}`;
  return <div role="radiogroup" className={cx("segmented", className)} {...rest}>
    {options.map((option) => <label key={option.value} className="segmented-option">
      <input type="radio" name={group} value={option.value} checked={option.value === value} disabled={option.disabled} onChange={() => onChange(option.value)} />
      <span>{option.label}</span>
    </label>)}
  </div>;
}
