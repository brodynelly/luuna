// Non-interactive entry: `luuna-tui <command> [args] [--flag value] [--json]`, one command per
// catalog entry, for scripts and tests. Without a command and with a terminal, the interactive
// Rust workbench opens. Exit codes: 0 done, 1 refused or failed, 2 usage.
import { readFileSync, writeFileSync } from "node:fs";
import { LuunaClient, describeFailure, explainFailure } from "@luuna/api-client";
import { ClientRefusal, SandboxExit, UsageError, commandsByName, usage } from "./commands.mjs";
import { launchSandbox } from "./sandbox.mjs";
import { catalog } from "./catalog.mjs";
import { colourEnabled, format } from "./format.mjs";
import { DEFAULT_NAME, commandHelp, overview, reference, suggestions } from "./help.mjs";

export const DEFAULT_URL = "http://127.0.0.1:4242";

/** Splits argv into positional arguments and `--flag value` / `--flag=value` / boolean flags. */
export function parseArguments(argv, command) {
  const args = [];
  const flags = {};
  const definitions = command?.flags ?? {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") { args.push(...argv.slice(index + 1)); break; }
    // A command with a trailing command (`sbx <project> pi --model x`) takes every word after its
    // own arguments verbatim, so the result is the same when a launcher drops the `--`.
    if (command?.rest && !token.startsWith("--") && args.length >= command.args.length) { args.push(...argv.slice(index)); break; }
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

/** The overview help (src/help.mjs); `name` is the program name the developer typed. */
export function help(options = {}) {
  return overview(options);
}

/** Runs one command; returns the process exit code. Output goes to `stdout`, refusals to `stderr`. */
export async function runCommand(command, input, client, io) {
  const label = command.action;
  try {
    const expected = command.args.length;
    if (input.args.length < expected) throw new UsageError(`${command.name} needs ${expected} argument(s). Usage: ${usage(command)}`);
    if (input.args.length > expected && !command.rest) throw new UsageError(`${command.name} takes ${expected} argument(s); unexpected: ${input.args.slice(expected).join(" ")}. Usage: ${usage(command)}`);
    if (command.confirm && io.interactive && !(await io.confirm(command.confirm))) { io.stdout.write("Cancelled.\n"); return 0; }
    const result = await command.run(client, input, io);
    if (result instanceof SandboxExit) return result.code;
    if (io.json) io.stdout.write(`${JSON.stringify(result === undefined ? null : result)}\n`);
    else { const text = format(command.id, result, { colour: io.colour }); if (text) io.stdout.write(`${text}\n`); }
    return command.failed?.(result) ? 1 : 0;
  } catch (failure) {
    if (failure instanceof UsageError) { io.stderr.write(`${failure.message}\n`); return 2; }
    const refusal = failure instanceof ClientRefusal ? `${label} refused: ${failure.message}` : explainFailure(label, failure).message;
    if (io.json) io.stdout.write(`${JSON.stringify({ error: refusal })}\n`);
    io.stderr.write(`${refusal}\n`);
    return 1;
  }
}

/** The io a command sees: output streams, hidden prompts, document reads, the follow hooks and whether tones are painted. */
export function makeIo({ stdin, stdout, stderr, json = false, interactive = false, colour = false, signal, prompt, confirm, show, launch }) {
  return {
    stdin, stdout, stderr, json, interactive, colour, signal, launch,
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

export async function main(argv, { env, stdin, stdout, stderr, fetcher, nativeLauncher }) {
  const [name, ...rest] = argv;
  if (name === undefined && stdin?.isTTY && stdout?.isTTY) {
    const launch = nativeLauncher ?? (await import("./native.mjs")).launchNative;
    return launch({ env, stdin, stdout, stderr });
  }
  const program = env?.LUUNA_CLI_NAME?.trim() || DEFAULT_NAME;
  const helpOptions = { name: program, colour: colourEnabled({ env, stdout }), width: stdout?.isTTY ? stdout.columns : undefined };
  const unknown = (word) => {
    const close = suggestions(word);
    stderr.write(`Unknown command ${word}.${close.length ? ` Did you mean ${close.join(", ")}?` : ""} Run ${program} help for the commands.\n`);
    return 2;
  };
  if (name === undefined || name === "--help" || name === "-h") { stdout.write(help(helpOptions)); return name === undefined ? 2 : 0; }
  if (name === "help") {
    const [topic, ...extra] = rest;
    if (topic === undefined) { stdout.write(help(helpOptions)); return 0; }
    if (topic === "--all" || topic === "all") { stdout.write(reference(helpOptions)); return 0; }
    const described = commandsByName.get(topic);
    if (!described || extra.length) return unknown([topic, ...extra].join(" "));
    stdout.write(commandHelp(described, helpOptions));
    return 0;
  }
  if (name === "catalog") { stdout.write(`${JSON.stringify(catalog, null, 2)}\n`); return 0; }
  const command = commandsByName.get(name);
  if (!command) return unknown(name);
  // `<command> --help` needs no token; a `--help` after `--` is an argument.
  const ended = rest.indexOf("--");
  if ((ended === -1 ? rest : rest.slice(0, ended)).some((token) => token === "--help" || token === "-h")) { stdout.write(commandHelp(command, helpOptions)); return 0; }
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
    const launch = (plan, sandboxed, grants) => launchSandbox(plan, sandboxed, { grants, env });
    return await runCommand(command, input, client, makeIo({ stdin, stdout, stderr, json: Boolean(input.flags.json), colour: colourEnabled({ env, stdout }), signal: controller.signal, launch }));
  } finally {
    process.off("SIGINT", abort);
  }
}
