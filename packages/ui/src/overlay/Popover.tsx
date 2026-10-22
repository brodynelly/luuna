import { useCallback, useId, useRef, useState } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import type { Placement } from "./placement";
import { useFloatingPanel } from "./useFloatingPanel";

export interface PopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Content of the button that toggles the panel. */
  trigger: ReactNode;
  /** The panel's accessible name. */
  label: string;
  placement?: Placement;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

/**
 * A non-modal panel beside its trigger: it does not trap focus or inert the page. The panel follows the trigger in
 * the DOM, so Tab walks into it; Escape and a press outside close it, and Escape returns focus to the trigger.
 * Placement flips at the viewport edge (placement.ts). Rest props land on the wrapper.
 */
export function Popover({ trigger, label, placement = "bottom-start", onOpenChange, children, className, ...rest }: PopoverProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const change = useCallback((next: boolean) => { setOpen(next); onOpenChange?.(next); }, [onOpenChange]);
  const close = useCallback(() => change(false), [change]);
  useFloatingPanel({ open, onClose: close, anchor, panel, placement });
  return <div className={["ov-anchor", className].filter(Boolean).join(" ")} {...rest}>
    <button ref={anchor} type="button" aria-expanded={open} aria-controls={open ? `${id}-panel` : undefined} aria-haspopup="true" onClick={() => change(!open)}>{trigger}</button>
    {open && <div ref={panel} id={`${id}-panel`} className="ov-popover" role="group" aria-label={label}>{children}</div>}
  </div>;
}
