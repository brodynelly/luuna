import type { HTMLAttributes, ReactNode } from "react";
import type { Tone } from "../tone/tone";

interface AlertBase extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "role" | "children"> {
  title?: ReactNode;
  children: ReactNode;
  /**
   * How assistive technology hears it. Default: danger is `alert`, every other tone `status`. `"status"` renders a
   * status region with no Dismiss for any tone, for a blocker that is information, not an interruption.
   */
  announce?: "alert" | "status";
}
/** A danger alert always carries Dismiss (the repo lint), so its handler is required; other tones may offer one. */
export type AlertProps = AlertBase & (
  | { tone: "danger"; announce?: "alert"; onDismiss: () => void }
  | { tone?: Tone; announce: "status"; onDismiss?: () => void }
  | { tone?: Exclude<Tone, "danger">; announce?: undefined; onDismiss?: () => void }
  | { tone: Exclude<Tone, "danger">; announce: "alert"; onDismiss: () => void }
);

/**
 * An inline message in one of the six tones: colour (the tone ground), a shape mark and the caller's text, never colour
 * alone. Danger is an alert region and always has Dismiss; every other tone is a status region, with Dismiss only when asked.
 * `announce="status"` makes any tone a status region with Dismiss only when asked (information, not an interruption).
 * No coloured edge. It replaces Callout and ErrorBanner for new inline messages; those stay for existing screens.
 */
export function Alert({ tone = "neutral", announce, title, children, onDismiss, className, ...rest }: AlertProps) {
  const classes = ["ov-alert", className].filter(Boolean).join(" ");
  const mark = <span className="tone-mark" data-tone={tone} aria-hidden="true" />;
  const content = <section className="ov-alert-content">
    {title && <strong className="ov-alert-title">{title}</strong>}
    <section className="ov-alert-text">{children}</section>
  </section>;
  const alert = announce === "status" ? false : announce === "alert" || tone === "danger";
  if (alert) return <div {...rest} className={classes} data-tone={tone} role="alert">{mark}{content}<button className="text-button" type="button" onClick={onDismiss}>Dismiss</button></div>;
  return <div {...rest} className={classes} data-tone={tone} role="status">{mark}{content}{onDismiss && <button className="text-button" type="button" onClick={onDismiss}>Dismiss</button>}</div>;
}
