// One command per catalog entry (schemas/capability-catalog.json). A command is reachable in the
// interactive workbench (through its `context` menu) and as `luuna-tui <name> [args] [--flags]`.
//
// Adding a product action: add its catalog entry, then one object here whose `id` is the catalog
// id and whose `name` is the catalog's `tui` command. `example` is the input the parity test runs
// against a mocked fetch to prove the command issues the cataloged method and route.
import { randomUUID } from "node:crypto";
import { boardProjection, homeSummary, planRequestForTasks, readEventPages, registerProjectRequest } from "@luuna/api-client";

const HASH = `sha256:${"a".repeat(64)}`;

/** Text limits the runtime enforces, in UTF-8 bytes (the same table as the desktop). */
export const TEXT_LIMITS = { title: 200, intent: 16_000, criterion: 16_000, approver: 200 };

function integer(value, name, { min = 0 } = {}) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min) throw new UsageError(`--${name} must be an integer of at least ${min}.`);
  return number;
}

function list(value) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function modelSettings(flags) {
  return { ...(flags.provider && { provider: String(flags.provider) }), ...(flags.model && { model: String(flags.model) }) };
}

/** A problem with the command line itself (exit code 2), never a runtime refusal. */
export class UsageError extends Error {
  constructor(message) { super(message); this.name = "UsageError"; }
}

/** The runtime refused nothing; the client declined to send the request (exit code 1). */
export class ClientRefusal extends Error {
  constructor(message) { super(message); this.name = "ClientRefusal"; }
}

/** Reads a document argument: a file path, or `-` for standard input. */
async function document(io, source) {
  if (source === "-") return io.readStdin();
  return io.readFile(String(source));
}

/** The exact hash the developer acknowledged, from `--acknowledge-hash` or typed interactively. */
async function acknowledgedHash(io, flags, plan) {
  if (flags["acknowledge-hash"] !== undefined) return String(flags["acknowledge-hash"]).trim();
  if (!io.interactive) throw new UsageError(`Approval requires the complete plan hash. Review plan ${plan.id} r${plan.revision} (show-plan ${plan.id}), then approve it with --acknowledge-hash ${plan.hash}`);
  io.show(formatPlan(plan));
  return (await io.prompt("Type the complete plan hash to approve it (empty cancels)")).trim();
}

function formatPlan(plan) {
  return `Plan ${plan.id} revision ${plan.revision}\nImmutable plan hash: ${plan.hash}\n${JSON.stringify(plan, null, 2)}`;
}

async function candidateHash(client, runId, flags, signal) {
  if (flags["candidate-hash"] !== undefined) return String(flags["candidate-hash"]).trim();
  const view = await client.candidate(runId, signal);
  if (!view.evidence) throw new ClientRefusal("No candidate is recorded for this run yet; the writer has not settled.");
  return view.evidence.candidate.hash;
}

