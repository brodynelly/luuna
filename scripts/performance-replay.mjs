// Synthetic CPU benchmark. No provider, private history or running service access.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import ts from "typescript";

const source = readFileSync(new URL("../packages/api-client/src/index.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { EventReplay, mergeEvents } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
const events = Array.from({ length: 10_000 }, (_, index) => ({
  sequence: index + 1, event_id: `event-${index + 1}`, run_id: "fixture",
  payload: { assistantMessageEvent: { type: "text_delta", delta: "Synthetic text " } },
}));
const pages = Array.from({ length: 100 }, (_, index) => events.slice(index * 100, (index + 1) * 100));
function original() {
  let records = [];
  for (const page of pages) records = mergeEvents(records, page);
  for (let index = 0; index < 100; index++) records = mergeEvents(records, []);
  return records;
}
function incremental() {
  const replay = new EventReplay();
  for (const page of pages) replay.append(page);
  let records;
  for (let index = 0; index < 100; index++) records = replay.append([]);
  return records;
}
assert.deepEqual(original(), incremental());
function median(fn) {
  const samples = [];
  for (let index = 0; index < 9; index++) {
    const start = performance.now();
    assert.equal(fn().length, 10_000);
    samples.push(performance.now() - start);
  }
  return samples.sort((a, b) => a - b)[4];
}
const before = median(original);
const after = median(incremental);
console.log(JSON.stringify({ fixture: "10000 events in 100 pages, then 100 empty polls; 9 warmed samples", original_median_ms: before, incremental_median_ms: after, speedup: before / after }, null, 2));
