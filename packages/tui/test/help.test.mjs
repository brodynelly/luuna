// The help contract: every command is listed once in the overview, every command has a page with
// its arguments, flags and route, help never needs a token, and a mistyped command gets a suggestion.
import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "../src/cli.mjs";
import { COMMANDS, PROJECTIONS } from "../src/commands.mjs";
import { commandHelp, groupedCommands, overview, suggestions } from "../src/help.mjs";
import { stripAnsi, visibleWidth } from "../src/text.mjs";

async function run(argv, env = {}) {
  let out = "";
  let err = "";
  const code = await main(argv, { env, fetcher: async () => { throw new Error("help must not reach the runtime"); }, stdin: { isTTY: false }, stdout: { write: (text) => { out += text; } }, stderr: { write: (text) => { err += text; } } });
  return { code, out, err };
}

test("every command is placed in exactly one help group", () => {
  const names = groupedCommands().flatMap((group) => group.commands.map((command) => command.name));
  assert.deepEqual([...names].sort(), [...COMMANDS, ...PROJECTIONS].map((command) => command.name).sort());
  assert.ok(!groupedCommands().some((group) => group.title === "Other commands"), "a new command needs a help group");
});

test("the overview lists every command and the component CLIs within its width", () => {
  const text = overview({ name: "lu", width: 80 });
  for (const command of [...COMMANDS, ...PROJECTIONS]) assert.match(text, new RegExp(`^  ${command.name}\\b`, "m"), command.name);
  for (const component of ["missions", "atlas", "beacon"]) assert.match(text, new RegExp(`lu ${component}`));
  for (const row of text.split("\n")) assert.ok(visibleWidth(row) <= 80, row);
});

test("each command page documents every argument and flag with its route and an example", () => {
  for (const command of [...COMMANDS, ...PROJECTIONS]) {
    const text = commandHelp(command, { name: "lu", width: 100 });
    for (const arg of command.args) assert.ok(text.includes(`<${arg.name}>`), `${command.name} <${arg.name}>`);
    for (const flag of Object.keys(command.flags)) assert.ok(text.includes(`--${flag}`), `${command.name} --${flag}`);
    assert.match(text, new RegExp(`^  lu ${command.name}\\b`, "m"));
  }
});

test("help, help <command>, <command> --help and help --all need no token; colour only on request", async () => {
  for (const argv of [["help"], ["-h"], ["help", "plan"], ["plan", "--help"], ["approve", "-h"], ["help", "--all"]]) {
    const result = await run(argv, { LUUNA_CLI_NAME: "lu" });
    assert.equal(result.code, 0, argv.join(" "));
    assert.equal(stripAnsi(result.out), result.out, "no colour when stdout is not a terminal");
  }
  assert.match((await run(["plan", "--help"], { LUUNA_CLI_NAME: "lu" })).out, /^lu plan <ticket> \[flags\]/);
  assert.match((await run(["help", "--all"])).out, /luuna-tui publication-repair <run>/);
});

test("an unknown command or help topic suggests the closest commands", async () => {
  assert.deepEqual(suggestions("aprove"), ["approve"]);
  const result = await run(["prjects"]);
  assert.equal(result.code, 2);
  assert.match(result.err, /Unknown command prjects\. Did you mean projects/);
  assert.equal((await run(["help", "nope"])).code, 2);
});
