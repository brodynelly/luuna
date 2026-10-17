// Luuna scope guard: a Pi extension loaded explicitly by the runtime for writer
// sessions. It blocks every tool call that would read or change a path outside
// the leased worktree and the approved task paths, and every tool the session
// does not declare. Scope comes from LUUNA_SCOPE_JSON, which the runtime sets:
//   {"root": "/abs/worktree", "paths": ["src", "docs/CHANGELOG.md"],
//    "operations": ["read", "write"]}
// This is deterministic runtime enforcement inside the Pi process, not an
// operating-system boundary: the runtime still judges the worktree diff after
// the session and the host keeps native permissions.
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit"]);

/** Resolve a path the way the filesystem will, following symlinks in the existing prefix. */
export function realize(target) {
  let existing = target;
  const missing = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    missing.unshift(existing.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    existing = parent;
  }
  let base;
  try {
    base = realpathSync(existing);
  } catch {
    base = existing;
  }
  return missing.length ? resolve(base, ...missing) : base;
}

function within(path, prefix) {
  return prefix === "." || path === prefix || path.startsWith(`${prefix}/`);
}

/** Decide one tool call. Returns null to allow or a reason string to block. */
export function decide(toolName, input, cwd, scope) {
  if (!scope || typeof scope.root !== "string" || !Array.isArray(scope.paths)) {
    return "scope is not configured; every tool call is blocked";
  }
  const operations = Array.isArray(scope.operations) ? scope.operations : [];
  const writes = WRITE_TOOLS.has(toolName);
  if (!writes && !READ_TOOLS.has(toolName)) {
    return `tool ${toolName} is not part of the approved writer profile`;
  }
  if (writes && !operations.includes("write")) {
    return `tool ${toolName} needs the write operation, which the task does not permit`;
  }
  if (!writes && !operations.includes("read")) {
    return `tool ${toolName} needs the read operation, which the task does not permit`;
  }
  const raw = input && typeof input.path === "string" ? input.path : ".";
  const root = realize(scope.root);
  const target = realize(isAbsolute(raw) ? raw : resolve(cwd, raw));
  const rel = relative(root, target).split(sep).join("/");
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return `path ${raw} resolves outside the leased worktree`;
  }
  const inside = rel === "" ? "." : rel;
  // Reads may inspect the whole worktree; changes must stay inside the task paths.
  if (writes && !scope.paths.some((prefix) => within(inside, prefix))) {
    return `path ${raw} is outside the approved task paths ${JSON.stringify(scope.paths)}`;
  }
  return null;
}

function loadScope() {
  try {
    return JSON.parse(process.env.LUUNA_SCOPE_JSON ?? "null");
  } catch {
    return null;
  }
}

export default function luunaScopeGuard(pi) {
  const scope = loadScope();
  pi.on("tool_call", async (event, ctx) => {
    const reason = decide(event.toolName, event.input, ctx.cwd, scope);
    if (reason !== null) {
      return { block: true, reason: `Luuna scope guard: ${reason}` };
    }
    return undefined;
  });
}
