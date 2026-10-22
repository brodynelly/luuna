// Parity between the scope guard and the pinned Pi 1.3.0's own tool path
// resolution (resolveToCwd, used by read, write, edit, ls, grep and find):
// whatever the guard allows must land, as Pi resolves it, inside the worktree,
// outside repository metadata and, for writes, inside the task paths. Skipped
// when the pinned Pi package is not installed.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decide, isRepositoryMetadata, realize } from "../../../crates/luuna-engine-pi/assets/luuna-scope-guard.js";

function pinnedPathUtils() {
  const command = process.env.LUUNA_PI_COMMAND;
  const candidates = [
    process.env.LUUNA_PI_PACKAGE,
    command && join(dirname(command), "..", "@earendil-works", "pi-coding-agent"),
    fileURLToPath(new URL("../node_modules/@earendil-works/pi-coding-agent", import.meta.url)),
  ].filter(Boolean);
  for (const dir of candidates) {
    const file = join(dir, "dist", "core", "tools", "path-utils.js");
    if (!existsSync(file)) continue;
    if (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version !== "1.3.0") continue;
    return pathToFileURL(file).href;
  }
  return null;
}

const utils = pinnedPathUtils();

test("every path the guard allows resolves inside scope as pinned Pi resolves it", { skip: utils ? false : "pinned Pi 1.3.0 is not installed; set LUUNA_PI_PACKAGE or LUUNA_PI_COMMAND" }, async () => {
  const { resolveToCwd } = await import(utils);
  const base = mkdtempSync(join(tmpdir(), "luuna-pi-resolution-"));
  const root = join(base, "worktree");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(base, "outside"), { recursive: true });
  writeFileSync(join(root, "src", "main.py"), "print('x')\n");
  writeFileSync(join(root, "README.md"), "readme\n");
  writeFileSync(join(root, ".git"), "gitdir: /elsewhere/.git/worktrees/app\n");
  writeFileSync(join(base, "outside", "secret.txt"), "SYNTHETIC-PRIVATE-CONTENT\n");
  if (process.platform !== "win32") {
    symlinkSync(join(base, "outside", "created.txt"), join(root, "src", "out"));
    symlinkSync(join(base, "outside"), join(root, "escape"));
  }
  const outside = join(base, "outside", "secret.txt");
  const inputs = [
    "src/main.py", "src/new.py", "README.md", ".", "src", "src/../README.md", join(root, "src", "main.py"),
    `@${outside}`, "@src/main.py", "@~/x", `file://${outside}`, pathToFileURL(join(root, "src", "main.py")).href,
    "~", "~/x", outside, "../outside/secret.txt", "escape/secret.txt", "src/out", ".git", "src/../.git",
    "src/a b.py", "src /x.py", " @src/x.py",
  ];
  const writer = { root, paths: ["src"], operations: ["read", "write"] };
  const whole = { root, paths: ["."], operations: ["read", "write"] };
  const reviewer = { root, paths: ["."], operations: ["read"] };
  const realRoot = realize(root);
  let allowed = 0;
  for (const raw of inputs) {
    for (const [tool, scope] of [["read", reviewer], ["ls", reviewer], ["write", writer], ["edit", whole]]) {
      if (decide(tool, { path: raw }, root, scope) !== null) continue;
      allowed += 1;
      const rel = relative(realRoot, realize(resolveToCwd(raw, root))).split(sep).join("/");
      assert.ok(!rel.startsWith("..") && !isAbsolute(rel), `${tool} ${JSON.stringify(raw)} reached ${rel}`);
      assert.ok(!rel.split("/").some(isRepositoryMetadata), `${tool} ${JSON.stringify(raw)} reached ${rel}`);
      if (tool === "write" || tool === "edit") {
        assert.ok(scope.paths.some((p) => p === "." || rel === p || rel.startsWith(`${p}/`)), `${tool} ${JSON.stringify(raw)} reached ${rel}`);
      }
    }
  }
  assert.ok(allowed >= 10, `only ${allowed} allowed decisions were compared`);
});
