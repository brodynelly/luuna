import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import type { Tone } from "../tone/tone";
import { joinClass } from "./identity";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "onToggle" | "aria-pressed" | "children"> {
  children: ReactNode;
  selected?: boolean;
  /** Makes the chip a toggle button (aria-pressed). Without it the chip is a plain descriptor. */
  onToggle?: (selected: boolean) => void;
  /** One of the six tones: a shape mark beside the text, never colour alone. */
  tone?: Tone;
}

/** A compact choice or descriptor. Selected is shown by a check mark and the aria-pressed state, not by colour alone. */
export function Chip({ selected = false, onToggle, tone, className, children, ...rest }: ChipProps) {
  const classes = joinClass("chip", className);
  const content = <>{tone && <span className="tone-mark" data-tone={tone} aria-hidden="true" />}<span className="chip-text">{children}</span></>;
  if (!onToggle) return <span {...(rest as HTMLAttributes<HTMLSpanElement>)} className={classes} data-selected={selected ? "true" : undefined}>{content}</span>;
  return <button {...rest} type="button" className={classes} aria-pressed={selected} data-selected={selected ? "true" : undefined} onClick={(event) => { rest.onClick?.(event); if (!event.defaultPrevented) onToggle(!selected); }}>{content}</button>;
}

export interface ChipGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Names the group for assistive technology. */
  label: string;
}

/** A wrapping row of chips with a group name. */
export function ChipGroup({ label, className, children, ...rest }: ChipGroupProps) {
  return <div {...rest} role="group" aria-label={label} className={joinClass("chip-group", className)}>{children}</div>;
}
