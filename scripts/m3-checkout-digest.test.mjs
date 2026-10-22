import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathsDigest } from "./m3-checkout-digest.mjs";

test("collapsed ignored parents still exclude nested build/dependency outputs only", () => {
  const root = mkdtempSync(path.join(tmpdir(), "luuna-digest-"));
  try {
    const write = (file, text) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text); };
    write(".tools/bun/node_modules/tool.js", "before");
    write(".tools/fixture/target/output", "before");
    write(".tools/fixture/dist/output", "before");
    write(".tools/config.json", "before");
    const options = { excludeBuildOutputs: true };
    const before = pathsDigest(root, [".tools"], options);
    for (const file of [".tools/bun/node_modules/tool.js", ".tools/fixture/target/output", ".tools/fixture/dist/output"]) write(file, "after");
    assert.equal(pathsDigest(root, [".tools"], options), before);
    write(".tools/config.json", "after");
    assert.notEqual(pathsDigest(root, [".tools"], options), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("metadata and fixture digests retain every path by default", () => {
  const root = mkdtempSync(path.join(tmpdir(), "luuna-digest-all-"));
  try {
    mkdirSync(path.join(root, "node_modules"));
    const file = path.join(root, "node_modules", "probe");
    writeFileSync(file, "before");
    const before = pathsDigest(root, ["node_modules"]);
    writeFileSync(file, "after");
    assert.notEqual(pathsDigest(root, ["node_modules"]), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
