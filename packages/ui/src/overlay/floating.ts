import { placeFloating } from "./placement";
import type { Placement, PlacementResult, Size } from "./placement";

// The thin DOM edge of placement.ts. It takes anything shaped like an element, so tests pass plain objects.
// The position goes out as two custom properties (--float-x, --float-y) that overlay.css reads, never as an inline style.

export interface AnchorLike { getBoundingClientRect(): { left: number; top: number; width: number; height: number } }
export interface FloatingLike {
  offsetWidth: number;
  offsetHeight: number;
  style: { setProperty(name: string, value: string): void };
  setAttribute(name: string, value: string): void;
}

export function applyPlacement(anchor: AnchorLike, floating: FloatingLike, viewport: Size, placement: Placement, offset?: number): PlacementResult {
  const box = anchor.getBoundingClientRect();
  // offsetWidth and offsetHeight, not a bounding rect: an entrance animation may be scaling the panel.
  const result = placeFloating({ anchor: { x: box.left, y: box.top, width: box.width, height: box.height }, floating: { width: floating.offsetWidth, height: floating.offsetHeight }, viewport, placement, offset });
  floating.style.setProperty("--float-x", `${result.x}px`);
  floating.style.setProperty("--float-y", `${result.y}px`);
  floating.setAttribute("data-placement", result.placement);
  return result;
}
