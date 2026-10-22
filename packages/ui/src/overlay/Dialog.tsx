import { useId } from "react";
import type { DialogHTMLAttributes, ReactNode, RefObject } from "react";
import { useModalDialog } from "./useModalDialog";

export interface DialogProps extends Omit<DialogHTMLAttributes<HTMLDialogElement>, "open" | "title" | "onClose" | "children"> {
  open: boolean;
  /** Asked for on Escape (the native cancel event). The owner sets `open` to false; the dialog never closes itself. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** `danger` adds the danger shape mark beside the title; the caller still supplies a danger button and the consequence text. */
  tone?: "neutral" | "danger";
  /** The controls that decide the dialog, in reading order. */
  actions: ReactNode;
  /** Control focused when the dialog opens; without it the platform focuses the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
  children?: ReactNode;
}

/**
 * A modal dialog on the native <dialog>: showModal supplies the focus trap and the inert page, Escape asks the owner
 * to close, and focus returns to the opener. It never opens on load (the owner sets `open` after an action), it has no
 * exit animation, and a press on the backdrop does not close it: approval and evidence decisions are never dismissed by accident.
 */
export function Dialog({ open, onClose, title, description, tone = "neutral", actions, initialFocus, children, className, ...rest }: DialogProps) {
  const id = useId();
  const modal = useModalDialog(open, onClose, initialFocus);
  return <dialog ref={modal.ref} className={["ov-dialog", className].filter(Boolean).join(" ")} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined}
    onCancel={modal.onCancel} onClose={modal.onClose} {...rest}>
    <p className="ov-dialog-title" id={`${id}-title`}>
      {tone === "danger" && <span className="tone-mark" data-tone="danger" aria-hidden="true" />}
      {title}
    </p>
    {description && <p className="ov-dialog-description" id={`${id}-description`}>{description}</p>}
    {children && <div className="ov-dialog-body">{children}</div>}
    <div className="ov-dialog-actions">{actions}</div>
  </dialog>;
}
