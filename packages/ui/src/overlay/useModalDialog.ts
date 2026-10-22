import { useEffect, useRef } from "react";
import type { RefObject, SyntheticEvent } from "react";
import { cancelOutcome, focusInitial, restoreOpener, syncDialog } from "./modalState";

/**
 * Drives a native <dialog> from an `open` prop. showModal gives the focus trap and inert background; Esc arrives as
 * the cancel event and is routed to `onClose`, never closed by the browser itself. Focus returns to the opener.
 */
export function useModalDialog(open: boolean, onClose: () => void, initialFocus?: RefObject<HTMLElement | null>) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<unknown>(null);
  const isOpen = useRef(open);
  isOpen.current = open;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) opener.current = document.activeElement;
    const changed = syncDialog(dialog, open);
    if (!changed) return;
    if (open) focusInitial(initialFocus?.current);
    else if (restoreOpener(opener.current)) opener.current = null;
  }, [open, initialFocus]);

  // A dialog removed while open must not leave the page inert behind it.
  useEffect(() => () => { if (ref.current?.open) syncDialog(ref.current, false); }, []);

  return {
    ref,
    onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault();
      if (cancelOutcome(isOpen.current) === "request-close") onClose();
    },
    // A <form method="dialog"> inside can close the element itself; tell the owner so state stays true.
    onClose: () => { if (isOpen.current) onClose(); },
  };
}
