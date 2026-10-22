// The interactive workbench: keyboard-driven menus over the same command table as the
// non-interactive mode, so every cataloged action is reachable from a list. State is always
// re-read from the runtime (no local domain rules); an outage is shown in the header while the
// client polls /health, and every list reloads when the runtime answers again.
import { createInterface, emitKeypressEvents } from "node:readline";
import { describeFailure, explainFailure } from "@luuna/api-client";
import { COMMANDS, PROJECTIONS } from "./commands.mjs";
import { catalog } from "./catalog.mjs";
import { makeIo, runCommand } from "./cli.mjs";
import { runLine } from "./format.mjs";

const title = (command) => catalog.capabilities.find((capability) => capability.id === command.id)?.title ?? command.name;
const byContext = (context) => COMMANDS.filter((command) => command.context === context);
const HEALTH_INTERVAL_MS = 2000;

export async function interactive(client, { stdin, stdout, stderr }) {
  const stack = [];
  let outage = "";
  let notice = "";
  let prompting = false;
  let closed = false;
  const write = (text) => stdout.write(text);

  // ---- screens ----
  function render() {
    if (prompting || closed) return;
    const screen = stack.at(-1);
    const connection = outage ? `RUNTIME OUTAGE · ${outage} Reconnecting; nothing is lost while this client waits.` : `connected · ${client.baseUrl}`;
    const lines = ["\u001b[2J\u001b[H", `luuna · ${connection}`, notice ? `${notice}` : "", `${screen.title}`, ""];
    if (screen.text !== undefined) {
      const rows = Math.max(5, (stdout.rows ?? 30) - 8);
      const all = screen.text.split("\n");
      lines.push(...all.slice(screen.offset, screen.offset + rows));
      lines.push("", `lines ${screen.offset + 1}–${Math.min(all.length, screen.offset + rows)} of ${all.length} · ↑/↓ scroll · Esc back · q quit`);
    } else {
      screen.items.forEach((item, index) => lines.push(`${index === screen.cursor ? ">" : " "} ${item.label}${item.detail ? `  ${item.detail}` : ""}`));
      if (!screen.items.length) lines.push("  (nothing here)");
      lines.push("", "↑/↓ move · Enter select · r reload · Esc back · q quit");
    }
    write(`${lines.filter((line) => line !== undefined).join("\n")}\n`);
  }

  async function push(screen) {
    stack.push({ cursor: 0, offset: 0, items: [], ...screen });
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

  // ---- prompts (raw mode off while a line is read) ----
  async function ask(question, { secret = false } = {}) {
    prompting = true;
    stdin.setRawMode(false);
    const rl = createInterface({ input: stdin, output: stdout, terminal: !secret });
    try {
      return await new Promise((resolve) => rl.question(`${question}: `, resolve));
    } finally {
      rl.close();
      stdin.setRawMode(true);
      stdin.resume();
      prompting = false;
    }
  }
  async function askLines(question) {
    write(`${question}\n`);
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
    const io = makeIo({ stdin, stdout: { write: (text) => { captured += text; return true; } }, stderr: { write: (text) => { captured += text; return true; } }, interactive: true, prompt: (question) => ask(question), confirm, show: (text) => { captured += `${text}\n`; } });
    let input;
    try { input = await collect(command, context); } catch (failure) { notice = failure.message; render(); return; }
    // The same explanation as the non-interactive mode and the desktop: "<Action> refused: …".
    await runCommand(command, input, client, io);
    const parent = stack.at(-1);
    await push({ title: `${title(command)} (${command.name})`, text: captured.trimEnd() || "Done." });
    if (parent.load && command.id !== "runs.stream") parent.items = await parent.load().catch(() => parent.items);
  }

  const commandItems = (context, ids) => byContext(context).map((command) => ({ label: title(command), detail: command.name, select: () => perform(command, ids) }));

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
    load: async () => (await client.listRuns(undefined, { limit: 200 })).filter((run) => !projectId || run.project_id === projectId).map((run) => ({ label: runLine(run), select: () => push(runScreen(run)) })),
  });
  const runScreen = (run) => ({ title: `Run ${run.id}`, load: async () => commandItems("run", { run: run.id }) });
  const projectsScreen = () => ({
    title: "Projects",
    load: async () => (await client.listProjects()).map((project) => ({ label: project.name, detail: `${project.id} · ${project.revision > 0 ? `manifest r${project.revision}` : "unconfirmed"}`, select: () => push(projectScreen(project)) })),
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
  let busy = false;
  const done = new Promise((resolve) => {
    stdin.on("keypress", async (_text, key) => {
      if (prompting || busy || !key) return;
      const screen = stack.at(-1);
      const quit = () => { closed = true; resolve(0); };
      if (key.name === "q" || (key.ctrl && key.name === "c")) return quit();
      if (screen.text !== undefined) {
        const rows = Math.max(5, (stdout.rows ?? 30) - 8);
        const total = screen.text.split("\n").length;
        if (key.name === "down" || key.name === "j") screen.offset = Math.min(Math.max(0, total - rows), screen.offset + 1);
        if (key.name === "up" || key.name === "k") screen.offset = Math.max(0, screen.offset - 1);
        if (key.name === "pagedown" || key.name === "space") screen.offset = Math.min(Math.max(0, total - rows), screen.offset + rows);
        if (key.name === "pageup") screen.offset = Math.max(0, screen.offset - rows);
        if (key.name === "escape" || key.name === "backspace" || key.name === "left" || key.name === "h" || key.name === "return") stack.pop();
        render();
        return;
      }
      if (key.name === "down" || key.name === "j") screen.cursor = Math.min(screen.items.length - 1, screen.cursor + 1);
      else if (key.name === "up" || key.name === "k") screen.cursor = Math.max(0, screen.cursor - 1);
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
      }
      render();
    });
  });

  try {
    await push(mainScreen());
    return await done;
  } finally {
    clearInterval(poll);
    stdin.setRawMode(false);
    stdin.pause();
    write("\n");
    if (stderr && notice && closed) stderr.write("");
  }
}
