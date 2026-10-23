// Where the Rust terminal client is, and its command table, for the smoke and audit harnesses.
// The client is one executable (crates/luuna-tui); its command table is the data it embeds.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The development build of the client (honouring CARGO_TARGET_DIR), or the packaged executable beside `root`. */
export function clientBinary(root = repository, env = process.env) {
  const exe = process.platform === "win32" ? "luuna-tui.exe" : "luuna-tui";
  const target = path.resolve(root, env.CARGO_TARGET_DIR || "target");
  return path.join(target, "debug", exe);
}

export const tuiTable = JSON.parse(readFileSync(path.join(repository, "crates/luuna-tui/commands.json"), "utf8"));
/** Every command the command line reaches: the cataloged actions and the projections. */
export const commandsByName = new Map([...tuiTable.commands, ...tuiTable.projections].map((command) => [command.name, command]));
export const commandsById = new Map(tuiTable.commands.map((command) => [command.id, command]));
