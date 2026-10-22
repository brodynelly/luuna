/** Small DOM-free decisions behind the form controls. */

/** What a key does in a search field: Esc clears a non-empty query, Enter submits. Anything else is the browser's. */
export function searchKeyAction(key: string, value: string): "clear" | "submit" | null {
  if (key === "Escape" && value !== "") return "clear";
  if (key === "Enter") return "submit";
  return null;
}

/** The number typed in a number field, or null when it is empty or not a finite number. */
export function parseNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Whether a number lies outside the optional bounds. An empty value is never out of range. */
export function outOfRange(value: number | null, min?: number, max?: number): boolean {
  if (value === null) return false;
  return (min !== undefined && value < min) || (max !== undefined && value > max);
}

export type CopyStatus = "idle" | "copied" | "failed";

/** Runs the injected copy function; a throw or rejection is a failed copy, never an unhandled error. */
export async function copyOutcome(copy: (value: string) => void | Promise<void>, value: string): Promise<CopyStatus> {
  try { await copy(value); return "copied"; } catch { return "failed"; }
}
