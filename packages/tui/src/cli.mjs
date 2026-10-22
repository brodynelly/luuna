// Non-interactive entry: `luuna-tui <command> [args] [--flag value] [--json]`, one command per
// catalog entry, for scripts and tests. Without a command and with a terminal, the interactive
// workbench opens (interactive.mjs). Exit codes: 0 done, 1 refused or failed, 2 usage.
import { readFileSync, writeFileSync } from "node:fs";
import { LuunaClient, describeFailure, explainFailure } from "@luuna/api-client";
import { COMMANDS, ClientRefusal, PROJECTIONS, UsageError, commandsByName, usage } from "./commands.mjs";
import { catalog } from "./catalog.mjs";
import { colourEnabled, format } from "./format.mjs";

export const DEFAULT_URL = "http://127.0.0.1:4242";

/** Splits argv into positional arguments and `--flag value` / `--flag=value` / boolean flags. */
export function parseArguments(argv, command) {
  const args = [];
  const flags = {};
  const definitions = command?.flags ?? {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") { args.push(...argv.slice(index + 1)); break; }
    if (!token.startsWith("--")) { args.push(token); continue; }
    const equals = token.indexOf("=");
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    const definition = definitions[name];
    if (name === "json") { flags.json = true; continue; }
    if (!definition) throw new UsageError(`Unknown option --${name} for ${command?.name ?? "this command"}. Usage: ${command ? usage(command) : "luuna-tui <command>"}`);
    let value;
    if (definition.boolean) value = equals === -1 ? true : !["false", "no", "0"].includes(argv[index].slice(equals + 1));
    else if (equals !== -1) value = token.slice(equals + 1);
    else {
      if (index + 1 >= argv.length) throw new UsageError(`--${name} needs a value.`);
      value = argv[index + 1];
      index += 1;
    }
    if (definition.repeat) flags[name] = [...(flags[name] ?? []), value];
    else flags[name] = value;
  }
  return { args, flags };
}

/** Reads the hidden token: never echoed, never logged. */
export async function readSecret(question, stdin, stdout) {
  stdout.write(`${question}: `);
  if (!stdin.isTTY) {
    const text = await readAll(stdin);
    return text.split(/\r?\n/)[0] ?? "";
  }
  return new Promise((resolve) => {
    let value = "";
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") { cleanup(); stdout.write("\n"); process.exit(130); }
        if (character === "\r" || character === "\n") { cleanup(); stdout.write("\n"); resolve(value); return; }
        if (character === "\u007f" || character === "\b") { value = value.slice(0, -1); continue; }
        value += character;
      }
    };
    const cleanup = () => { stdin.off("data", onData); stdin.setRawMode(Boolean(wasRaw)); stdin.pause(); };
    stdin.on("data", onData);
  });
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    let text = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => { text += chunk; });
    stream.on("end", () => resolve(text));
    stream.on("error", reject);
    stream.resume();
  });
}

/** The client for `LUUNA_URL` and `LUUNA_API_TOKEN`; the token is prompted (hidden) on a terminal. */
export async function connect(env, { stdin, stdout, fetcher } = {}) {
  const url = (env.LUUNA_URL ?? DEFAULT_URL).trim() || DEFAULT_URL;
  let token = env.LUUNA_API_TOKEN ?? "";
  if (!token.trim()) {
    if (!stdin || !stdout || !stdin.isTTY) throw new UsageError("Set LUUNA_API_TOKEN to the runtime's service token (or run interactively to type it).");
    token = await readSecret("Service token (hidden)", stdin, stdout);
  }
  return new LuunaClient(url, token, fetcher);
}

export function help() {
  const byContext = new Map();
  for (const command of COMMANDS) byContext.set(command.context, [...(byContext.get(command.context) ?? []), command]);
  const sections = [...byContext].map(([context, commands]) => [`${context} commands:`, ...commands.map((command) => `  ${usage(command)}\n      ${catalog.capabilities.find((capability) => capability.id === command.id)?.title ?? ""}`)].join("\n"));
  sections.push(["projections (read-only views over the cataloged actions; the desktop's Home and Kanban panels show the same):", ...PROJECTIONS.map((command) => `  ${usage(command)}\n      ${command.action}: reads ${command.projects.join(", ")}`)].join("\n"));
  return [
    "luuna-tui — terminal client for the Luuna runtime",
    "",
    "  luuna-tui                      open the interactive workbench (keyboard driven)",
    "  luuna-tui <command> [args] [--flag value] [--json]",
    "",
    "Connection: LUUNA_URL (default http://127.0.0.1:4242) and LUUNA_API_TOKEN (never echoed; prompted when missing on a terminal).",
    "Every command is one catalog action (schemas/capability-catalog.json); --json prints the runtime's record unchanged.",
    "",
    ...sections,
    "",
  ].join("\n");
}

