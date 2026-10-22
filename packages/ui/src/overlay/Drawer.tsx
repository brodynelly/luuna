import { useId } from "react";
import type { DialogHTMLAttributes, ReactNode, RefObject } from "react";
import { useModalDialog } from "./useModalDialog";

export interface DrawerProps extends Omit<DialogHTMLAttributes<HTMLDialogElement>, "open" | "title" | "onClose" | "children"> {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  side?: "right" | "left";
  initialFocus?: RefObject<HTMLElement | null>;
  children?: ReactNode;
}

/**
 * A modal panel pinned to one window edge, on the same native <dialog> as Dialog: focus trap, Escape asks the owner to
 * close, focus returns to the opener, no exit animation. The Close button is always present, so the drawer can be left by keyboard and pointer.
 */
export function Drawer({ open, onClose, title, side = "right", initialFocus, children, className, ...rest }: DrawerProps) {
  const id = useId();
  const modal = useModalDialog(open, onClose, initialFocus);
  return <dialog ref={modal.ref} className={["ov-drawer", className].filter(Boolean).join(" ")} data-side={side} aria-labelledby={`${id}-title`}
    onCancel={modal.onCancel} onClose={modal.onClose} {...rest}>
    <div className="ov-drawer-header">
      <p className="ov-dialog-title" id={`${id}-title`}>{title}</p>
      <button type="button" className="quiet" onClick={onClose}>Close</button>
    </div>
    <div className="ov-drawer-body">{children}</div>
  </dialog>;
}
