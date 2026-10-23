// The command-line help: an overview grouped by what the developer is doing, a page per command
// (arguments, flags, the cataloged route and an example), and the complete reference. Everything
// is read from the command table and the catalog, so a new command is documented by its own
// descriptions; the groups below only decide where it is listed (an unlisted command lands in
// "Other commands", never nowhere). Presentation only: nothing here decides what is allowed.
import { catalog } from "./catalog.mjs";
import { COMMANDS, PROJECTIONS, commandsByName } from "./commands.mjs";
import { visibleWidth, wrap } from "./text.mjs";

export const DEFAULT_NAME = "luuna-tui";

/** Display groups, in workflow order. Each command is listed once. */
export const HELP_GROUPS = [
  { title: "Start here", blurb: "Is the runtime up, and what needs attention?", commands: ["health", "home", "board", "doctor"] },
  { title: "Projects", blurb: "Register repositories, confirm their manifest and record a baseline.", commands: ["projects", "project", "register", "discover", "confirm", "baseline", "baselines", "rebind", "project-events", "propose-scaffold", "scaffold", "export", "import"] },
  { title: "Orbit and sandbox", blurb: "Every repository of a project at once, and a shell that reaches only them (ADR 0036).", commands: ["orbit", "orbit-exec", "orbit-run", "orbit-sync", "sbx"] },
  { title: "Tickets", blurb: "Work items, kept in the project's authoritative source (Missions when enabled).", commands: ["tickets", "create-ticket", "show-ticket", "edit-ticket", "ticket-source", "reconcile-ticket"] },
  { title: "Plans and approval", blurb: "Immutable plan revisions; approval binds to one exact hash.", commands: ["plan", "plans", "show-plan", "approve"] },
  { title: "Runs and candidates", blurb: "Implement, follow, validate and review a candidate.", commands: ["runs", "run", "events", "follow", "implement", "candidate", "diff", "validate", "repair", "tasks", "attempts", "worktrees", "artifact", "cancel"] },
  { title: "Publication", blurb: "Push the reviewed commits and open pull requests; merging stays yours.", commands: ["publish", "publication", "reconcile-publication", "publication-repair"] },
  { title: "Memory (Atlas)", blurb: "Scoped project knowledge with provenance; changes bind to exact hashes.", commands: ["components", "enable-components", "memory", "remember", "correct-memory", "promote", "forget", "retention", "set-retention", "apply-retention", "export-user-memory"] },
  { title: "Prompts (Beacon)", blurb: "Versioned prompts selected into plans.", commands: ["prompts", "save-prompt", "render-prompt"] },
  { title: "Runtime", blurb: "Isolated sessions and the service itself.", commands: ["start-session", "shutdown"] },
];

/** The component CLIs the launcher runs directly (scripts/start-terminal.ps1); their own help is authoritative. */
export const COMPONENT_CLIS = [
  { name: "missions", alias: "lms", what: "Tickets and structured plans", store: ".luuna/missions/", key: ["init", "create", "list", "ready", "show", "update", "close", "dep", "plan", "sync", "doctor"] },
  { name: "atlas", alias: "lat", what: "Expertise and project memory", store: ".luuna/atlas/", key: ["init", "add", "record", "query", "search", "prime", "status", "prune", "sync", "doctor"] },
  { name: "beacon", alias: "lbc", what: "Composable prompts", store: ".luuna/beacon/", key: ["init", "create", "list", "show", "update", "render", "history", "diff", "pin", "sync"] },
];

const CONTEXT_ARGS = {
  project: "project id (see projects)",
  ticket: "ticket id (see tickets <project>)",
  plan: "plan id (see plans <ticket>)",
  run: "run id (see runs)",
};

const STYLE = { heading: "1", name: "36", dim: "2", accent: "33" };
const style = (options) => (text, kind) => (options.colour && STYLE[kind] ? `\u001b[${STYLE[kind]}m${text}\u001b[0m` : String(text));

const capability = (command) => catalog.capabilities.find((entry) => entry.id === command.id);
const titleOf = (command) => capability(command)?.title ?? command.title ?? `${command.action}: reads ${command.projects?.join(", ") ?? ""}`;