/** Runs one command; returns the process exit code. Output goes to `stdout`, refusals to `stderr`. */
export async function runCommand(command, input, client, io) {
  const label = command.action;
  try {
    const expected = command.args.length;
    if (input.args.length < expected) throw new UsageError(`${command.name} needs ${expected} argument(s). Usage: ${usage(command)}`);
    if (input.args.length > expected) throw new UsageError(`${command.name} takes ${expected} argument(s); unexpected: ${input.args.slice(expected).join(" ")}. Usage: ${usage(command)}`);
    if (command.confirm && io.interactive && !(await io.confirm(command.confirm))) { io.stdout.write("Cancelled.\n"); return 0; }
    const result = await command.run(client, input, io);
    if (io.json) io.stdout.write(`${JSON.stringify(result === undefined ? null : result)}\n`);
    else { const text = format(command.id, result, { colour: io.colour }); if (text) io.stdout.write(`${text}\n`); }
    return 0;
  } catch (failure) {
    if (failure instanceof UsageError) { io.stderr.write(`${failure.message}\n`); return 2; }
    const refusal = failure instanceof ClientRefusal ? `${label} refused: ${failure.message}` : explainFailure(label, failure).message;
    if (io.json) io.stdout.write(`${JSON.stringify({ error: refusal })}\n`);
    io.stderr.write(`${refusal}\n`);
    return 1;
  }
}

/** The io a command sees: output streams, hidden prompts, document reads, the follow hooks and whether tones are painted. */
export function makeIo({ stdin, stdout, stderr, json = false, interactive = false, colour = false, signal, prompt, confirm, show }) {
  return {
    stdin, stdout, stderr, json, interactive, colour, signal,
    readFile: (path) => readFileSync(path, "utf8"),
    writeFile: (path, text) => writeFileSync(path, text, "utf8"),
    readStdin: () => readAll(stdin),
    prompt: prompt ?? (async () => ""),
    confirm: confirm ?? (async () => true),
    show: show ?? ((text) => stdout.write(`${text}\n`)),
    note: (text) => stderr.write(`${text}\n`),
    describe: describeFailure,
    emit: (event) => stdout.write(json ? `${JSON.stringify(event)}\n` : `${format("runs.events", [event], { colour })}\n`),
  };
}

export async function main(argv, { env, stdin, stdout, stderr, fetcher }) {
  const [name, ...rest] = argv;
  if (name === undefined && stdin?.isTTY) {
    const { interactive } = await import("./interactive.mjs");
    let client;
    try { client = await connect(env, { stdin, stdout, fetcher }); } catch (failure) { stderr.write(`${failure instanceof UsageError ? failure.message : explainFailure("Connection", failure).message}\n`); return failure instanceof UsageError ? 2 : 1; }
    return interactive(client, { stdin, stdout, stderr, colour: colourEnabled({ env, stdout }) });
  }
  if (name === undefined || name === "help" || name === "--help" || name === "-h") { stdout.write(help()); return name === undefined ? 2 : 0; }
  if (name === "catalog") { stdout.write(`${JSON.stringify(catalog, null, 2)}\n`); return 0; }
  const command = commandsByName.get(name);
  if (!command) { stderr.write(`Unknown command ${name}. Run luuna-tui help for the catalog of commands.\n`); return 2; }
  let input;
  try { input = parseArguments(rest, command); } catch (failure) { stderr.write(`${failure.message}\n`); return 2; }
  let client;
  try { client = await connect(env, { stdin, stdout, fetcher }); } catch (failure) {
    const message = failure instanceof UsageError ? failure.message : explainFailure("Connection", failure).message;
    stderr.write(`${message}\n`);
    return failure instanceof UsageError ? 2 : 1;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  try {
    return await runCommand(command, input, client, makeIo({ stdin, stdout, stderr, json: Boolean(input.flags.json), colour: colourEnabled({ env, stdout }), signal: controller.signal }));
  } finally {
    process.off("SIGINT", abort);
  }
}
