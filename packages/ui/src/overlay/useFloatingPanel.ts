import { useEffect, useLayoutEffect } from "react";
import type { RefObject } from "react";
import { applyPlacement } from "./floating";
import type { Placement } from "./placement";

interface FloatingPanel {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  panel: RefObject<HTMLElement | null>;
  placement: Placement;
}

/**
 * Non-modal panel behaviour shared by Popover and Menu: position beside the anchor (flipping at the viewport edge),
 * reposition on resize and scroll, close on Escape (focus returns to the anchor) and on a press outside both.
 */
export function useFloatingPanel({ open, onClose, anchor, panel, placement }: FloatingPanel): void {
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (anchor.current && panel.current) applyPlacement(anchor.current, panel.current, { width: window.innerWidth, height: window.innerHeight }, placement);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, anchor, panel, placement]);

  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Prevented so an enclosing native dialog does not also take this Escape as its own cancel.
      event.preventDefault();
      onClose();
      anchor.current?.focus();
    };
    const press = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (anchor.current?.contains(target) || panel.current?.contains(target))) return;
      onClose();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", press);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", press); };
  }, [open, onClose, anchor, panel]);
}
