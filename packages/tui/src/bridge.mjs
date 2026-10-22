// Rust owns the terminal; this process owns only existing command/client semantics.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { describeFailure } from "@luuna/api-client";
import { connect, runCommand } from "./cli.mjs";
import { COMMANDS, PROJECTIONS, commandsByName, UsageError } from "./commands.mjs";
import { capabilitiesById } from "./catalog.mjs";
import { format } from "./format.mjs";

export const LIMITS = Object.freeze({ frame: 1024 * 1024, queue: 32, reads: 4, mutations: 1, text: 64 * 1024, display: 256 * 1024, healthMs: 2000 });
const abortError = () => new DOMException("Local request aborted.", "AbortError");
const plain = (text) => String(text).replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
const readOnly = (command) => PROJECTIONS.includes(command) || capabilitiesById.get(command.id)?.method === "GET";
const protocolError = (code, message) => Object.assign(new Error(message), { code });

/** `send` may return a promise; at most 32 frames are retained while it drains. */
export function createBridge({ send, env = process.env, fetcher = globalThis.fetch, readFile = (path) => readFileSync(path, "utf8"), writeFile = (path, text) => writeFileSync(path, text, "utf8") }) {
  const active = new Map();
  const controls = new Set();
  const queue = [];
  const idle = [];
  let draining = false;
  let closed = false;
  let transportFailed = false;
  let client;
  let reads = 0;
  let mutations = 0;
  let promptSequence = 0;
  let healthController;
  let connectionState;
  const token = env.LUUNA_API_TOKEN;
  const secrets = token ? [...new Set([token, plain(token), JSON.stringify(token).slice(1, -1), JSON.stringify(plain(token)).slice(1, -1)])].filter(Boolean).sort((left, right) => right.length - left.length) : [];
  // Redact values before serialization, including escaped/newline-bearing tokens.
  const redact = (value) => {
    if (typeof value === "string") return secrets.reduce((text, secret) => text.split(secret).join("[redacted]"), value);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redact(item)]));
    return value;
  };
  function frame(id, event, fields = {}) {
    const value = redact({ v: 1, id, event, ...fields });
    if (Buffer.byteLength(JSON.stringify(value)) > LIMITS.frame) throw protocolError("result_too_large", "The complete result exceeds the bridge limit. Execution has already finished; inspect authoritative state before another action.");
    return value;
  }
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length) { await send(queue[0]); queue.shift(); }
    } catch {
      transportFailed = true;
      queue.length = 0;
      close();
    } finally {
      draining = false;
      if (!queue.length) for (const resolve of idle.splice(0)) resolve();
    }
  }
  function emit(id, event, fields, reserved = false) {
    if (transportFailed) return;
    if (queue.length >= LIMITS.queue - (reserved ? 0 : 6)) throw protocolError("output_backpressure", "The terminal is not consuming output. Local work was stopped; inspect authoritative state before retrying an action.");
    queue.push(frame(id, event, fields));
    void drain();
  }
  const flushed = () => !draining && !queue.length ? Promise.resolve() : new Promise((resolve) => idle.push(resolve));
  function error(id, failure, outcome = "not_executed", exitCode = 2) {
    emit(id, "error", { code: failure.code ?? "invalid_request", message: plain(failure.message), outcome, exit_code: exitCode }, true);
  }
  function close() {
    if (closed) return;
    closed = true;
    clearInterval(healthTimer);
    healthController?.abort();
    for (const task of active.values()) task.controller.abort();
  }
  async function getClient() {
    if (!client) client = await connect(env, { fetcher });
    return client;
  }
  async function health() {
    if (closed || healthController) return;
    healthController = new AbortController();
    const timeout = setTimeout(() => healthController?.abort(), LIMITS.healthMs);
    timeout.unref?.();
    try {
      await (await getClient()).health(healthController.signal);
      if (!closed && connectionState !== "connected") emit("connection", "connection", { state: "connected", message: "Runtime connected. Reload authoritative views." });
      connectionState = "connected";
    } catch (failure) {
      if (!closed && connectionState !== "disconnected") emit("connection", "connection", { state: "disconnected", message: plain(describeFailure(failure)) });
      connectionState = "disconnected";
    } finally { clearTimeout(timeout); healthController = undefined; }
  }
  const healthTimer = setInterval(() => { void health().catch(() => close()); }, LIMITS.healthMs);
  healthTimer.unref?.();

  function output(task, kind, text) {
    const clean = plain(text);
    if (task.command.name === "approve" && Buffer.byteLength(clean) > LIMITS.display) throw protocolError("plan_too_large", "The complete plan cannot fit in the review window. Approval is disabled.");
    // Small chunks also bound JSON escaping expansion to less than 64 KiB.
    for (let offset = 0; offset < clean.length;) {
      let end = Math.min(offset + 8000, clean.length);
      if (end < clean.length && /[\uD800-\uDBFF]/.test(clean[end - 1])) end--;
      emit(task.id, "output", { kind, text: clean.slice(offset, end) });
      offset = end;
    }
  }
  function prompt(task, kind, question) {
    if (task.controller.signal.aborted) return Promise.reject(abortError());
    const promptId = `prompt-${++promptSequence}`;
    return new Promise((resolve, reject) => {
      const abort = () => { task.prompt = undefined; reject(abortError()); };
      task.controller.signal.addEventListener("abort", abort, { once: true });
      task.prompt = { id: promptId, kind, resolve: (value) => { task.controller.signal.removeEventListener("abort", abort); task.prompt = undefined; resolve(value); } };
      try { emit(task.id, "prompt", { prompt_id: promptId, kind, question: plain(question) }); }
      catch (failure) { task.controller.signal.removeEventListener("abort", abort); task.prompt = undefined; reject(failure); }
    });
  }
  function validate(request) {
    if (!request || Array.isArray(request) || typeof request !== "object" || request.v !== 1 || typeof request.id !== "string" || !/^[\w.:-]{1,128}$/.test(request.id)) throw protocolError("invalid_request", "Expected protocol v1 and a nonempty ASCII correlation id (up to 128 characters).");
    if (Buffer.byteLength(JSON.stringify(request)) > LIMITS.frame) throw protocolError("frame_too_large", "Request exceeds the 1 MiB frame limit.");
    const fields = { catalog: [], invoke: ["name", "args", "flags", "stdin_document"], read: ["name", "args", "flags"], reply: ["request_id", "prompt_id", "value"], abort: ["request_id"], shutdown: [] }[request.op];
    if (!fields) throw protocolError("invalid_operation", "Unknown bridge operation.");
    if (Object.keys(request).some((key) => !["v", "id", "op", ...fields].includes(key))) throw protocolError("invalid_request", "Unexpected protocol field.");
    if (active.has(request.id) || controls.has(request.id)) throw protocolError("duplicate_id", "That correlation id is already active.");
    if (closed) throw protocolError("closed", "The bridge is closed.");
  }
  async function dispatch(request) {
    const id = typeof request?.id === "string" && /^[\w.:-]{1,128}$/.test(request.id) ? request.id : "protocol";
    let task;
    let code = 2;
    try {
      validate(request);
      if (["catalog", "reply", "abort", "shutdown"].includes(request.op)) {
        controls.add(id);
        if (request.op === "catalog") {
          const commands = [...COMMANDS, ...PROJECTIONS].map(({ run: _run, example: _example, ...command }) => ({ ...command, flags: Object.fromEntries(Object.entries(command.flags).filter(([name]) => name !== "acknowledge-hash")), read_only: readOnly(commandsByName.get(command.name)) }));
          emit(id, "catalog", { commands });
        } else if (request.op === "reply") {
          const pending = active.get(request.request_id)?.prompt;
          if (!pending || pending.id !== request.prompt_id) throw protocolError("stale_prompt", "This prompt is no longer awaiting an answer.");
          if (pending.kind === "confirm" ? typeof request.value !== "boolean" : typeof request.value !== "string") throw protocolError("invalid_reply", "Confirmation answers must be booleans; text answers must be strings.");
          pending.resolve(request.value);
          emit(id, "result", { value: { replied: true }, formatted: "", code: 0 }, true);
        } else if (request.op === "abort") {
          const target = active.get(request.request_id);
          if (!target) throw protocolError("unknown_request", "This request is not active.");
          target.controller.abort();
          emit(id, "result", { value: { aborted: request.request_id }, formatted: "", code: 0 }, true);
        } else {
          close();
          emit(id, "result", { value: { closed: true }, formatted: "", code: 0 }, true);
        }
        return;
      }
      const command = commandsByName.get(request.name);
      if (!command) throw protocolError("unknown_command", "Unknown catalog command.");
      const isRead = readOnly(command);
      if (request.op === "read" && (!isRead || Object.hasOwn(request.flags ?? {}, "output"))) throw protocolError("read_only", "Read operations admit GET commands and projections without file output only.");
      const args = request.args ?? [];
      const flags = request.flags ?? {};
      if (!Array.isArray(args) || args.some((value) => typeof value !== "string") || !flags || Array.isArray(flags) || typeof flags !== "object") throw new UsageError("Arguments must be strings and flags an object.");
      if (request.stdin_document !== undefined && typeof request.stdin_document !== "string") throw new UsageError("stdin_document must be text.");
      for (const [name, value] of Object.entries(flags)) {
        const definition = command.flags[name];
        if (!Object.hasOwn(command.flags, name) || name === "acknowledge-hash") throw new UsageError("Unknown or non-interactive-only flag. Approval requires a fresh typed hash prompt.");
        if (definition.boolean ? typeof value !== "boolean" : !(typeof value === "string" || (definition.repeat && Array.isArray(value) && value.every((item) => typeof item === "string")))) throw new UsageError(`Invalid value type for --${name}.`);
      }
      // Local file exports are actions too, despite their runtime GET method.
      const mutation = !isRead || Object.hasOwn(flags, "output");
      if (mutation ? mutations >= LIMITS.mutations : reads >= LIMITS.reads) throw protocolError("busy", "The bridge already has its maximum concurrent requests.");
      if (mutation) mutations++; else reads++;
      task = { id, command, mutation, controller: new AbortController(), prompt: undefined, executed: false, mutationSent: false, completed: false };
      active.set(id, task);
      let value = null;
      let failure;
      let stderr = "";
      const adapted = { ...command, run: async (...parameters) => {
        task.executed = true;
        try { value = await command.run(...parameters); task.completed = true; return value; }
        catch (error) { failure = error; throw error; }
      } };
      const io = {
        interactive: true, json: true, colour: false, signal: task.controller.signal,
        stdout: { write: () => true },
        stderr: { write: (text) => { stderr = plain(text).slice(0, LIMITS.display); return true; } },
        readFile, writeFile: (...parameters) => { task.mutationSent = true; return writeFile(...parameters); },
        readStdin: () => request.stdin_document !== undefined ? Promise.resolve(request.stdin_document) : prompt(task, "document", "Enter the complete document for standard input"),
        show: (text) => output(task, "plan", text),
        prompt: (question) => prompt(task, command.name === "approve" ? "hash" : "text", question),
        confirm: (question) => prompt(task, "confirm", question),
        note: (text) => output(task, "note", text),
        describe: describeFailure,
        emit: (record) => emit(id, "event", { record }),
      };
      const api = await connect(env, { fetcher: (url, init = {}) => { if ((init.method ?? "GET") !== "GET") task.mutationSent = true; return fetcher(url, init); } });
      if (task.controller.signal.aborted) throw abortError();
      code = await runCommand(adapted, { args, flags }, api, io);
      if (task.controller.signal.aborted) throw abortError();
      if (code) throw Object.assign(failure ?? new Error(stderr || "The command failed."), { bridgeMessage: stderr });
      let formatted;
      try { formatted = value === null ? "Cancelled." : plain(format(command.id, value, { colour: false })); }
      catch { throw protocolError("invalid_result", "The command completed, but its response cannot be formatted. Inspect authoritative state before repeating an action."); }
      emit(id, "result", { value: value ?? null, formatted, code: 0 }, true);
    } catch (failure) {
      if (failure.code === "output_backpressure") task?.controller.abort();
      const outcome = task?.completed ? "completed" : task?.mutationSent && (failure instanceof TypeError || failure.name === "AbortError" || failure.code === "output_backpressure") ? "unknown" : task?.controller.signal.aborted ? "aborted" : task?.executed ? "refused" : "not_executed";
      try { error(id, { code: typeof failure.code === "string" ? failure.code : failure.name === "AbortError" ? "aborted" : code === 2 ? "usage" : "command_failed", message: failure.bridgeMessage || describeFailure(failure) }, outcome, failure.name === "AbortError" ? 1 : code === 2 ? 2 : 1); }
      catch { close(); }
    } finally {
      controls.delete(id);
      if (task) { active.delete(id); if (task.mutation) mutations--; else reads--; }
    }
  }
  return { dispatch, close, flushed };
}

