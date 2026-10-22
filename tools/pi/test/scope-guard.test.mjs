// Unit tests for the Luuna scope guard's decision logic; no Pi process involved.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, toNamespacedPath } from "node:path";
import { test } from "node:test";
import {
  decide,
  isRepositoryMetadata,
  realize,
  toolPath,
  windowsShellPath,
} from "../../../crates/luuna-engine-pi/assets/luuna-scope-guard.js";

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

test("repository metadata is never a tool target, even with whole-repository scope", () => {
  const { root, scope } = fixture();
  writeFileSync(join(root, ".git"), "gitdir: /elsewhere/.git/worktrees/app\n");
  const whole = { ...scope, paths: ["."] };
  for (const path of [".git", ".GIT", ".git.", ".git ", "git~1", "Git~1/config", "src/.git/hooks/pre-commit", "src/.Git", join(root, ".git")]) {
    for (const tool of ["write", "edit", "read", "ls"]) {
      assert.match(decide(tool, { path }, root, whole), /repository metadata/, `${tool} ${path}`);
    }
  }
  if (process.platform !== "win32") {
    // A link whose target is the gitfile is metadata too.
    symlinkSync(join(root, ".git"), join(root, "src", "meta"));
    assert.match(decide("read", { path: "src/meta" }, root, whole), /repository metadata/);
    assert.match(decide("write", { path: "src/meta" }, root, whole), /repository metadata/);
  }
  for (const ordinary of [".gitignore", ".github/workflows/ci.yml", ".gitattributes", "src/a.git"]) {
    assert.equal(decide("write", { path: ordinary }, root, whole), null, ordinary);
  }
  assert.equal(isRepositoryMetadata(".git::$INDEX_ALLOCATION"), true);
  assert.equal(isRepositoryMetadata(".gitmodules"), false);
});

test("Pi path spellings the guard cannot see through are refused for writers and reviewers", () => {
  const { root, scope } = fixture();
  const reviewer = { ...scope, paths: ["."], operations: ["read"] };
  const writer = { ...scope, paths: ["."] };
  for (const path of ["@/etc/hosts", "@src/main.py", "@~/.ssh/id_rsa", "file:///etc/hosts", `file://${join(root, "src", "main.py")}`, "~", "~/.bashrc", "~user/x", "https://example.invalid/x"]) {
    for (const [tool, profile] of [["read", reviewer], ["ls", reviewer], ["grep", writer], ["write", writer], ["edit", writer]]) {
      assert.notEqual(decide(tool, { path }, root, profile), null, `${tool} ${path}`);
    }
  }
  // Pi maps Unicode spaces before resolving; the guard judges the same path.
  assert.deepEqual(toolPath("src/a\u00A0b.py"), { path: "src/a b.py" });
  assert.equal(decide("write", { path: "src\u2003dir/x.py" }, root, { ...scope, paths: ["src dir"] }), null);
  assert.match(decide("write", { path: "src\u2003dir/x.py" }, root, scope), /outside the approved task paths/);
  // Git Bash drive paths are mapped exactly as Pi maps them on Windows.
  assert.equal(windowsShellPath("/c/Users/dev/x"), "C:\\Users\\dev\\x");
  assert.equal(windowsShellPath("/mnt/d"), "D:\\");
  assert.equal(windowsShellPath("/usr/lib"), "/usr/lib");
});

// File symbolic links need elevated rights on Windows; the junction cases above cover it.
test("writes through symbolic links cannot leave the worktree or the task paths", { skip: process.platform === "win32" }, () => {
  const { base, root, scope } = fixture();
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "src", "real.py"), "x = 1\n");
  // Tracked dangling links: one leaving the worktree, one leaving the task paths.
  symlinkSync(join(base, "outside", "created-by-writer.txt"), join(root, "src", "out"));
  symlinkSync(join("..", "docs", "new.md"), join(root, "src", "sideways"));
  symlinkSync("real.py", join(root, "src", "alias.py"));
  symlinkSync(join(base, "outside", "missing-dir"), join(root, "src", "gone"));
  assert.match(decide("write", { path: "src/out" }, root, scope), /outside the leased worktree/);
  assert.match(decide("read", { path: "src/out" }, root, scope), /outside the leased worktree/);
  assert.match(decide("write", { path: "src/gone/deep/file.txt" }, root, scope), /outside the leased worktree/);
  assert.match(decide("write", { path: "src/sideways" }, root, scope), /symbolic link|outside the approved task paths/);
  assert.match(decide("edit", { path: "src/alias.py" }, root, scope), /symbolic link/);
  assert.equal(decide("read", { path: "src/alias.py" }, root, scope), null);
  assert.equal(decide("edit", { path: "src/real.py" }, root, scope), null);
  assert.equal(realize(join(root, "src", "out")), realize(join(base, "outside", "created-by-writer.txt")));
  // A dangling cycle is refused instead of looping.
  symlinkSync(join(root, "src", "loop-b"), join(root, "src", "loop-a"));
  symlinkSync(join(root, "src", "loop-a"), join(root, "src", "loop-b"));
  assert.match(decide("write", { path: "src/loop-a" }, root, scope), /cannot be resolved/);
  assert.equal(existsSync(join(base, "outside", "created-by-writer.txt")), false);
  assert.equal(readFileSync(join(root, "src", "real.py"), "utf8"), "x = 1\n");
});