/** The groups with every command placed; commands no group names are collected last. */
export function groupedCommands() {
  const all = [...COMMANDS, ...PROJECTIONS];
  const placed = new Set();
  const groups = HELP_GROUPS.map((group) => ({ ...group, commands: group.commands.map((name) => commandsByName.get(name)).filter(Boolean) }));
  for (const group of groups) for (const command of group.commands) placed.add(command.name);
  const rest = all.filter((command) => !placed.has(command.name));
  if (rest.length) groups.push({ title: "Other commands", blurb: "", commands: rest });
  return groups;
}

/** `text` wrapped to `width` with every row after the first indented by `indent` columns. */
function hanging(prefix, text, width, indent) {
  const room = Math.max(20, width - indent);
  const first = visibleWidth(prefix) > indent ? null : prefix + " ".repeat(indent - visibleWidth(prefix));
  const rows = wrap(String(text), room);
  if (first === null) return [prefix, ...rows.map((row) => " ".repeat(indent) + row)];
  return rows.map((row, index) => (index === 0 ? first : " ".repeat(indent)) + row);
}

/** `text` indented two columns, its continuation rows four. */
function indented(text, width) {
  return wrap(String(text), width - 4).map((row, index) => (index ? "    " : "  ") + row);
}

/** A section heading with its blurb beside it when both fit, else the blurb wrapped below it. */
function heading(s, title, blurb, width) {
  if (!blurb) return [s(title, "heading")];
  if (title.length + 2 + visibleWidth(blurb) <= width) return [`${s(title, "heading")}  ${s(blurb, "dim")}`];
  return [s(title, "heading"), ...wrap(blurb, width - 2).map((row) => `  ${s(row, "dim")}`)];
}

