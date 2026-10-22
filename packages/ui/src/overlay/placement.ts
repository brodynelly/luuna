// DOM-free placement math for floating panels (Popover, Menu, Tooltip). Pure numbers in, numbers out, so the
// flip and clamp rules are unit-tested without a browser. Coordinates are viewport coordinates.

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";
export type Placement = Side | `${Side}-start` | `${Side}-end`;

export interface Rect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }
export interface PlacementInput {
  anchor: Rect;
  floating: Size;
  viewport: Size;
  placement?: Placement;
  /** Gap between the anchor and the panel. */
  offset?: number;
  /** Space kept free at every viewport edge. */
  margin?: number;
}
export interface PlacementResult { x: number; y: number; placement: Placement }

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
const vertical = (side: Side) => side === "top" || side === "bottom";

export function parsePlacement(placement: Placement): { side: Side; align: Align } {
  const [side, align] = placement.split("-") as [Side, Align | undefined];
  return { side, align: align ?? "center" };
}

function compose(side: Side, align: Align): Placement {
  return align === "center" ? side : `${side}-${align}`;
}

/** Free space on one side of the anchor, after the gap and the viewport margin. */
function room(side: Side, anchor: Rect, viewport: Size, offset: number, margin: number): number {
  if (side === "top") return anchor.y - offset - margin;
  if (side === "bottom") return viewport.height - (anchor.y + anchor.height) - offset - margin;
  if (side === "left") return anchor.x - offset - margin;
  return viewport.width - (anchor.x + anchor.width) - offset - margin;
}

function along(side: Side, anchor: Rect, floating: Size, offset: number): number {
  if (side === "top") return anchor.y - floating.height - offset;
  if (side === "bottom") return anchor.y + anchor.height + offset;
  if (side === "left") return anchor.x - floating.width - offset;
  return anchor.x + anchor.width + offset;
}

function across(side: Side, align: Align, anchor: Rect, floating: Size): number {
  const start = vertical(side) ? anchor.x : anchor.y;
  const span = vertical(side) ? anchor.width : anchor.height;
  const size = vertical(side) ? floating.width : floating.height;
  if (align === "start") return start;
  if (align === "end") return start + span - size;
  return start + (span - size) / 2;
}

/** Keeps a panel inside [margin, limit - size - margin]; a panel larger than the viewport sticks to the start edge. */
export function clamp(value: number, size: number, limit: number, margin: number): number {
  return Math.max(margin, Math.min(value, limit - size - margin));
}

/** The side that fits the panel: the preferred one, else the opposite one, else whichever has more room. */
export function chooseSide(side: Side, anchor: Rect, floating: Size, viewport: Size, offset: number, margin: number): Side {
  const need = vertical(side) ? floating.height : floating.width;
  const preferred = room(side, anchor, viewport, offset, margin);
  if (preferred >= need) return side;
  const opposite = room(OPPOSITE[side], anchor, viewport, offset, margin);
  if (opposite >= need) return OPPOSITE[side];
  return opposite > preferred ? OPPOSITE[side] : side;
}

export function placeFloating({ anchor, floating, viewport, placement = "bottom-start", offset = 4, margin = 8 }: PlacementInput): PlacementResult {
  const wanted = parsePlacement(placement);
  const side = chooseSide(wanted.side, anchor, floating, viewport, offset, margin);
  const main = along(side, anchor, floating, offset);
  const cross = across(side, wanted.align, anchor, floating);
  const x = vertical(side) ? cross : main;
  const y = vertical(side) ? main : cross;
  return { x: clamp(x, floating.width, viewport.width, margin), y: clamp(y, floating.height, viewport.height, margin), placement: compose(side, wanted.align) };
}