export const COMMANDS = [
  // ---- runtime ----
  { id: "health", name: "health", action: "Connection", context: "runtime", args: [], flags: {}, example: { args: [], flags: {} },
    run: (client, _input, io) => client.health(io.signal) },
  { id: "runs.list", name: "runs", action: "Run listing", context: "runtime", args: [],
    flags: { limit: { description: "at most this many runs (default 200)" }, project: { description: "only this project's runs" }, before: { description: "the page of older runs before this run id" } },
    example: { args: [], flags: { limit: "50" } },
    run: (client, { flags }, io) => flags.before || flags.project ? client.runsPage(flags.before && String(flags.before), flags.project && String(flags.project), io.signal) : client.listRuns(io.signal, { limit: integer(flags.limit, "limit", { min: 1 }) ?? 200 }) },
  { id: "runs.start", name: "start-session", action: "Session start", context: "runtime", args: [{ name: "prompt", description: "the prompt for an isolated Pi session (no repository tools)", prompt: "Prompt" }],
    flags: { provider: { description: "provider override" }, model: { description: "model override" } },
    example: { args: ["Say hello"], flags: {} },
    run: (client, { args, flags }, io) => client.startRun({ prompt: args[0], ...modelSettings(flags) }, io.signal) },
  { id: "shutdown", name: "shutdown", action: "Shutdown", context: "runtime", args: [], flags: {}, example: { args: [], flags: {} }, confirm: "Stop the runtime? Runs, candidates and worktrees stay durable; start it again with the same data directory and token.",
    run: (client, _input, io) => client.shutdown(io.signal) },

  // ---- projects ----
  { id: "projects.list", name: "projects", action: "Project listing", context: "runtime", args: [], flags: {}, example: { args: [], flags: {} },
    run: (client, _input, io) => client.listProjects(io.signal) },
  { id: "projects.register", name: "register", action: "Registration", context: "runtime",
    args: [{ name: "name", description: "project name", prompt: "Project name" }, { name: "repository-id", description: "first repository id (for example app)", prompt: "Repository id" }, { name: "path", description: "absolute path of that repository root", prompt: "Repository root path" }],
    flags: { id: { description: "project id (derived from the name when omitted)" }, repository: { repeat: true, description: "another repository of the project as <id>=<absolute path> (repeatable)", prompt: "Further repositories as <id>=<path> (one per line; empty line ends)", multiline: true } },
    example: { args: ["Walkthrough", "app", "/srv/walkthrough"], flags: { id: "walkthrough" } },
    run: (client, { args, flags }, io) => {
      const extra = list(flags.repository).map((spec) => {
        const match = /^([^=]+)=(.+)$/.exec(String(spec).trim());
        if (!match) throw new UsageError("--repository takes <id>=<absolute path>");
        return { id: match[1], path: match[2] };
      });
      let request;
      try { request = registerProjectRequest(args[0], [{ id: args[1], path: args[2] }, ...extra], flags.id ? String(flags.id) : undefined); } catch (failure) { throw new ClientRefusal(failure.message); }
      return client.registerProject(request, io.signal);
    } },
  { id: "projects.scaffold.propose", name: "propose-scaffold", action: "Scaffold proposal", context: "runtime",
    args: [{ name: "profile", description: "node, node-typescript, react, nextjs, python, go, rust, flutter, android or ios", prompt: "Stack profile" }, { name: "name", description: "project id (^[a-z][a-z0-9-]{0,63}$)", prompt: "Project name" }, { name: "parent-dir", description: "absolute existing directory the project is created under", prompt: "Parent directory" }],
    flags: {}, example: { args: ["python", "fresh", "C:\\projects"], flags: {} },
    run: (client, { args }, io) => client.proposeScaffold({ profile: args[0], name: args[1], parent_dir: args[2] }, io.signal) },
  { id: "projects.scaffold", name: "scaffold", action: "Scaffolding", context: "runtime",
    args: [{ name: "proposal-hash", description: "the exact proposal hash from propose-scaffold", prompt: "Proposal hash (sha256:…)" }],
    flags: { "confirm-network": { boolean: true, description: "confirms the proposal's declared network steps (for example npm install)" }, key: { description: "idempotency key (generated when omitted)" } },
    example: { args: [HASH], flags: { key: "k10" } },
    run: (client, { args, flags }, io) => client.scaffold({ proposal_hash: args[0], idempotency_key: flags.key ? String(flags.key) : randomUUID(), confirm: true, ...(flags["confirm-network"] && { confirm_network: true }) }, io.signal) },
  { id: "projects.show", name: "project", action: "Project inspection", context: "project", args: [{ name: "project", context: true }], flags: {}, example: { args: ["walkthrough"], flags: {} },
    run: (client, { args }, io) => client.project(args[0], io.signal) },
  { id: "projects.discover", name: "discover", action: "Discovery", context: "project", args: [{ name: "project", context: true }], flags: {}, example: { args: ["walkthrough"], flags: {} },
    run: (client, { args }, io) => client.discover(args[0], io.signal) },
  { id: "projects.manifest.confirm", name: "confirm", action: "Manifest confirmation", context: "project",
    args: [{ name: "project", context: true }, { name: "manifest", description: "path of the manifest JSON to confirm, or - for standard input", prompt: "Manifest file path" }],
    flags: { revision: { description: "the project's current manifest revision (read from the project when omitted)" } },
    example: { args: ["walkthrough", "-"], flags: { revision: "0" } },
    run: async (client, { args, flags }, io) => {
      let manifest;
      try { manifest = JSON.parse(await document(io, args[1])); } catch { throw new ClientRefusal("The manifest draft is not valid JSON."); }
      if (!manifest || typeof manifest !== "object") throw new ClientRefusal("The manifest draft must be a JSON object.");
      const revision = integer(flags.revision, "revision") ?? (await client.project(args[0], io.signal)).project.revision;
      return client.confirmManifest(args[0], revision, manifest, io.signal);
    } },
  { id: "projects.repositories.rebind", name: "rebind", action: "Rebind", context: "project",
    args: [{ name: "project", context: true }, { name: "repository", description: "repository id", prompt: "Repository id" }],
    flags: { path: { description: "the new repository root path (the registered path is re-inspected when omitted)", prompt: "New repository root path (empty re-inspects the registered path)" }, confirm: { boolean: true, description: "confirms that the checkout was moved or re-identified on purpose", prompt: "I moved this checkout or changed its remote on purpose (yes/no)" } },
    example: { args: ["walkthrough", "app"], flags: { confirm: true } },
    run: (client, { args, flags }, io) => {
      if (!flags.confirm) throw new ClientRefusal("Rebinding re-points plans, baselines and approvals to another checkout identity. Repeat with --confirm to state that the move or the new remote is intended.");
      return client.rebindRepository(args[0], args[1], flags.path ? { local_path: String(flags.path) } : {}, io.signal);
    } },
  { id: "projects.export", name: "export", action: "Project export", context: "project", args: [{ name: "project", context: true }],
    flags: { output: { description: "write the export JSON to this file instead of printing it" } },
    example: { args: ["walkthrough"], flags: {} },
    run: async (client, { args, flags }, io) => {
      const exported = await client.exportProject(args[0], io.signal);
      if (flags.output) { await io.writeFile(String(flags.output), JSON.stringify(exported, null, 2) + "\n"); return { written: String(flags.output), omitted: exported.omitted, tickets: exported.tickets.length, memory: exported.memory.length, prompts: exported.prompts.length }; }
      return exported;
    } },
  { id: "projects.import", name: "import", action: "Project import", context: "runtime",
    args: [{ name: "export", description: "path of the export JSON from the other machine, or - for standard input", prompt: "Export file path" }, { name: "repository-id", description: "exported repository id (for example app)", prompt: "Repository id" }, { name: "path", description: "absolute path of this machine's checkout of that repository", prompt: "Repository root path" }],
    flags: { key: { description: "idempotency key (derived from the export hash when omitted; the same key replays)" } },
    example: { args: ["luuna-walkthrough-export.json", "app", "/srv/walkthrough"], flags: {} },
    run: async (client, { args, flags }, io) => {
      let exported;
      try { exported = JSON.parse(await document(io, args[0])); } catch { throw new ClientRefusal("The export document is not valid JSON."); }
      if (!exported || typeof exported !== "object" || exported.kind !== "luuna-project-export") throw new ClientRefusal("The document is not a Luuna project export; pass the JSON that `export` wrote on the other machine.");
      const key = flags.key ? String(flags.key) : `import-${String(exported.export_hash ?? "").slice(7, 31) || randomUUID()}`;
      return client.importProject({ export: exported, repositories: [{ id: args[1], path: args[2] }], idempotency_key: key }, io.signal);
    } },
  { id: "projects.events", name: "project-events", action: "Project event replay", context: "project", args: [{ name: "project", context: true }],
    flags: { after: { description: "replay after this sequence (default 0)" }, limit: { description: "page size (default 1000)" } },
    example: { args: ["walkthrough"], flags: {} },
    run: (client, { args, flags }, io) => readEventPages((after, page) => client.projectEvents(args[0], after, io.signal, page), integer(flags.after, "after") ?? 0, integer(flags.limit, "limit", { min: 1 }) ?? 1000) },
  { id: "baselines.start", name: "baseline", action: "Baseline", context: "project",
    args: [{ name: "project", context: true }, { name: "repository", description: "repository id", prompt: "Repository id" }],
    flags: { "include-optional": { boolean: true, description: "also run optional recipes" } },
    example: { args: ["walkthrough", "app"], flags: {} },
    run: (client, { args, flags }, io) => client.startBaseline(args[0], { repository_id: args[1], ...(flags["include-optional"] && { include_optional: true }) }, io.signal) },
  { id: "baselines.list", name: "baselines", action: "Baseline listing", context: "project", args: [{ name: "project", context: true }], flags: {}, example: { args: ["walkthrough"], flags: {} },
    run: (client, { args }, io) => client.listBaselines(args[0], io.signal) },

  // ---- components, memory, prompts ----
  { id: "components.status", name: "components", action: "Component status", context: "project", args: [{ name: "project", context: true }], flags: {}, example: { args: ["walkthrough"], flags: {} },
    run: (client, { args }, io) => client.components(args[0], io.signal) },
  { id: "components.enable", name: "enable-components", action: "Component activation", context: "project", args: [{ name: "project", context: true }], flags: {}, example: { args: ["walkthrough"], flags: {} },
    run: (client, { args }, io) => client.enableComponents(args[0], io.signal) },
  { id: "memory.list", name: "memory", action: "Memory listing", context: "project", args: [{ name: "project", context: true }],
    flags: { query: { description: "lexical search", prompt: "Search memory (empty lists everything)" }, "include-user": { boolean: true, description: "include private user memory (explicit consent)", prompt: "Include private user memory (yes/no)" } },
    example: { args: ["walkthrough"], flags: { query: "scope" } },
    run: (client, { args, flags }, io) => client.listMemory(args[0], { ...(flags.query && { query: String(flags.query) }), includeUser: Boolean(flags["include-user"]) }, io.signal) },
  { id: "memory.create", name: "remember", action: "Memory creation", context: "project",
    args: [{ name: "project", context: true }, { name: "scope", description: "project, process or user", prompt: "Scope (project, process or user)" }, { name: "content", description: "the memory content", prompt: "Memory content" }, { name: "provenance", description: "where this knowledge came from", prompt: "Provenance" }],
    flags: { key: { description: "idempotency key (generated when omitted)" } },
    example: { args: ["walkthrough", "project", "Tests use unittest", "README"], flags: { key: "k1" } },
    run: (client, { args, flags }, io) => {
      if (!["project", "process", "user"].includes(args[1])) throw new UsageError("The memory scope is project, process or user.");
      return client.createMemory(args[0], { idempotency_key: flags.key ? String(flags.key) : randomUUID(), scope: args[1], content: args[2], provenance: args[3] }, io.signal);
    } },
  { id: "memory.delete", name: "forget", action: "Memory deletion", context: "project",
    args: [{ name: "project", context: true }, { name: "memory-id", description: "the memory record id", prompt: "Memory id" }, { name: "hash", description: "the record's exact content hash (sha256:…)", prompt: "Exact content hash" }],
    flags: {}, example: { args: ["walkthrough", "mem-1", HASH], flags: {} },
    run: (client, { args }, io) => client.deleteMemory(args[0], args[1], args[2], io.signal) },
  { id: "memory.promote", name: "promote", action: "Memory promotion", context: "project",
    args: [{ name: "project", context: true }, { name: "memory-id", description: "the memory record id", prompt: "Memory id" }, { name: "hash", description: "the record's exact content hash (sha256:…)", prompt: "Exact content hash" }, { name: "to-scope", description: "project (from process) or user (from project)", prompt: "Promote to scope (project or user)" }],
    flags: { key: { description: "idempotency key (generated when omitted)" } },
    example: { args: ["walkthrough", "mem-1", HASH, "project"], flags: { key: "k9" } },
    run: (client, { args, flags }, io) => {
      if (!["project", "user"].includes(args[3])) throw new UsageError("Memory promotes to project (from process) or to user (from project).");
      return client.promoteMemory(args[0], args[1], { idempotency_key: flags.key ? String(flags.key) : randomUUID(), expected_hash: args[2], to_scope: args[3] }, io.signal);
    } },
  { id: "memory.update", name: "correct-memory", action: "Memory correction", context: "project",
    args: [{ name: "project", context: true }, { name: "memory-id", description: "the memory record id", prompt: "Memory id" }, { name: "hash", description: "the record's exact content hash (sha256:…)", prompt: "Exact content hash" }, { name: "content", description: "the corrected content (the record keeps its scope; provenance names the correction)", prompt: "Corrected content" }],
    flags: { key: { description: "idempotency key (generated when omitted)" } },
    example: { args: ["walkthrough", "mem-1", HASH, "Tests use pytest"], flags: { key: "k12" } },
    run: (client, { args, flags }, io) => {
      if (!String(args[3]).trim()) throw new UsageError("The corrected content is empty.");
      return client.updateMemory(args[0], args[1], { idempotency_key: flags.key ? String(flags.key) : randomUUID(), expected_hash: args[2], content: args[3] }, io.signal);
    } },
  { id: "memory.user.export", name: "export-user-memory", action: "User memory export", context: "runtime", args: [],
    flags: { output: { description: "write the personal export JSON to this file instead of printing it" } },
    example: { args: [], flags: {} },
    run: async (client, { flags }, io) => {
      const exported = await client.exportUserMemory(io.signal);
      if (flags.output) { await io.writeFile(String(flags.output), JSON.stringify(exported, null, 2) + "\n"); return { written: String(flags.output), omitted: exported.omitted, memory: exported.memory.length }; }
      return exported;
    } },
  { id: "memory.retention.show", name: "retention", action: "Retention policy inspection", context: "project", args: [{ name: "project", context: true }], flags: {}, example: { args: ["walkthrough"], flags: {} },
    run: (client, { args }, io) => client.memoryRetention(args[0], io.signal) },
  { id: "memory.retention.set", name: "set-retention", action: "Retention policy", context: "project", args: [{ name: "project", context: true }],
    flags: { "process-days": { description: "longest age of process memory in days (1 to 3650), or none to keep it", prompt: "Process memory max age in days (empty keeps it)" }, "project-days": { description: "longest age of project memory in days (1 to 3650), or none to keep it", prompt: "Project memory max age in days (empty keeps it)" } },
    example: { args: ["walkthrough"], flags: { "process-days": "30" } },
    run: (client, { args, flags }, io) => {
      const days = (name) => { const value = flags[name]; if (value === undefined || value === "" || String(value).toLowerCase() === "none") return null; const number = integer(value, name, { min: 1 }); if (number > 3650) throw new UsageError(`--${name} is at most 3650 days.`); return number; };
      return client.setMemoryRetention(args[0], { process_max_age_days: days("process-days"), project_max_age_days: days("project-days") }, io.signal);
    } },
  { id: "memory.retention.apply", name: "apply-retention", action: "Retention", context: "project", args: [{ name: "project", context: true }],
    flags: { key: { description: "idempotency key (generated when omitted; repeat the same key to replay the recorded result)" } },
    example: { args: ["walkthrough"], flags: { key: "k13" } }, confirm: "Delete every project and process memory record older than the retention policy allows? Each deletion is reconciled through the adapter and recorded; user memory is never touched.",
    run: (client, { args, flags }, io) => client.applyMemoryRetention(args[0], { idempotency_key: flags.key ? String(flags.key) : randomUUID() }, io.signal) },
  { id: "prompts.list", name: "prompts", action: "Prompt listing", context: "project", args: [{ name: "project", context: true }], flags: {}, example: { args: ["walkthrough"], flags: {} },
    run: (client, { args }, io) => client.listPrompts(args[0], io.signal) },
  { id: "prompts.create", name: "save-prompt", action: "Prompt creation", context: "project",
    args: [{ name: "project", context: true }, { name: "name", description: "prompt name", prompt: "Prompt name" }, { name: "body", description: "path of the prompt body, or - for standard input", prompt: "Prompt body file path" }],
    flags: { "expected-version": { description: "the current version when updating an existing prompt" }, key: { description: "idempotency key (generated when omitted)" } },
    example: { args: ["walkthrough", "guidance", "-"], flags: { key: "k2" } },
    run: async (client, { args, flags }, io) => client.createPrompt(args[0], { idempotency_key: flags.key ? String(flags.key) : randomUUID(), name: args[1], body: await document(io, args[2]), ...(flags["expected-version"] !== undefined && { expected_version: integer(flags["expected-version"], "expected-version") }) }, io.signal) },
  { id: "prompts.render", name: "render-prompt", action: "Prompt preview", context: "project",
    args: [{ name: "project", context: true }, { name: "name", description: "prompt name", prompt: "Prompt name" }, { name: "version", description: "prompt version", prompt: "Version" }],
    flags: {}, example: { args: ["walkthrough", "guidance", "1"], flags: {} },
    run: (client, { args }, io) => client.renderPrompt(args[0], args[1], integer(args[2], "version", { min: 1 }), io.signal) },

  // ---- tickets ----
  { id: "tickets.create", name: "create-ticket", action: "Ticket creation", context: "project", args: [{ name: "project", context: true }],
    flags: { title: { description: "ticket title", prompt: "Ticket title" }, intent: { description: "what should change and why", prompt: "Intent" }, criterion: { repeat: true, description: "an acceptance criterion (repeatable)", prompt: "Acceptance criteria (one per line; empty line ends)", multiline: true }, repository: { description: "repository id (the project's first registration when omitted)" }, purpose: { description: "feature (default) or testing_setup: the prerequisite ticket a repository without a usable testing setup is offered (ADR 0022)", prompt: "Purpose (feature or testing_setup; empty is feature)" }, key: { description: "idempotency key (generated when omitted)" } },
    example: { args: ["walkthrough"], flags: { title: "Implement the greeting", intent: "Print the greeting", criterion: ["fixture:write_in_scope"], repository: "app", key: "k3" } },
    run: async (client, { args, flags }, io) => {
      const title = String(flags.title ?? "").trim();
      const intent = String(flags.intent ?? "").trim();
      const criteria = list(flags.criterion).map((line) => String(line).trim()).filter(Boolean);
      if (!title || !intent || !criteria.length) throw new UsageError("A ticket needs --title, --intent and at least one --criterion.");
      const purpose = flags.purpose === undefined || String(flags.purpose).trim() === "" ? "feature" : String(flags.purpose).trim();
      if (!["feature", "testing_setup"].includes(purpose)) throw new UsageError("--purpose is feature or testing_setup.");
      const bytes = (text) => Buffer.byteLength(text, "utf8");
      if (bytes(title) > TEXT_LIMITS.title) throw new ClientRefusal(`The title is ${bytes(title)} bytes; the runtime accepts at most ${TEXT_LIMITS.title} (UTF-8).`);
      if (bytes(intent) > TEXT_LIMITS.intent) throw new ClientRefusal(`The intent is ${bytes(intent)} bytes; the runtime accepts at most ${TEXT_LIMITS.intent} (UTF-8).`);
      const longest = Math.max(...criteria.map(bytes));
      if (longest > TEXT_LIMITS.criterion) throw new ClientRefusal(`The longest criterion is ${longest} bytes; the runtime accepts at most ${TEXT_LIMITS.criterion} (UTF-8).`);
      const repository = flags.repository ? String(flags.repository) : (await client.project(args[0], io.signal)).repositories[0]?.repository_id;
      if (!repository) throw new ClientRefusal("The project has no registered repository to scope the ticket to.");
      return client.createTicket(args[0], { idempotency_key: flags.key ? String(flags.key) : randomUUID(), title, intent, acceptance_criteria: criteria, repository_ids: [repository], ...(purpose !== "feature" && { purpose }) }, io.signal);
    } },
  { id: "tickets.list", name: "tickets", action: "Ticket listing", context: "project", args: [{ name: "project", context: true }], flags: {}, example: { args: ["walkthrough"], flags: {} },
    run: (client, { args }, io) => client.listTickets(args[0], io.signal) },
  { id: "tickets.show", name: "show-ticket", action: "Ticket inspection", context: "ticket", args: [{ name: "ticket", context: true }], flags: {}, example: { args: ["ticket-1"], flags: {} },
    run: (client, { args }, io) => client.ticket(args[0], io.signal) },
  { id: "tickets.source", name: "ticket-source", action: "Ticket source inspection", context: "ticket", args: [{ name: "ticket", context: true }], flags: {}, example: { args: ["ticket-1"], flags: {} },
    run: (client, { args }, io) => client.ticketSource(args[0], io.signal) },
  { id: "tickets.reconcile", name: "reconcile-ticket", action: "Ticket reconciliation", context: "ticket", args: [{ name: "ticket", context: true }],
    flags: { revision: { description: "the ticket revision this client read (read from the ticket when omitted)" } },
    example: { args: ["ticket-1"], flags: { revision: "1" } },
    run: async (client, { args, flags }, io) => client.reconcileTicket(args[0], integer(flags.revision, "revision", { min: 1 }) ?? (await client.ticket(args[0], io.signal)).revision, io.signal) },

  { id: "tickets.update", name: "edit-ticket", action: "Ticket edit", context: "ticket", args: [{ name: "ticket", context: true }],
    flags: { title: { description: "the new title", prompt: "New title (empty keeps it)" }, intent: { description: "the new intent", prompt: "New intent (empty keeps it)" }, criterion: { repeat: true, description: "an acceptance criterion (repeatable; given together they replace the list)", prompt: "Acceptance criteria (one per line; empty line keeps the current list)", multiline: true }, repository: { repeat: true, description: "a repository id (repeatable; given together they replace the list)" }, revision: { description: "the ticket revision this client read (read from the ticket when omitted)" } },
    example: { args: ["ticket-1"], flags: { title: "Implement the greeting (edited)", revision: "1" } },
    run: async (client, { args, flags }, io) => {
      const title = flags.title === undefined ? undefined : String(flags.title).trim();
      const intent = flags.intent === undefined ? undefined : String(flags.intent).trim();
      const criteria = list(flags.criterion).map((line) => String(line).trim()).filter(Boolean);
      const repositories = list(flags.repository).map((id) => String(id).trim()).filter(Boolean);
      if (title === undefined && intent === undefined && !criteria.length && !repositories.length) throw new UsageError("Name at least one change: --title, --intent, --criterion or --repository.");
      if (title === "" || intent === "") throw new UsageError("A title or intent cannot be emptied; omit the flag to keep the current value.");
      const bytes = (text) => Buffer.byteLength(text, "utf8");
      if (title !== undefined && bytes(title) > TEXT_LIMITS.title) throw new ClientRefusal(`The title is ${bytes(title)} bytes; the runtime accepts at most ${TEXT_LIMITS.title} (UTF-8).`);
      if (intent !== undefined && bytes(intent) > TEXT_LIMITS.intent) throw new ClientRefusal(`The intent is ${bytes(intent)} bytes; the runtime accepts at most ${TEXT_LIMITS.intent} (UTF-8).`);
      const revision = integer(flags.revision, "revision", { min: 1 }) ?? (await client.ticket(args[0], io.signal)).revision;
      return client.updateTicket(args[0], { expected_revision: revision, ...(title !== undefined && { title }), ...(intent !== undefined && { intent }), ...(criteria.length && { acceptance_criteria: criteria }), ...(repositories.length && { repository_ids: repositories }) }, io.signal);
    } },

  // ---- plans ----
  { id: "plans.create", name: "plan", action: "Planning", context: "ticket", args: [{ name: "ticket", context: true }],
    flags: { repository: { description: "repository id (the ticket's first repository when omitted)" }, path: { repeat: true, description: "a writer path (repeatable; default src)", prompt: "Writer paths (comma separated; default src)" }, "read-only": { boolean: true, description: "allow reads only" }, role: { description: "the single task's role: implementer (default), repository_lead or project_orchestrator (an advisory role reads only)" }, "derived-from": { description: "the advisory task of an earlier revision whose proposal the single task copies" }, criterion: { repeat: true, description: "a task acceptance criterion (repeatable)" }, task: { repeat: true, description: "a task for a multi-repository plan as <repository>=<path,...>[>dependency-task,...][;role=<role>][;derived_from=<task>] (repeatable; task ids are the repository ids)" }, override: { repeat: true, description: "a dependency override as <consumer>:<producer>:<waive|add>:<justification> (repeatable; the refusal that needs one quotes it)" }, workers: { description: "concurrent writers for a multi-task plan (1 to the number of tasks, at most 4)" }, attempts: { description: "writer attempts (1 to 10)" }, timeout: { description: "time budget in seconds (1 to 86400)" }, "cost-usd": { description: "cost budget in dollars (at most 1000)" }, check: { repeat: true, description: "a testing-setup check recipe as <id>=<executable>[,<arg>,...][@<timeout seconds>] (repeatable; testing_setup tickets only; default timeout 600)" }, checks: { description: "a JSON file (or - for standard input) listing testing-setup check recipes in the manifest-check shape (id, executable, args, cwd, timeout_seconds, capabilities)" }, memory: { repeat: true, description: "a selected memory id (repeatable; components only)" }, prompt: { description: "a selected prompt as name@version#hash (components only)" }, key: { description: "idempotency key (generated when omitted)" } },
    example: { args: ["ticket-1"], flags: { repository: "app", path: ["src"], attempts: "2", key: "k4" } },
    run: async (client, { args, flags }, io) => {
      const repository = flags.repository ? String(flags.repository) : (await client.ticket(args[0], io.signal)).repository_ids[0];
      const taskOptions = (suffix) => {
        const options = {};
        for (const part of (suffix ?? "").split(";").filter(Boolean)) {
          const match = /^(role|derived_from)=(.+)$/.exec(part);
          if (!match) throw new UsageError("--task options are ;role=<role> and ;derived_from=<task>");
          options[match[1] === "role" ? "role" : "derived_from_task"] = match[2];
        }
        return options;
      };
      const overrides = list(flags.override).map((spec) => {
        const match = /^([^:]+):([^:]+):(waive|add):(.+)$/s.exec(String(spec));
        if (!match) throw new UsageError("--override takes <consumer>:<producer>:<waive|add>:<justification>");
        return { consumer: match[1], producer: match[2], action: match[3], justification: match[4] };
      });
      let checks = list(flags.check).map((spec) => {
        const match = /^([A-Za-z0-9._-]+)=([^,@]+)((?:,[^,@]*)*)(?:@(\d+))?$/.exec(String(spec));
        if (!match) throw new UsageError("--check takes <id>=<executable>[,<arg>,...][@<timeout seconds>]");
        return { id: match[1], executable: match[2], args: match[3].split(",").filter(Boolean), timeout_seconds: match[4] === undefined ? 600 : Number(match[4]) };
      });
      if (flags.checks !== undefined) {
        let listed;
        try { listed = JSON.parse(await document(io, flags.checks)); } catch { throw new ClientRefusal("The --checks document is not valid JSON."); }
        if (!Array.isArray(listed) || listed.some((check) => !check || typeof check !== "object")) throw new ClientRefusal("The --checks document must be a JSON array of check recipes (id, executable, args, cwd, timeout_seconds, capabilities).");
        checks = [...checks, ...listed.map((check) => ({ ...check, id: String(check.id ?? ""), executable: String(check.executable ?? ""), timeout_seconds: check.timeout_seconds === undefined ? 600 : Number(check.timeout_seconds) }))];
      }
      const paths = list(flags.path).flatMap((value) => String(value).split(",")).map((path) => path.trim()).filter(Boolean);
      const budgets = { ...(flags.attempts !== undefined && { max_attempts: Number(flags.attempts) }), ...(flags.timeout !== undefined && { timeout_seconds: Number(flags.timeout) }), ...(flags["cost-usd"] !== undefined && { cost_usd_micros: Math.round(Number(flags["cost-usd"]) * 1_000_000) }), ...(flags.workers !== undefined && { max_workers: integer(flags.workers, "workers", { min: 1 }) }) };
      let componentContext;
      if (flags.memory !== undefined || flags.prompt !== undefined) {
        const selected = flags.prompt === undefined ? null : /^(.+)@(\d+)#(sha256:[a-f0-9]{64})$/.exec(String(flags.prompt));
        if (flags.prompt !== undefined && !selected) throw new UsageError("--prompt names an exact prompt as name@version#sha256:<hash>.");
        componentContext = { memory_ids: list(flags.memory).map(String), ...(selected && { prompt: { name: selected[1], version: Number(selected[2]), hash: selected[3] } }) };
      }
      const operations = flags["read-only"] ? ["read"] : ["read", "write"];
      const criteria = list(flags.criterion).map(String);
      // The same builder the desktop uses, so both clients send one body for the same tasks (R02).
      const drafts = list(flags.task).length ? list(flags.task).map((spec) => {
        const match = /^([a-z][a-z0-9-]*)=([^>;]*)(?:>([^;]*))?((?:;.*)?)$/.exec(String(spec));
        if (!match) throw new UsageError("--task takes <repository>=<path,...>[>dependency-task,...][;role=<role>][;derived_from=<task>]");
        const options = taskOptions(match[4]);
        // An advisory role reads only, whatever --read-only says; the builder refuses anything else.
        return { id: match[1], repository_id: match[1], paths: match[2].split(","), operations: options.role && options.role !== "implementer" ? ["read"] : operations, acceptance_criteria: criteria, depends_on: (match[3] ?? "").split(","), ...options };
      }) : [{ repository_id: repository, paths, operations: flags.role && String(flags.role) !== "implementer" ? ["read"] : operations, acceptance_criteria: criteria, ...(flags.role && { role: String(flags.role) }), ...(flags["derived-from"] && { derived_from_task: String(flags["derived-from"]) }) }];
      let request;
      try { request = planRequestForTasks(drafts, budgets, { componentContext, dependencyOverrides: overrides, checks }); } catch (failure) { throw new ClientRefusal(failure.message); }
      return client.createPlan(args[0], { ...request, idempotency_key: flags.key ? String(flags.key) : randomUUID() }, io.signal);
    } },
  { id: "plans.list", name: "plans", action: "Plan listing", context: "ticket", args: [{ name: "ticket", context: true }], flags: {}, example: { args: ["ticket-1"], flags: {} },
    run: (client, { args }, io) => client.listPlans(args[0], io.signal) },
  { id: "plans.show", name: "show-plan", action: "Plan inspection", context: "plan", args: [{ name: "plan", context: true }], flags: {}, example: { args: ["plan-1"], flags: {} },
    run: (client, { args }, io) => client.plan(args[0], io.signal) },
  { id: "plans.approve", name: "approve", action: "Approval", context: "plan", args: [{ name: "plan", context: true }],
    flags: { "acknowledge-hash": { description: "the complete plan hash you reviewed; approval binds to exactly this hash" }, "approved-by": { description: "the approver's name (default developer)" } },
    example: { args: ["plan-1"], flags: { "acknowledge-hash": HASH } },
    run: async (client, { args, flags }, io) => {
      const plan = await client.plan(args[0], io.signal);
      const acknowledged = await acknowledgedHash(io, flags, plan);
      if (!acknowledged) throw new ClientRefusal("Approval cancelled: no plan hash was acknowledged.");
      if (acknowledged !== plan.hash) throw new ClientRefusal(`The acknowledged hash does not match plan ${plan.id} r${plan.revision} (${plan.hash}). Review the complete plan, then acknowledge its exact hash.`);
      const approvedBy = String(flags["approved-by"] ?? "developer").trim() || "developer";
      if (Buffer.byteLength(approvedBy, "utf8") > TEXT_LIMITS.approver) throw new ClientRefusal(`The approver name is ${Buffer.byteLength(approvedBy, "utf8")} bytes; the runtime accepts at most ${TEXT_LIMITS.approver} (UTF-8).`);
      return client.approvePlan(plan.id, { plan_revision: plan.revision, plan_hash: acknowledged, approved_by: approvedBy }, io.signal);
    } },

  // ---- runs and candidates ----
  { id: "runs.show", name: "run", action: "Run inspection", context: "run", args: [{ name: "run", context: true }], flags: {}, example: { args: ["run-1"], flags: {} },
    run: (client, { args }, io) => client.run(args[0], io.signal) },
  { id: "runs.events", name: "events", action: "Event replay", context: "run", args: [{ name: "run", context: true }],
    flags: { after: { description: "replay after this sequence (default 0)" }, limit: { description: "page size (default 1000)" } },
    example: { args: ["run-1"], flags: { after: "0" } },
    run: (client, { args, flags }, io) => readEventPages((after, page) => client.events(args[0], after, io.signal, page), integer(flags.after, "after") ?? 0, integer(flags.limit, "limit", { min: 1 }) ?? 1000) },
  { id: "runs.stream", name: "follow", action: "Event follow", context: "run", args: [{ name: "run", context: true }],
    flags: { after: { description: "resume after this sequence (default 0)" } },
    example: { args: ["run-1"], flags: {} },
    run: async (client, { args, flags }, io) => {
      let last = integer(flags.after, "after") ?? 0;
      let count = 0;
      const hooks = { outage: (failure) => io.note(`Runtime outage while following ${args[0]}: ${io.describe(failure)} Reconnecting; replay resumes after sequence ${last}.`), reconnected: () => io.note(`Reconnected to the runtime; following ${args[0]} from sequence ${last + 1}.`) };
      for await (const event of client.followEvents(args[0], last, io.signal, hooks)) {
        last = event.sequence;
        count += 1;
        io.emit(event);
      }
      const run = await client.run(args[0], io.signal);
      return { run_id: args[0], state: run.state, last_sequence: last, events_followed: count };
    } },
  { id: "runs.cancel", name: "cancel", action: "Cancellation", context: "run", args: [{ name: "run", context: true }], flags: {}, example: { args: ["run-1"], flags: {} },
    run: (client, { args }, io) => client.cancelRun(args[0], io.signal) },
  { id: "runs.implement", name: "implement", action: "Implementation", context: "run", args: [{ name: "run", context: true }],
    flags: { task: { description: "the plan task to implement (the plan's task when omitted)" }, provider: { description: "provider override" }, model: { description: "model override" } },
    example: { args: ["run-1"], flags: {} },
    run: (client, { args, flags }, io) => client.implement(args[0], { ...(flags.task && { task_id: String(flags.task) }), ...modelSettings(flags) }, io.signal) },
  { id: "runs.candidate", name: "candidate", action: "Candidate inspection", context: "run", args: [{ name: "run", context: true }], flags: {}, example: { args: ["run-1"], flags: {} },
    run: (client, { args }, io) => client.candidate(args[0], io.signal) },
  { id: "runs.diff", name: "diff", action: "Diff inspection", context: "run", args: [{ name: "run", context: true }], flags: {}, example: { args: ["run-1"], flags: {} },
    run: (client, { args }, io) => client.candidateDiff(args[0], io.signal) },
  { id: "runs.validate", name: "validate", action: "Validation", context: "run", args: [{ name: "run", context: true }],
    flags: { "candidate-hash": { description: "the complete candidate hash shown by `candidate` (read from the run when omitted)" }, "auto-repair": { boolean: true, description: "repair automatically within the approved budgets" }, provider: { description: "provider override" }, model: { description: "model override" } },
    example: { args: ["run-1"], flags: { "candidate-hash": HASH } },
    run: async (client, { args, flags }, io) => client.validateCandidate(args[0], { candidate_hash: await candidateHash(client, args[0], flags, io.signal), auto_repair: Boolean(flags["auto-repair"]), ...modelSettings(flags) }, io.signal) },
  { id: "runs.repair", name: "repair", action: "Repair", context: "run", args: [{ name: "run", context: true }],
    flags: { "candidate-hash": { description: "the complete candidate hash shown by `candidate` (read from the run when omitted)" }, provider: { description: "provider override" }, model: { description: "model override" } },
    example: { args: ["run-1"], flags: { "candidate-hash": HASH } },
    run: async (client, { args, flags }, io) => client.repairCandidate(args[0], { candidate_hash: await candidateHash(client, args[0], flags, io.signal), ...modelSettings(flags) }, io.signal) },
  { id: "runs.publish", name: "publish", action: "Publication", context: "run", args: [{ name: "run", context: true }],
    flags: { "candidate-hash": { description: "the complete candidate hash shown by `candidate` (read from the run when omitted)" }, key: { description: "idempotency key (generated when omitted; repeat the same key to resume)" } },
    example: { args: ["run-1"], flags: { "candidate-hash": HASH, key: "k11" } },
    run: async (client, { args, flags }, io) => client.publish(args[0], { expected_hash: await candidateHash(client, args[0], flags, io.signal), idempotency_key: flags.key ? String(flags.key) : randomUUID() }, io.signal) },
  { id: "runs.publication", name: "publication", action: "Publication inspection", context: "run", args: [{ name: "run", context: true }], flags: {}, example: { args: ["run-1"], flags: {} },
    run: (client, { args }, io) => client.publication(args[0], io.signal) },
  { id: "runs.publication.reconcile", name: "reconcile-publication", action: "Publication reconciliation", context: "run", args: [{ name: "run", context: true }], flags: {}, example: { args: ["run-1"], flags: {} },
    run: (client, { args }, io) => client.reconcilePublication(args[0], io.signal) },
  { id: "runs.publication.repair", name: "publication-repair", action: "Repair after a CI failure", context: "run", args: [{ name: "run", context: true }],
    flags: { "candidate-hash": { description: "the complete candidate hash shown by `publication` (read from the run when omitted)" }, provider: { description: "provider override" }, model: { description: "model override" } },
    example: { args: ["run-1"], flags: { "candidate-hash": HASH } },
    run: async (client, { args, flags }, io) => client.repairPublication(args[0], { candidate_hash: await candidateHash(client, args[0], flags, io.signal), ...modelSettings(flags) }, io.signal) },
  { id: "runs.worktrees", name: "worktrees", action: "Worktree listing", context: "run", args: [{ name: "run", context: true }], flags: {}, example: { args: ["run-1"], flags: {} },
    run: (client, { args }, io) => client.worktrees(args[0], io.signal) },
  { id: "runs.attempts", name: "attempts", action: "Attempt listing", context: "run", args: [{ name: "run", context: true }], flags: {}, example: { args: ["run-1"], flags: {} },
    run: (client, { args }, io) => client.attempts(args[0], io.signal) },
  { id: "runs.tasks", name: "tasks", action: "Task graph listing", context: "run", args: [{ name: "run", context: true }], flags: {}, example: { args: ["run-1"], flags: {} },
    run: (client, { args }, io) => client.tasks(args[0], io.signal) },
  { id: "artifacts.read", name: "artifact", action: "Log inspection", context: "run",
    args: [{ name: "run", context: true }, { name: "artifact-id", description: "<recipe>.stdout or <recipe>.stderr", prompt: "Artifact id (<recipe>.stdout or <recipe>.stderr)" }],
    flags: {}, example: { args: ["run-1", "unit.stderr"], flags: {} },
    run: (client, { args }, io) => client.artifact(args[0], args[1], io.signal) },
];

