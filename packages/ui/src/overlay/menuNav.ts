// DOM-free keyboard rules for Menu: roving focus, Home/End, type-ahead and the close keys. The component only
// forwards key events here and applies the returned action. Disabled items are skipped by every rule.

export interface NavEntry { label: string; disabled?: boolean }
export type MoveKey = "ArrowDown" | "ArrowUp" | "Home" | "End";
export interface TypeAhead { text: string; at: number }
export const TYPE_AHEAD_MS = 500;
export const EMPTY_AHEAD: TypeAhead = { text: "", at: 0 };

export type MenuAction =
  | { type: "focus"; index: number }
  | { type: "close"; preventDefault: boolean }
  | { type: "none" };

export function enabledIndexes(items: readonly NavEntry[]): number[] {
  return items.flatMap((item, index) => (item.disabled ? [] : [index]));
}

/** Arrow keys wrap; from nothing, Down lands on the first item and Up on the last. Returns -1 when nothing is enabled. */
export function moveIndex(items: readonly NavEntry[], current: number, key: MoveKey): number {
  const enabled = enabledIndexes(items);
  if (enabled.length === 0) return -1;
  if (key === "Home") return enabled[0];
  if (key === "End") return enabled[enabled.length - 1];
  const position = enabled.indexOf(current);
  if (key === "ArrowDown") return enabled[position < 0 ? 0 : (position + 1) % enabled.length];
  return enabled[position < 0 ? enabled.length - 1 : (position - 1 + enabled.length) % enabled.length];
}

export interface KeyLike { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }

/** One printable character with no command modifier. A space only counts while a search is already under way. */
export function isTypeAheadKey(event: KeyLike, searching: boolean): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return false;
  return event.key !== " " || searching;
}

export function nextTypeAhead(previous: TypeAhead, key: string, now: number): TypeAhead {
  const fresh = now - previous.at > TYPE_AHEAD_MS;
  return { text: (fresh ? "" : previous.text) + key.toLowerCase(), at: now };
}

/**
 * The item a search lands on. Repeating one letter cycles through the items that start with it, starting after
 * the current one; a longer string matches from the current item onward, so "ab" stays on "abc". Wraps; -1 for none.
 */
export function findTypeAhead(items: readonly NavEntry[], current: number, text: string): number {
  if (!text) return -1;
  const cycling = [...text].every((char) => char === text[0]);
  const query = cycling ? text[0] : text;
  const start = cycling ? current + 1 : Math.max(current, 0);
  for (let step = 0; step < items.length; step++) {
    const index = (start + step) % items.length;
    if (!items[index].disabled && items[index].label.toLowerCase().startsWith(query)) return index;
  }
  return -1;
}

export interface MenuKeyResult { action: MenuAction; ahead: TypeAhead }

export function menuKeyAction(items: readonly NavEntry[], current: number, event: KeyLike, ahead: TypeAhead, now: number): MenuKeyResult {
  const key = event.key;
  if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
    const index = moveIndex(items, current, key);
    return { action: index < 0 ? { type: "none" } : { type: "focus", index }, ahead: EMPTY_AHEAD };
  }
  // Escape is handled here; Tab closes without cancelling, so focus moves on from the trigger.
  if (key === "Escape") return { action: { type: "close", preventDefault: true }, ahead: EMPTY_AHEAD };
  if (key === "Tab") return { action: { type: "close", preventDefault: false }, ahead: EMPTY_AHEAD };
  const searching = ahead.text !== "" && now - ahead.at <= TYPE_AHEAD_MS;
  if (isTypeAheadKey(event, searching)) {
    const next = nextTypeAhead(ahead, key, now);
    const index = findTypeAhead(items, current, next.text);
    return { action: index < 0 ? { type: "none" } : { type: "focus", index }, ahead: next };
  }
  return { action: { type: "none" }, ahead };
}

export type TriggerOpen = "first" | "last";

/** Down opens on the first item and Up on the last; Enter and Space open through the button's own click. */
export function triggerOpenKey(key: string): TriggerOpen | null {
  if (key === "ArrowDown") return "first";
  if (key === "ArrowUp") return "last";
  return null;
}
