import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { HTMLAttributes, ReactElement } from "react";
import { applyPlacement } from "./floating";
import type { Placement } from "./placement";
import { HIDDEN, canHover, focusShowsTooltip, isVisible } from "./tooltipGate";

export interface TooltipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** A short name or hint. Never essential information: touch users and many screen-reader paths never see it. */
  label: string;
  placement?: Placement;
  /** One focusable control (an icon-only button, a truncated name). It gains aria-describedby. */
  children: ReactElement<{ "aria-describedby"?: string }>;
}

/**
 * A supplementary hint. It shows on keyboard focus and on hover for a fine pointer that can hover, describes the control
 * through aria-describedby, and Escape dismisses it (without also closing a dialog around it). The tooltip element is always
 * in the DOM so the description resolves, and is hidden until shown. No delay, no exit animation, one entrance fade.
 */
export function Tooltip({ label, placement = "top", children, className, ...rest }: TooltipProps) {
  const id = useId();
  const [state, setState] = useState(HIDDEN);
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const visible = isVisible(state);

  useLayoutEffect(() => {
    if (visible && anchor.current && tip.current) applyPlacement(anchor.current, tip.current, { width: window.innerWidth, height: window.innerHeight }, placement);
  }, [visible, placement]);

  useEffect(() => {
    if (!visible) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setState(HIDDEN);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [visible]);

  const described = [children.props["aria-describedby"], `${id}-tip`].filter(Boolean).join(" ");
  return <span ref={anchor} className={["ov-tooltip-anchor", className].filter(Boolean).join(" ")} {...rest}
    onMouseEnter={() => { if (canHover(window)) setState((current) => ({ ...current, hover: true })); }}
    onMouseLeave={() => setState((current) => ({ ...current, hover: false }))}
    onFocus={(event) => { if (focusShowsTooltip(event.target)) setState((current) => ({ ...current, focus: true })); }}
    onBlur={() => setState((current) => ({ ...current, focus: false }))}>
    {cloneElement(children, { "aria-describedby": described })}
    <span ref={tip} id={`${id}-tip`} className="ov-tooltip" role="tooltip" hidden={!visible}>{label}</span>
  </span>;
}
