import type { ReactElement } from "react";
import { Button } from "../controls";
import type { ButtonProps } from "../controls";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";
import type { Tone } from "../tone/tone";
import { joinClass } from "./identity";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "aria-label"> {
  /** A library icon name, or an svg element. Always decorative: the label names the button. */
  icon: IconName | ReactElement;
  /** The accessible name. Required: an icon alone names nothing. */
  label: string;
  /** Adds a tone shape mark; the label carries the words. */
  tone?: Tone;
}

/** A square button with an icon and no visible text. Quiet by default; the target is at least the 28 px compact control. */
export function IconButton({ icon, label, tone, variant = "quiet", className, ...rest }: IconButtonProps) {
  return (
    <Button {...rest} variant={variant} className={joinClass("icon-button", className)} aria-label={label}>
      {typeof icon === "string" ? <Icon name={icon} /> : icon}
      {tone && <span className="tone-mark" data-tone={tone} aria-hidden="true" />}
    </Button>
  );
}
