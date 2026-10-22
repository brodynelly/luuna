// DOM-free glue for the native <dialog>. jsdom and older WebViews do not implement showModal faithfully, so every
// call is guarded and falls back to the open attribute. Real-WebView behaviour is verified in the app, not here.

export interface DialogLike {
  open: boolean;
  showModal?: () => void;
  close?: () => void;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}
export interface Focusable { focus(): void }

/** Opens as a modal, or closes, only when the element is not already in the wanted state. Returns whether it changed. */
export function syncDialog(dialog: DialogLike, wantOpen: boolean): boolean {
  if (wantOpen === dialog.open) return false;
  if (wantOpen) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  } else if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
  return true;
}

/** Focus goes to the requested control, else stays where showModal put it (the first focusable). */
export function focusInitial(target: Focusable | null | undefined): boolean {
  if (!target) return false;
  target.focus();
  return true;
}

/** Closing returns focus to whatever opened the dialog, if it still takes focus. */
export function restoreOpener(opener: unknown): boolean {
  if (typeof opener !== "object" || opener === null || typeof (opener as Focusable).focus !== "function") return false;
  (opener as Focusable).focus();
  return true;
}

/** The native cancel event (Esc) asks to close; the owner decides, so the browser's own close is prevented. */
export function cancelOutcome(stillOpen: boolean): "request-close" | "ignore" {
  return stillOpen ? "request-close" : "ignore";
}
