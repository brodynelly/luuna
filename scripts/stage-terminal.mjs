// Stage the same terminal payload used by the Windows packager, without an installer: the
// Rust terminal client is one executable (its command table and the capability catalog are
// embedded), so the payload is that executable alone.
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function stageTerminal({ root, out, binary }) {
  root = path.resolve(root); out = path.resolve(out); binary = path.resolve(binary);
  if (out === root || root.startsWith(`${out}${path.sep}`)) throw new Error("The terminal stage must be a separate output directory.");
  if (!existsSync(binary)) throw new Error(`Terminal staging prerequisite missing: ${binary}`);
  mkdirSync(out, { recursive: true });
  const staged = path.join(out, path.basename(binary));
  cpSync(binary, staged);
  const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
  if (sha256(staged) !== sha256(binary)) throw new Error("Staged terminal executable hash mismatch.");
  return { binary: staged, sha256: sha256(staged) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map((arg, i, all) => arg.startsWith("--") ? [arg.slice(2), all[i + 1]] : null).filter(Boolean));
  if (!args.out || !args.binary) throw new Error("Usage: node scripts/stage-terminal.mjs --out <directory> --binary <luuna-tui.exe>");
  console.log(JSON.stringify(stageTerminal({ root: args.root ?? fileURLToPath(new URL("../", import.meta.url)), out: args.out, binary: args.binary })));
}
