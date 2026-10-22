import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Parity evidence (R02, A33): every action in the shared capability catalog is reachable from a
// desktop control, marked with its catalog id in a `data-capability` attribute. A control that
// triggers several reads carries several ids separated by spaces.
interface Capability { id: string; desktop: string; client_method: string }
const root = new URL("./", import.meta.url);
const catalog = JSON.parse(readFileSync(new URL("../../../schemas/capability-catalog.json", root), "utf8")) as { capabilities: Capability[] };
const sources = readdirSync(root, { recursive: true })
  .map((file) => file.replaceAll("\\", "/"))
  .filter((file) => file.endsWith(".tsx") && !file.includes(".test."))
  .map((file) => [file, readFileSync(new URL(file, root), "latin1")] as const);
const exposed = new Map<string, string[]>();
for (const [file, source] of sources) {
  for (const match of source.matchAll(/data-capability="([^"]+)"/g)) {
    for (const id of match[1].split(/\s+/).filter(Boolean)) exposed.set(id, [...(exposed.get(id) ?? []), file]);
  }
}

test("every cataloged action is exposed by a desktop control carrying its id", () => {
  const missing = catalog.capabilities.filter((capability) => !exposed.has(capability.desktop)).map((capability) => capability.id);
  expect(missing).toEqual([]);
});

test("every data-capability value on the desktop is a cataloged action", () => {
  const ids = new Set(catalog.capabilities.map((capability) => capability.desktop));
  const unknown = [...exposed].filter(([id]) => !ids.has(id)).map(([id, files]) => `${id} in ${files.join(", ")}`);
  expect(unknown).toEqual([]);
});

test("the desktop calls each cataloged client method it exposes directly, or the catalog says how it reaches the action", () => {
  const indirect = new Set(["plan", "followEvents"]);
  const code = sources.map(([, source]) => source).join("\n");
  for (const capability of catalog.capabilities) {
    if (indirect.has(capability.client_method)) continue;
    expect(code, `${capability.id} should call client.${capability.client_method}`).toMatch(new RegExp(`\\.${capability.client_method}\\(`));
  }
});
