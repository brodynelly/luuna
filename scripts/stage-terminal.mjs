// Stage the same terminal payload used by the Windows packager, without an installer.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function stageTerminal({ root, out, binary }) {
  root = path.resolve(root); out = path.resolve(out); binary = path.resolve(binary);
  if (out === root || root.startsWith(`${out}${path.sep}`)) throw new Error("The terminal stage must be a separate output directory.");
  const files = ["packages/tui/bin", "packages/tui/src", "packages/tui/package.json", "packages/tui/README.md", "packages/api-client/dist", "packages/api-client/package.json", "schemas/capability-catalog.json"];
  for (const file of [binary, ...files.map((file) => path.join(root, file)), path.join(root, "packages/tui/src/bridge.mjs")]) {
    if (!existsSync(file)) throw new Error(`Terminal staging prerequisite missing: ${file}`);
  }
  const copy = (source, relative) => { const destination = path.join(out, relative); mkdirSync(path.dirname(destination), { recursive: true }); cpSync(source, destination, { recursive: true }); };
  copy(binary, path.basename(binary));
  for (const file of files.filter((file) => !file.startsWith("packages/api-client/"))) copy(path.join(root, file), file);
  copy(path.join(root, "packages/api-client/dist"), "node_modules/@luuna/api-client/dist");
  const api = JSON.parse(readFileSync(path.join(root, "packages/api-client/package.json"), "utf8"));
  writeFileSync(path.join(out, "node_modules/@luuna/api-client/package.json"), `${JSON.stringify({ name: api.name, version: api.version, license: api.license, type: "module", exports: { ".": "./dist/index.js" } }, null, 2)}\n`);
  const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const staged = path.join(out, path.basename(binary));
  if (sha256(staged) !== sha256(binary)) throw new Error("Staged terminal executable hash mismatch.");
  return { binary: staged, sha256: sha256(staged), bridge: path.join(out, "packages/tui/src/bridge.mjs") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map((arg, i, all) => arg.startsWith("--") ? [arg.slice(2), all[i + 1]] : null).filter(Boolean));
  if (!args.out || !args.binary) throw new Error("Usage: node scripts/stage-terminal.mjs --out <directory> --binary <luuna-tui.exe>");
  console.log(JSON.stringify(stageTerminal({ root: args.root ?? fileURLToPath(new URL("../", import.meta.url)), out: args.out, binary: args.binary })));
}