/** Every project with its view, baselines and tickets, read with at most four requests in flight. */
async function readProjects(client, io, only) {
  const projects = (await client.listProjects(io.signal)).filter((project) => !only || project.id === only);
  if (only && !projects.length) throw new ClientRefusal(`The runtime has no project ${only}.`);
  const views = [];
  const baselines = {};
  const tickets = {};
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, projects.length) }, async () => {
    while (next < projects.length) {
      const project = projects[next++];
      const [view, recorded, listed] = await Promise.all([client.project(project.id, io.signal), client.listBaselines(project.id, io.signal), client.listTickets(project.id, io.signal)]);
      views[projects.indexOf(project)] = view;
      baselines[project.id] = recorded;
      tickets[project.id] = listed;
    }
  }));
  return { views, baselines, tickets };
}

/**
 * Read-only projections of the experience chapter (docs/09-experience.md, ADR 0027 point 4). They
 * are not product actions: each one reads the cataloged actions it `projects` and prints the same
 * projection the desktop's Home and Kanban panels render (`@luuna/api-client` projections.ts), so
 * they carry no catalog entry of their own and `scripts/check-contracts.mjs` traces them by name.
 */
export const PROJECTIONS = [
  { id: "projection.home", name: "home", action: "Home summary", context: "runtime", projects: ["projects.list", "projects.show", "baselines.list", "tickets.list", "runs.list"], args: [],
    flags: { project: { description: "only this project" } },
    example: { args: [], flags: {} },
    run: async (client, { flags }, io) => {
      const [{ views, baselines, tickets }, runs] = await Promise.all([readProjects(client, io, flags.project && String(flags.project)), client.listRuns(io.signal)]);
      return homeSummary({ projects: views, baselines, tickets, runs });
    } },
  { id: "projection.board", name: "board", action: "Kanban projection", context: "runtime", projects: ["projects.list", "projects.show", "tickets.list", "runs.list"], args: [],
    flags: { project: { description: "only this project" } },
    example: { args: [], flags: {} },
    run: async (client, { flags }, io) => {
      const [{ views, tickets }, runs] = await Promise.all([readProjects(client, io, flags.project && String(flags.project)), client.listRuns(io.signal)]);
      return boardProjection({ projects: views, tickets: Object.values(tickets).flat(), runs });
    } },
];

/** Every command the command line and the interactive menus reach: the cataloged actions and the projections. */
export const commandsByName = new Map([...COMMANDS, ...PROJECTIONS].map((command) => [command.name, command]));
export const commandsById = new Map(COMMANDS.map((command) => [command.id, command]));
export const projectionsByName = new Map(PROJECTIONS.map((command) => [command.name, command]));

/** The positional usage line of a command. */
export function usage(command) {
  const positional = command.args.map((arg) => `<${arg.name}>`).join(" ");
  const flags = Object.entries(command.flags).map(([name, flag]) => flag.boolean ? `[--${name}]` : `[--${name} <value>${flag.repeat ? "…" : ""}]`).join(" ");
  return `${command.name}${positional ? ` ${positional}` : ""}${flags ? ` ${flags}` : ""}`;
}
