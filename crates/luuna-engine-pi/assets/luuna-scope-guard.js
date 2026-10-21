// Luuna scope guard: a Pi extension loaded explicitly by the runtime for writer
// and independent reviewer sessions. It blocks every tool call outside
// the leased worktree and the approved task paths, and every tool the session
// does not declare. Scope comes from LUUNA_SCOPE_JSON, which the runtime sets:
//   {"root": "/abs/worktree", "paths": ["src", "docs/CHANGELOG.md"],
//    "operations": ["read", "write"]}
// This is deterministic runtime enforcement inside the Pi process, not an
// operating-system boundary: the runtime still judges the worktree diff after
// the session and the host keeps native permissions.
import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
// Pi 1.3.0 maps these to a plain space before resolving a tool path
// (normalizePath with normalizeUnicodeSpaces in dist/utils/paths.js).
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const MAX_LINKS = 40;

/** Git Bash, MSYS, Cygwin and WSL drive paths, mapped exactly as Pi 1.3.0 maps them on Windows. */
export function windowsShellPath(path) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return path;
  const match = path.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
  if (!match) return path;
  return `${match[1].toUpperCase()}:\\${match[2]?.replaceAll("/", "\\") ?? ""}`;
}

/**
 * The path a Pi 1.3.0 file tool acts on, or why the guard refuses it. After this
 * guard decides, Pi strips a leading `@`, expands `~` against the session's HOME
 * and converts `file://` URLs. Those spellings are refused rather than
 * re-implemented, so the guard and the tool can never resolve a path differently.
 */
export function toolPath(raw) {
  const mapped = raw.replace(UNICODE_SPACES, " ");
  if (mapped.startsWith("@")) {
    return { refused: `path ${raw} starts with '@'; name the file by its plain path` };
  }
  const path = process.platform === "win32" ? windowsShellPath(mapped) : mapped;
  if (path.startsWith("~")) {
    return { refused: `path ${raw} starts with '~'; home-relative paths are outside the worktree` };
  }
  // A one-letter prefix is a Windows drive; anything longer is a URL scheme.
  if (/^[A-Za-z][A-Za-z0-9+.-]+:/.test(path)) {
    return { refused: `path ${raw} is a URL; name the file by its plain path` };
  }
  return { path };
}

/**
 * Whether one path component reaches Git's repository metadata as a filesystem
 * may resolve it: `.git` in any ASCII case, with the trailing dots or spaces
 * Windows ignores or an NTFS stream suffix, or its `GIT~1` short name.
 */
export function isRepositoryMetadata(component) {
  const name = component
    .split(":")[0]
    .replace(/[. ]+$/, "")
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  return name === ".git" || name === "git~1";
}

function symbolicLink(path) {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a path the way the filesystem will, following symlinks in the existing
 * prefix. A dangling link does not exist for `existsSync`, yet writing through it
 * creates its target, so its target is followed too.
 */
export function realize(target, depth = 0) {
  if (depth > MAX_LINKS) throw new Error("too many levels of symbolic links");
  let existing = target;
  const missing = [];
  while (!existsSync(existing)) {
    const link = symbolicLink(existing);
    if (link !== null) return realize(resolve(dirname(existing), link, ...missing), depth + 1);
    const parent = dirname(existing);
    if (parent === existing) break;
    missing.unshift(existing.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    existing = parent;
  }
  let base;
  try {
    // Node 24's JS realpath implementation can reject Windows verbatim paths
    // before following junctions. The native implementation resolves both
    // spellings (and DOS short names) before the scope comparison below.
    base = process.platform === "win32" ? realpathSync.native(existing) : realpathSync(existing);
  } catch {
    base = existing;
  }
  // Rust canonical paths use the Windows verbatim prefix; Pi's cwd may use
  // the ordinary spelling. Compare the same real path in one namespace.
  if (process.platform === "win32") {
    if (base.startsWith("\\\\?\\UNC\\")) base = `\\\\${base.slice(8)}`;
    else if (base.startsWith("\\\\?\\")) base = base.slice(4);
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
    return `tool ${toolName} is not part of the approved writer profile or read-only reviewer profile`;
  }
  if (writes && !operations.includes("write")) {
    return `tool ${toolName} needs the write operation, which the task does not permit`;
  }
  if (!writes && !operations.includes("read")) {
    return `tool ${toolName} needs the read operation, which the task does not permit`;
  }
  const raw = input && typeof input.path === "string" ? input.path : ".";
  const requested = toolPath(raw);
  if (requested.refused) return requested.refused;
  const metadata = `path ${raw} names repository metadata (.git), which no session may read or change`;
  if (requested.path.split(/[\\/]/).some(isRepositoryMetadata)) return metadata;
  const lexical = isAbsolute(requested.path) ? resolve(requested.path) : resolve(cwd, requested.path);
  let root;
  let target;
  try {
    root = realize(scope.root);
    target = realize(lexical);
  } catch {
    return `path ${raw} cannot be resolved`;
  }
  const rel = relative(root, target).split(sep).join("/");
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return `path ${raw} resolves outside the leased worktree`;
  }
  const inside = rel === "" ? "." : rel;
  // Repository metadata is never task content, whatever the approved scope.
  if (inside.split("/").some(isRepositoryMetadata)) return metadata;
  // Reads may inspect the whole worktree; changes must stay inside the task paths.
  if (writes && symbolicLink(lexical) !== null) {
    return `path ${raw} is a symbolic link; change the file it points to inside the task paths instead`;
  }
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
