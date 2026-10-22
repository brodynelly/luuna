// The interactive workbench: keyboard-driven menus over the same command table as the
// non-interactive mode, so every cataloged action is reachable from a list. State is always
// re-read from the runtime (no local domain rules); an outage is shown in the header while the
// client polls /health, and every list reloads when the runtime answers again.
//
// Rendering is sized to the terminal: every row is truncated (menus, header) or wrapped (text
// screens) to `stdout.columns`, exactly `stdout.rows` rows are drawn, a long list scrolls behind a
// viewport that keeps the cursor visible, and the help footer is always the last row. The screen
// is drawn on the terminal's alternate buffer with the cursor hidden, both restored on exit.
import { createInterface, emitKeypressEvents } from "node:readline";
import { describeFailure, explainFailure } from "@luuna/api-client";
import { COMMANDS, PROJECTIONS } from "./commands.mjs";
import { catalog } from "./catalog.mjs";
import { makeIo, runCommand } from "./cli.mjs";
import { connectionTone, paint, runLine } from "./format.mjs";
import { pickFit, truncate, wrapLines } from "./text.mjs";

const title = (command) => catalog.capabilities.find((capability) => capability.id === command.id)?.title ?? command.name;
const byContext = (context) => COMMANDS.filter((command) => command.context === context);
const HEALTH_INTERVAL_MS = 2000;
const MIN_COLUMNS = 20;
const MIN_ROWS = 6;
/** Rows the frame keeps: header, notice, title, a blank row, and the footer. */
const FRAME_ROWS = 5;
const ALT_SCREEN_ON = "\u001b[?1049h";
const ALT_SCREEN_OFF = "\u001b[?1049l";
const CURSOR_HIDE = "\u001b[?25l";
const CURSOR_SHOW = "\u001b[?25h";
/** Each row is erased whole before it is written: this also resets a terminal's "wrapped" flag left by a prompt's echo. */
const ERASE_LINE = "\u001b[2K";
const CLEAR_TO_END = "\u001b[K";
const RESET = "\u001b[0m";

/** The terminal's size, with floors so a tiny pane still draws a frame. */
export function terminalSize(stdout) {
  return { columns: Math.max(MIN_COLUMNS, stdout.columns ?? 80), rows: Math.max(MIN_ROWS, stdout.rows ?? 24) };
}

/** Rows available to a screen's body for a terminal of `rows` rows (a gap before the footer when there is room). */
export function bodyRows(rows) {
  return Math.max(1, rows - FRAME_ROWS - (rows >= 16 ? 1 : 0));
}

/** The first item index shown so that `cursor` stays inside a viewport of `rows` items. */
export function viewportTop(top, cursor, rows) {
  if (cursor < top) return cursor;
  if (cursor >= top + rows) return cursor - rows + 1;
  return Math.max(0, top);
}

/** The help footer that fits `width`: the full wording when it fits, shorter variants otherwise. */
export function menuFooter(width, { top, shown, total }) {
  const range = total > shown ? `${top + 1}–${Math.min(total, top + shown)} of ${total}` : "";
  const suffix = range ? ` · ${range}` : "";
  return pickFit([
    `↑/↓ move · Enter select · r reload · Esc back · q quit${suffix}`,
    `↑↓ move · Enter · r reload · Esc back · q quit${suffix}`,
    `↑↓ Enter r Esc q${range ? ` · ${range}` : ""}`,
    "↑↓ Enter r Esc q",
  ], width);
}

export function textFooter(width, { offset, shown, total }) {
  const range = `${Math.min(total, offset + 1)}–${Math.min(total, offset + shown)} of ${total}`;
  return pickFit([
    `lines ${range} · ↑/↓ scroll · PgUp/PgDn page · Esc back · q quit`,
    `lines ${range} · ↑/↓ scroll · Esc back · q quit`,
    `${range} · ↑↓ Esc q`,
    "↑↓ Esc q",
  ], width);
}