/** Byte-framed input is bounded before decoding; protocol stdin is never a document. */
export async function serveBridge({ stdin = process.stdin, stdout = process.stdout, env = process.env } = {}) {
  const bridge = createBridge({ env, send: async (frame) => { if (!stdout.write(`${JSON.stringify(frame)}\n`)) await once(stdout, "drain"); } });
  const pipeClosed = () => { bridge.close(); stdin.destroy(); };
  stdout.on("error", pipeClosed);
  stdout.on("close", pipeClosed);
  let buffer = Buffer.alloc(0);
  let stopping = false;
  const pending = new Set();
  const fail = async (code, message) => {
    stopping = true;
    bridge.close();
    await bridge.flushed();
    if (!stdout.destroyed) stdout.write(`${JSON.stringify({ v: 1, id: "protocol", event: "error", code, message, outcome: "not_executed", exit_code: 2 })}\n`);
  };
  try {
    for await (const chunk of stdin) {
      let offset = 0;
      while (offset < chunk.length && !stopping) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        if (buffer.length + end - offset > LIMITS.frame) { await fail("frame_too_large", "Request exceeds the 1 MiB frame limit."); break; }
        buffer = Buffer.concat([buffer, chunk.subarray(offset, end)]);
        offset = end + 1;
        if (newline < 0) break;
        let request;
        try { request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); }
        catch { await fail("invalid_json", "Malformed UTF-8 JSON frame."); break; }
        buffer = Buffer.alloc(0);
        // A malicious peer cannot accumulate unlimited asynchronous dispatches.
        if (pending.size >= LIMITS.queue) { await fail("input_backpressure", "Too many pending protocol requests."); break; }
        const completion = bridge.dispatch(request).finally(() => pending.delete(completion));
        pending.add(completion);
        if (request.op === "shutdown") stopping = true;
      }
      if (stopping) break;
    }
    if (!stopping && buffer.length) await fail("invalid_json", "The final JSON frame is incomplete.");
  } finally {
    bridge.close();
    await Promise.allSettled([...pending]);
    await bridge.flushed();
    stdout.off("error", pipeClosed);
    stdout.off("close", pipeClosed);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  serveBridge().catch(() => { process.exitCode = 1; });
}
