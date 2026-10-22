import { useRef } from "react";
import type { ReactNode } from "react";
import { Dialog } from "./Dialog";
import type { DialogProps } from "./Dialog";

export interface ConfirmDialogProps extends Omit<DialogProps, "actions" | "description" | "initialFocus" | "children"> {
  /** The exact consequence of confirming, in plain words. It is the dialog's description. */
  consequence: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Runs the action. The dialog stays open: the owner closes it once the runtime has answered. */
  onConfirm: () => void;
}

/**
 * A Dialog that asks before something irreversible or authority-bearing. Focus starts on the safe action (cancel), so a stray
 * Enter never confirms; the danger tone (the default) gives the confirm button the danger style.
 * Plain buttons carrying the Button classes, because Button does not forward a ref for the initial focus.
 */
export function ConfirmDialog({ consequence, confirmLabel, cancelLabel = "Cancel", onConfirm, onClose, tone = "danger", ...rest }: ConfirmDialogProps) {
  const safe = useRef<HTMLButtonElement>(null);
  return <Dialog {...rest} tone={tone} onClose={onClose} description={consequence} initialFocus={safe}
    actions={<>
      <button ref={safe} type="button" onClick={onClose}>{cancelLabel}</button>
      <button type="button" className={tone === "danger" ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</button>
    </>} />;
}