export async function interactive(client, { stdin, stdout, stderr, colour = false }) {
  const stack = [];
  let outage = "";
  let notice = "";
  let prompting = false;
  let closed = false;
  let busy = false;
  let controller = null;
  let formLines = [];
  const write = (text) => stdout.write(text);
  const p = (text, tone) => paint(text, tone, colour);
  const bold = (text) => (colour ? `\u001b[1m${text}${RESET}` : text);

  // ---- frame ----
  /** Draws exactly `rows` rows: header, notice, title, blank, `body` (truncated rows), then the footer last. */
  function frame({ body, footer }) {
    const { columns, rows } = terminalSize(stdout);
    const connection = outage ? p(`RUNTIME OUTAGE · ${outage} Reconnecting; nothing is lost while this client waits.`, connectionTone.reconnecting) : `${p("connected", connectionTone.connected)} · ${client.baseUrl}`;
    const screen = stack.at(-1);
    const available = bodyRows(rows);
    const lines = [`luuna · ${connection}`, notice, screen ? screen.title : "", ""];
    const shown = body.slice(0, available);
    lines.push(...shown);
    while (lines.length < rows - 1) lines.push("");
    lines.push(footer);
    const drawn = lines.slice(0, rows).map((line) => `${ERASE_LINE}${truncate(line, columns)}`);
    write(`\u001b[H${drawn.join("\n")}`);
    return { columns, rows, available };
  }

  function render() {
    if (prompting || closed) return;
    const screen = stack.at(-1);
    if (!screen) return;
    const { columns, rows } = terminalSize(stdout);
    const available = bodyRows(rows);
    if (screen.text !== undefined) {
      const all = screenRows(screen, columns);
      screen.offset = Math.max(0, Math.min(screen.offset, all.length - available));
      frame({ body: all.slice(screen.offset, screen.offset + available), footer: textFooter(columns, { offset: screen.offset, shown: Math.min(available, all.length - screen.offset), total: all.length }) });
      return;
    }
    screen.top = viewportTop(screen.top ?? 0, screen.cursor, available);
    const items = screen.items.slice(screen.top, screen.top + available).map((item, index) => {
      const selected = screen.top + index === screen.cursor;
      const row = `${selected ? ">" : " "} ${item.label}${item.detail ? `  ${item.detail}` : ""}`;
      return selected ? bold(truncate(row, columns)) : row;
    });
    frame({ body: items.length ? items : ["  (nothing here)"], footer: menuFooter(columns, { top: screen.top, shown: available, total: screen.items.length }) });
  }

  /** A text screen's rows wrapped to the current width (cached per width, so scrolling is cheap). */
  function screenRows(screen, columns) {
    if (screen.wrappedFor !== columns) { screen.wrapped = wrapLines(screen.text, columns); screen.wrappedFor = columns; }
    return screen.wrapped;
  }

  async function push(screen) {
    stack.push({ cursor: 0, offset: 0, top: 0, items: [], ...screen });
    await reload();
  }

  async function reload() {
    const screen = stack.at(-1);
    if (screen.load) {
      try { screen.items = await screen.load(); screen.cursor = Math.min(screen.cursor, Math.max(0, screen.items.length - 1)); }
      catch (failure) { notice = explainFailure("Reload", failure).message; }
    }
    render();
  }

  // ---- prompts (raw mode off while a line is read; the question is drawn inside the frame) ----
  async function ask(question, { secret = false } = {}) {
    if (closed) throw new Error("Cancelled.");
    prompting = true;
    const { columns, promptRow } = frameForPrompt();
    write(`\u001b[${promptRow};1H${CLEAR_TO_END}${CURSOR_SHOW}`);
    stdin.setRawMode(false);
    const rl = createInterface({ input: stdin, output: stdout, terminal: !secret });
    try {
      const answer = await new Promise((resolve) => {
        rl.once("SIGINT", () => { quit(); resolve(""); });
        rl.question(`${truncate(question, Math.max(1, columns - 2))}: `, resolve);
      });
      if (closed) throw new Error("Cancelled.");
      formLines.push(`${question}: ${secret ? "(hidden)" : answer}`);
      return answer;
    } finally {
      rl.close();
      stdin.setRawMode(true);
      stdin.resume();
      write(CURSOR_HIDE);
      prompting = false;
    }
  }
  /**
   * Draws the form so far (answered questions) so the next question has its own row under them;
   * returns that row (1-based). The key hint sits on the notice row, above the question, because
   * readline clears everything below the cursor while it reads a line.
   */
  function frameForPrompt() {
    const { columns, rows } = terminalSize(stdout);
    const available = bodyRows(rows);
    const visible = formLines.slice(Math.max(0, formLines.length - available + 1));
    const hint = pickFit(["Enter submits · an empty line ends a list · Ctrl-C quits", "Enter submits · empty line ends a list", "Enter submits"], columns);
    const lines = [`luuna · ${outage ? p("RUNTIME OUTAGE", connectionTone.reconnecting) : p("connected", connectionTone.connected)} · ${client.baseUrl}`, hint, stack.at(-1)?.title ?? "", "", ...visible];
    while (lines.length < rows) lines.push("");
    write(`\u001b[H${lines.slice(0, rows).map((line) => `${ERASE_LINE}${truncate(line, columns)}`).join("\n")}`);
    return { columns, rows, promptRow: FRAME_ROWS + visible.length };
  }
  async function askLines(question) {
    formLines.push(question);
    const lines = [];
    for (;;) { const line = await ask(`  ${lines.length + 1}`); if (!line.trim()) return lines; lines.push(line); }
  }
  const confirm = async (question) => /^y(es)?$/i.test((await ask(`${question} (yes/no)`)).trim());

  async function collect(command, context) {
    const args = [];
    for (const arg of command.args) {
      if (arg.context) { if (context[arg.name] === undefined) throw new Error(`No ${arg.name} selected.`); args.push(context[arg.name]); continue; }
      args.push(await ask(arg.prompt ?? arg.name));
    }
    const flags = {};
    for (const [name, flag] of Object.entries(command.flags)) {
      if (!flag.prompt) continue;
      if (flag.boolean) flags[name] = await confirm(flag.prompt);
      else if (flag.multiline) { const lines = await askLines(flag.prompt); if (lines.length) flags[name] = lines; }
      else { const value = await ask(flag.prompt); if (value.trim()) flags[name] = flag.repeat ? [value] : value; }
    }
    return { args, flags };
  }

  async function perform(command, context) {
    let captured = "";
    controller = new AbortController();
    formLines = [];
    const io = makeIo({ stdin, stdout: { write: (text) => { captured += text; return true; } }, stderr: { write: (text) => { captured += text; return true; } }, interactive: true, colour, signal: controller.signal, prompt: (question) => ask(question), confirm, show: (text) => { captured += `${text}\n`; } });
    let input;
    try { input = await collect(command, context); } catch (failure) { notice = failure.message; render(); return; }
    // The same explanation as the non-interactive mode and the desktop: "<Action> refused: …".
    await runCommand(command, input, client, io);
    if (closed) return;
    const parent = stack.at(-1);
    await push({ title: `${command.action} (${command.name})`, text: captured.trimEnd() || "Done." });
    if (parent.load && command.id !== "runs.stream") parent.items = await parent.load().catch(() => parent.items);
  }

  const commandItems = (context, ids) => byContext(context).map((command) => ({ label: command.action, detail: `${command.name} · ${title(command)}`, select: () => perform(command, ids) }));

  const projectScreen = (project) => ({
    title: `Project ${project.id}`,
    load: async () => [
      { label: "Tickets, plans and candidates ›", select: () => push(ticketsScreen(project)) },
      { label: "Runs of this project ›", select: () => push(runsScreen(project.id)) },
      ...commandItems("project", { project: project.id }),
    ],
  });
  const ticketsScreen = (project) => ({
    title: `Tickets of ${project.id}`,
    load: async () => (await client.listTickets(project.id)).map((ticket) => ({ label: `${ticket.title}`, detail: `${ticket.id} r${ticket.revision} ${ticket.source}`, select: () => push(ticketScreen(ticket)) })),
  });
  const ticketScreen = (ticket) => ({
    title: `Ticket ${ticket.id} · ${ticket.title}`,
    load: async () => [
      { label: "Plan revisions ›", select: () => push(plansScreen(ticket)) },
      ...commandItems("ticket", { ticket: ticket.id }),
    ],
  });
  const plansScreen = (ticket) => ({
    title: `Plan revisions of ${ticket.id}`,
    load: async () => (await client.listPlans(ticket.id)).map((plan) => ({ label: `r${plan.revision} ${plan.id}`, detail: plan.hash, select: () => push(planScreen(plan)) })),
  });
  const planScreen = (plan) => ({
    title: `Plan ${plan.id} r${plan.revision}`,
    load: async () => [
      { label: "Workflow run of this revision ›", select: async () => { const run = (await client.listRuns(undefined, { limit: 200 })).find((candidate) => candidate.metadata?.plan_id === plan.id && candidate.metadata?.plan_revision === plan.revision); if (run) await push(runScreen(run)); else { notice = "No workflow run exists for this revision yet."; render(); } } },
      ...commandItems("plan", { plan: plan.id }),
    ],
  });
  const runsScreen = (projectId) => ({
    title: projectId ? `Runs of ${projectId}` : "Runs (newest first)",
    load: async () => (await client.listRuns(undefined, { limit: 200 })).filter((run) => !projectId || run.project_id === projectId).map((run) => ({ label: runLine(run, { colour }), select: () => push(runScreen(run)) })),
  });
  const runScreen = (run) => ({ title: `Run ${run.id}`, load: async () => commandItems("run", { run: run.id }) });
  const projectsScreen = () => ({
    title: "Projects",
    load: async () => (await client.listProjects()).map((project) => ({ label: project.name, detail: `${project.id} · ${project.revision > 0 ? `manifest r${project.revision}` : p("unconfirmed", "attention")}`, select: () => push(projectScreen(project)) })),
  });
  const mainScreen = () => ({
    title: "Workbench",
    load: async () => [
      // The experience projections (docs/09-experience.md): read-only views the desktop shows as Home and Kanban.
      ...PROJECTIONS.map((command) => ({ label: command.action, detail: command.name, select: () => perform(command, {}) })),
      { label: "Projects ›", select: () => push(projectsScreen()) },
      { label: "Runs ›", select: () => push(runsScreen()) },
      ...commandItems("runtime", {}),
    ],
  });

  // ---- outage detection and self-reconnection ----
  const poll = setInterval(async () => {
    try {
      await client.health();
      if (outage) { outage = ""; notice = "The runtime answers again; this view was reloaded from its authoritative state."; await reload(); }
    } catch (failure) {
      const message = describeFailure(failure);
      if (message !== outage) { outage = message; render(); }
    }
  }, HEALTH_INTERVAL_MS);

  // ---- keys ----
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const quit = () => { closed = true; controller?.abort(); resolveDone(0); };
  const onKey = async (_text, key) => {
    if (prompting || !key) return;
    if (key.name === "q" || (key.ctrl && key.name === "c")) return quit();
    if (busy) { if (key.name === "escape") controller?.abort(); return; }
    const screen = stack.at(-1);
    if (!screen) return;
    const { columns, rows } = terminalSize(stdout);
    const available = bodyRows(rows);
    if (screen.text !== undefined) {
      const total = screenRows(screen, columns).length;
      const last = Math.max(0, total - available);
      if (key.name === "down" || key.name === "j") screen.offset = Math.min(last, screen.offset + 1);
      if (key.name === "up" || key.name === "k") screen.offset = Math.max(0, screen.offset - 1);
      if (key.name === "pagedown" || key.name === "space") screen.offset = Math.min(last, screen.offset + available);
      if (key.name === "pageup") screen.offset = Math.max(0, screen.offset - available);
      if (key.name === "home") screen.offset = 0;
      if (key.name === "end") screen.offset = last;
      if (key.name === "escape" || key.name === "backspace" || key.name === "left" || key.name === "h" || key.name === "return") stack.pop();
      render();
      return;
    }
    if (key.name === "down" || key.name === "j") screen.cursor = Math.min(Math.max(0, screen.items.length - 1), screen.cursor + 1);
    else if (key.name === "up" || key.name === "k") screen.cursor = Math.max(0, screen.cursor - 1);
    else if (key.name === "pagedown") screen.cursor = Math.min(Math.max(0, screen.items.length - 1), screen.cursor + available);
    else if (key.name === "pageup") screen.cursor = Math.max(0, screen.cursor - available);
    else if (key.name === "home") screen.cursor = 0;
    else if (key.name === "end") screen.cursor = Math.max(0, screen.items.length - 1);
    else if (key.name === "escape" || key.name === "backspace" || key.name === "left" || key.name === "h") { if (stack.length > 1) stack.pop(); }
    else if (key.name === "r") { notice = ""; busy = true; await reload(); busy = false; return; }
    else if (key.name === "return" || key.name === "right" || key.name === "l") {
      const item = screen.items[screen.cursor];
      if (!item) return;
      busy = true;
      notice = "";
      try { await item.select(); } catch (failure) { notice = explainFailure("Action", failure).message; }
      busy = false;
      controller = null;
    }
    render();
  };
  stdin.on("keypress", onKey);
  const onResize = () => { if (!prompting) render(); };
  stdout.on("resize", onResize);

  write(`${ALT_SCREEN_ON}${CURSOR_HIDE}`);
  try {
    await push(mainScreen());
    return await done;
  } finally {
    closed = true;
    clearInterval(poll);
    stdin.off("keypress", onKey);
    stdout.off("resize", onResize);
    stdin.setRawMode(false);
    stdin.pause();
    write(`${RESET}${CURSOR_SHOW}${ALT_SCREEN_OFF}`);
    if (stderr && outage) stderr.write(`Left while the runtime was unreachable: ${outage}\n`);
  }
}
