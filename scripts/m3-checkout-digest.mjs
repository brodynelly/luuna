import { createHash } from "node:crypto";
import { lstatSync, readlinkSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** SHA-256 over the given relative paths under `root` (each file, or every file under a directory), bounded like the Pi tree digest. */
export function pathsDigest(root, rels, { excludeBuildOutputs = false } = {}) {
  const LIMITS = { entries: 20_000, bytes: 256 * 1024 * 1024, depth: 32 };
  const entries = [];
  let visited = 0;
  let bytes = 0;
  const visit = (rel, depth) => {
    // Git can collapse an ignored parent such as .tools/. Apply the same
    // documented build/dependency exclusion at every depth, not just its roots.
    if (excludeBuildOutputs && /(^|\/)(target|node_modules|dist)(\/|$)/.test(rel)) return;
    if (++visited > LIMITS.entries) throw new Error(`more than ${LIMITS.entries} entries`);
    if (depth > LIMITS.depth) throw new Error(`nests deeper than ${LIMITS.depth} levels`);
    const full = path.join(root, rel);
    let stat;
    try { stat = lstatSync(full); } catch { entries.push(`${rel}\0absent`); return; }
    if (stat.isSymbolicLink()) entries.push(`${rel}\0link\0${readlinkSync(full)}`);
    else if (stat.isDirectory()) for (const name of readdirSync(full)) visit(`${rel}/${name}`, depth + 1);
    else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > LIMITS.bytes) throw new Error(`more than ${LIMITS.bytes} bytes`);
      entries.push(`${rel}\0${createHash("sha256").update(readFileSync(full)).digest("hex")}`);
    } else entries.push(`${rel}\0special`);
  };
  for (const rel of rels) visit(rel, 0);
  entries.sort();
  return `sha256:${createHash("sha256").update(entries.join("\n")).digest("hex")}`;
}