const positional = (command) => command.args.map((arg) => `<${arg.name}>`).join(" ");
const quote = (value) => (/^[\w@%+=:,./\\-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`);
const shownValue = (value) => String(value).replace(/sha256:[a-f0-9]{64}/g, "sha256:<hash>");

/** A runnable-looking example from the command's parity example. */
export function exampleLine(command, name = DEFAULT_NAME) {
  const parts = [name, command.name, ...command.example.args.map((value) => quote(shownValue(value)))];
  for (const [flag, value] of Object.entries(command.example.flags)) {
    if (flag === "key") continue;
    for (const item of Array.isArray(value) ? value : [value]) parts.push(item === true ? `--${flag}` : `--${flag} ${quote(shownValue(item))}`);
  }
  return parts.join(" ");
}

function widthOf(options) {
  return Math.max(48, Math.min(options.width ?? 100, 110));
}

/** The overview printed by `help`, `-h` and `--help`. */
export function overview(options = {}) {
  const name = options.name ?? DEFAULT_NAME;
  const width = widthOf(options);
  const s = style(options);
  const out = [];
  out.push(`${s("Luuna", "heading")} ${s("— terminal client for the Luuna runtime", "dim")}`, "");
  out.push(s("USAGE", "heading"));
  for (const [left, right] of [
    [name, "open the interactive workbench (keyboard driven)"],
    [`${name} <command> [args] [flags]`, "run one action against the runtime"],
    [`${name} <command> --help`, "arguments, flags and an example for one command"],
    [`${name} help --all`, "the complete reference, every flag included"],
    [`${name} missions|atlas|beacon …`, "run a component CLI directly (see COMPONENTS)"],
  ]) out.push(...hanging(`  ${s(left, "name")}`, right, width, 38));

  const groups = groupedCommands();
  const column = Math.min(34, 4 + Math.max(...groups.flatMap((group) => group.commands.map((command) => visibleWidth(`${command.name} ${positional(command)}`)))));
  for (const group of groups) {
    out.push("", ...heading(s, group.title.toUpperCase(), group.blurb, width));
    for (const command of group.commands) {
      const args = positional(command);
      out.push(...hanging(`  ${s(command.name, "name")}${args ? ` ${args}` : ""}`, titleOf(command), width, column));
    }
  }

  out.push("", ...heading(s, "COMPONENTS", "The pinned CLIs, run directly in the current directory. No runtime, no approval.", width));
  for (const component of COMPONENT_CLIS) {
    out.push(...hanging(`  ${s(`${name} ${component.name}`, "name")} ${s(`(${component.alias})`, "dim")}`, `${component.what} in ${component.store}`, width, column));
    out.push(...hanging("", s(component.key.join(" · "), "dim"), width, column));
  }
  out.push(...hanging("", `Each has many more commands: ${name} missions --help. Tickets edited outside Luuna are brought back with reconcile-ticket.`, width, 2));

  out.push("", s("FLAGS", "heading"));
  out.push(...hanging(`  ${s("--json", "name")}`, "print the runtime's record unchanged (for scripts)", width, column));
  out.push(...hanging(`  ${s("-h, --help", "name")}`, "show help; after a command, that command's help", width, column));

  out.push("", s("ENVIRONMENT", "heading"));
  out.push(...hanging(`  ${s("LUUNA_URL", "name")}`, "runtime address, loopback only (default http://127.0.0.1:4242)", width, column));
  out.push(...hanging(`  ${s("LUUNA_API_TOKEN", "name")}`, "service token; never echoed, prompted hidden on a terminal when missing", width, column));
  out.push(...hanging(`  ${s("NO_COLOR", "name")}`, "set to print without colour", width, column));

  out.push("", ...wrap(`Every command is one action of schemas/capability-catalog.json (${name} catalog prints it).`, width).map((row) => s(row, "dim")), "");
  return out.join("\n");
}

/** The page of one command: what it does, its arguments and flags, the route it calls and an example. */
export function commandHelp(command, options = {}) {
  const name = options.name ?? DEFAULT_NAME;
  const width = widthOf(options);
  const s = style(options);
  const entry = capability(command);
  const flags = Object.entries(command.flags);
  const out = [];
  const args = positional(command);
  out.push(...hanging(s(`${name} ${command.name}`, "name"), `${args}${flags.length ? " [flags]" : ""}`.trim(), width, visibleWidth(`${name} ${command.name} `)).map((row) => row.trimEnd()), "");
  out.push(...hanging("  ", titleOf(command), width, 2));
  if (command.confirm) out.push(...hanging("  ", s(`Asks first: ${command.confirm}`, "accent"), width, 2));

  if (command.args.length) {
    out.push("", s("ARGUMENTS", "heading"));
    const column = Math.min(30, 4 + Math.max(...command.args.map((arg) => arg.name.length + 2)));
    for (const arg of command.args) out.push(...hanging(`  <${arg.name}>`, arg.description ?? CONTEXT_ARGS[arg.name] ?? arg.name, width, column));
  }

  out.push("", s("FLAGS", "heading"));
  const labels = [...flags.map(([flag, definition]) => [flag, definition, definition.boolean ? `--${flag}` : `--${flag} <value>`]), ["json", { description: "print the runtime's record unchanged" }, "--json"]];
  const column = Math.min(30, 4 + Math.max(...labels.map(([, , label]) => label.length)));
  for (const [, definition, label] of labels) out.push(...hanging(`  ${s(label, "name")}`, `${definition.description ?? ""}${definition.repeat && !/repeatable/.test(definition.description ?? "") ? " (repeatable)" : ""}`, width, column));

  if (entry) {
    out.push("", s("RUNTIME", "heading"));
    out.push(...indented(`${entry.method} ${entry.route}  ${s(`· catalog ${entry.id}`, "dim")}`, width));
  } else if (command.projects) {
    out.push("", s("READS", "heading"));
    out.push(...hanging("  ", command.projects.join(", "), width, 2));
  }

  out.push("", s("EXAMPLE", "heading"));
  out.push(...indented(exampleLine(command, name), width));
  out.push("");
  return out.join("\n");
}

/** Every command page, grouped as in the overview. */
export function reference(options = {}) {
  const s = style(options);
  const parts = [overview(options)];
  for (const group of groupedCommands()) {
    parts.push(`${s(`━━ ${group.title} `, "heading")}\n`);
    for (const command of group.commands) parts.push(commandHelp(command, options));
  }
  return parts.join("\n");
}

/** The closest command names to a mistyped one (edit distance at most 2, or a shared prefix). */
export function suggestions(word) {
  const distance = (a, b) => {
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const kept = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = kept;
      }
    }
    return row[b.length];
  };
  return [...commandsByName.keys()]
    .map((candidate) => ({ candidate, score: distance(word, candidate) - (candidate.startsWith(word) || word.startsWith(candidate) ? 2 : 0) }))
    .filter(({ score }) => score <= 2)
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}
