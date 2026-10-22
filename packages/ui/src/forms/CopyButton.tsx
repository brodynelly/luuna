import { useEffect, useState } from "react";
import type { FocusEvent, ReactNode } from "react";
import { Button } from "../controls";
import type { ButtonProps } from "../controls";
import { joinClass } from "./identity";
import { copyOutcome } from "./logic";
import type { CopyStatus } from "./logic";

export interface CopyButtonProps extends Omit<ButtonProps, "children" | "onClick" | "submit"> {
  /** The text to copy. Never logged or written to an attribute. */
  value: string;
  /** The button's visible text, for example "Copy commit". */
  label: ReactNode;
  /** Injected so the platform decides how to copy (clipboard API, Tauri, a test double). */
  copy: (value: string) => void | Promise<void>;
  copiedText?: string;
  failedText?: string;
}

/** Copies a value through the injected `copy`. The result is plain status text that stays until focus leaves or the value changes. */
export function CopyButton({ value, label, copy, copiedText = "Copied", failedText = "Could not copy", className, onBlur, ...rest }: CopyButtonProps) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  useEffect(() => setStatus("idle"), [value]);
  const text = status === "copied" ? copiedText : status === "failed" ? failedText : "";
  return (
    <span className={joinClass("copy-button", className)}>
      <Button {...rest} onClick={() => { void copyOutcome(copy, value).then(setStatus); }} onBlur={(event: FocusEvent<HTMLButtonElement>) => { onBlur?.(event); setStatus("idle"); }}>{label}</Button>
      <span className="copy-status" role="status" data-copy={status === "failed" ? "error" : undefined}>{status === "failed" && <span className="tone-mark" data-tone="danger" aria-hidden="true" />}{text}</span>
    </span>
  );
}
