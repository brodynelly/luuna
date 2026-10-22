// The shared capability catalog (schemas/capability-catalog.json): one entry per product action
// the clients expose. The TUI derives its command names and its interactive menus from it, so a
// new action is one catalog entry plus one command in commands.mjs.
import { readFileSync } from "node:fs";

const url = new URL("../../../schemas/capability-catalog.json", import.meta.url);

/** @returns {{ capabilities: Array<{ id: string; title: string; method: string; route: string; client_method: string; desktop: string; tui: string; failure_modes: string[]; acknowledgment?: string; desktop_note?: string }> }} */
export function loadCatalog() {
  return JSON.parse(readFileSync(url, "utf8"));
}

export const catalog = loadCatalog();
export const capabilitiesById = new Map(catalog.capabilities.map((capability) => [capability.id, capability]));
