// Unit tests for the Luuna scope guard's decision logic; no Pi process involved.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, toNamespacedPath } from "node:path";
import { test } from "node:test";
import { decide, realize } from "../../../crates/luuna-engine-pi/assets/luuna-scope-guard.js";

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "luuna-scope-guard-"));
  const root = join(base, "worktree");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(base, "outside"), { recursive: true });
  writeFileSync(join(root, "src", "main.py"), "print('x')\n");
  writeFileSync(join(base, "outside", "secret.txt"), "nope\n");
  symlinkSync(join(base, "outside"), join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
  return { base, root, scope: { root, paths: ["src"], operations: ["read", "write"] } };
}

test("writes stay inside the worktree and the task paths", () => {
  const { root, scope } = fixture();
  assert.equal(decide("write", { path: "src/main.py" }, root, scope), null);
  assert.equal(decide("edit", { path: join(root, "src", "new.py") }, root, scope), null);
  assert.match(decide("write", { path: "README.md" }, root, scope), /outside the approved task paths/);
  assert.match(decide("write", { path: "../outside/secret.txt" }, root, scope), /outside the leased worktree/);
  assert.match(decide("write", { path: "/etc/hosts" }, root, scope), /outside the leased worktree/);
  assert.match(decide("write", { path: "escape/secret.txt" }, root, scope), /outside the leased worktree/);
  assert.match(decide("write", { path: "src/../../outside/x" }, root, scope), /outside the leased worktree/);
});

test("reads may inspect the worktree but never beyond it", () => {
  const { root, scope } = fixture();
  assert.equal(decide("read", { path: "README.md" }, root, scope), null);
  assert.equal(decide("ls", {}, root, scope), null);
  assert.match(decide("read", { path: "escape/secret.txt" }, root, scope), /outside the leased worktree/);
  assert.match(decide("grep", { path: "/" }, root, scope), /outside the leased worktree/);
});

test("undeclared tools and missing operations are blocked", () => {
  const { root, scope } = fixture();
  assert.match(decide("bash", { command: "ls" }, root, scope), /not part of the approved writer profile/);
  assert.match(decide("write", { path: "src/main.py" }, root, { ...scope, operations: ["read"] }), /needs the write operation/);
  assert.match(decide("read", { path: "src/main.py" }, root, { ...scope, operations: ["write"] }), /needs the read operation/);
  assert.match(decide("read", { path: "src/main.py" }, root, null), /not configured/);
});

test("realize follows symlinks in the existing prefix and keeps the missing tail", () => {
  const { base, root } = fixture();
  assert.equal(realize(join(root, "escape", "deep", "file.txt")), realize(join(base, "outside", "deep", "file.txt")));
});

test("independent reviewer can inspect candidate files but cannot mutate them", () => {
  const { root, scope } = fixture();
  const reviewer = { ...scope, operations: ["read"] };
  for (const tool of ["read", "grep", "find", "ls"]) {
    assert.equal(decide(tool, { path: "src" }, root, reviewer), null);
    assert.match(decide(tool, { path: "escape/secret.txt" }, root, reviewer), /outside the leased worktree/);
  }
  for (const tool of ["write", "edit"]) {
    assert.match(decide(tool, { path: "src/main.py" }, root, reviewer), /needs the write operation/);
  }
  assert.match(decide("bash", { command: "touch src/x" }, root, reviewer), /not part of the approved/);
});

test("Windows canonical scope and ordinary Pi cwd refer to the same worktree", { skip: process.platform !== "win32" }, () => {
  const { root, scope } = fixture();
  const canonical = toNamespacedPath(root);
  for (const [scopeRoot, cwd] of [[canonical, root], [root, canonical]]) {
    const reviewer = { ...scope, root: scopeRoot, operations: ["read"] };
    assert.equal(decide("read", { path: "src/main.py" }, cwd, reviewer), null);
    assert.match(decide("read", { path: "escape/secret.txt" }, cwd, reviewer), /outside the leased worktree/);
    assert.match(decide("read", { path: toNamespacedPath(join(root, "escape", "missing", "secret.txt")) }, cwd, reviewer), /outside the leased worktree/);
    assert.match(decide("write", { path: "src/main.py" }, cwd, reviewer), /needs the write operation/);
  }
});
