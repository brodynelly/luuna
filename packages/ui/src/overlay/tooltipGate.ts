// DOM-free rules for when a Tooltip may appear. Hover is offered only to a fine pointer that can hover (a touch screen
// has no hover, so nothing may depend on it); keyboard focus always works, but a mouse click that focuses a control
// does not pop the tooltip.

export const HOVER_QUERY = "(hover: hover) and (pointer: fine)";

export interface MediaSource { matchMedia?: (query: string) => { matches: boolean } }

export function canHover(source: MediaSource | undefined): boolean {
  if (!source || typeof source.matchMedia !== "function") return false;
  return source.matchMedia(HOVER_QUERY).matches;
}

export interface MatchesLike { matches?: (selector: string) => boolean }

/** Keyboard focus shows the tooltip; engines without :focus-visible are treated as keyboard focus. */
export function focusShowsTooltip(target: MatchesLike): boolean {
  if (typeof target.matches !== "function") return true;
  try { return target.matches(":focus-visible"); } catch { return true; }
}

export interface TipState { hover: boolean; focus: boolean }
export const HIDDEN: TipState = { hover: false, focus: false };

export const isVisible = (state: TipState): boolean => state.hover || state.focus;
