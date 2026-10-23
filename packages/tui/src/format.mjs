// Human-readable rendering of runtime records. Every state is shown as the runtime's unchanged
// text (the same words the desktop badges show); the runtime's reasons and the shared next step
// follow the state. Nothing here decides what is allowed: it prints the runtime's decisions.
import { baselineStep, nextStep } from "@luuna/api-client";

/**
 * The six outcome tones of the design system (ADR 0013, docs/DESIGN-SYSTEM.md), mapped from the
 * runtime's states exactly as apps/desktop/src/design/tone.ts maps them, so a state reads the same
 * in both clients. A tone is presentation only: the runtime's text is printed unchanged, in colour
 * when the output is a terminal and NO_COLOR is unset, as plain text otherwise.
 */
export const TONES = ["success", "active", "danger", "attention", "neutral", "interrupted"];
/** SGR parameters per tone: green is earned, cyan is the runtime working, rose is failed or blocked evidence, amber waits on the developer, dim is recorded without being evidence, plum is an interruption. */
const SGR_BY_TONE = { success: "32", active: "36", danger: "31", attention: "33", neutral: "2", interrupted: "35" };
export const runTone = { queued: "neutral", running: "active", completed: "neutral", failed: "danger", cancelled: "neutral", interrupted: "interrupted", discovered: "neutral", exploring: "active", testing_blocked: "danger", plan_ready: "attention", approved: "attention", implementing: "active", validating: "active", reviewing: "active", reviewed: "success", paused: "attention" };
export const candidateTone = { pending: "neutral", validating: "active", reviewing: "active", reviewed: "success", failed: "danger", testing_blocked: "danger", paused: "attention", cancelled: "neutral", interrupted: "interrupted" };
export const checkTone = { passed: "success", failed: "danger", blocked: "danger", cancelled: "neutral", interrupted: "interrupted" };
export const baselineTone = { ...checkTone, running: "active" };
export const verdictTone = { passed: "success", changes_required: "danger", blocked: "danger" };
export const severityTone = { info: "neutral", warning: "attention", blocking: "danger" };
export const leaseTone = { active: "active", released: "neutral", abandoned: "interrupted" };
export const connectionTone = { connected: "success", reconnecting: "interrupted", offline: "neutral" };

/** Whether colour may be used: only on a terminal, never with NO_COLOR set (https://no-color.org) or TERM=dumb. */
export function colourEnabled({ env = {}, stdout } = {}) {
  if (!stdout || !stdout.isTTY) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.TERM === "dumb") return false;
  return true;
}

/** The text in its tone's colour when `colour` is on; the unchanged text otherwise (an unknown tone is plain). */
export function paint(text, tone, colour) {
  const code = tone && SGR_BY_TONE[tone];
  if (!colour || !code) return String(text);
  return `\u001b[${code}m${text}\u001b[0m`;
}

const painter = (options) => (text, tone) => paint(text, tone, Boolean(options?.colour));

const short = (hash) => (typeof hash === "string" && hash.length > 20 ? `${hash.slice(0, 19)}…` : String(hash ?? ""));
const when = (value) => (typeof value === "string" ? value.replace("T", " ").replace(/\.\d+Z$/, "Z") : "");
const dollars = (micros) => `$${(Number(micros ?? 0) / 1_000_000).toFixed(4)}`;

function runLine(run, options) {
  const p = painter(options);
  const kind = run.metadata?.kind;
  const what = kind === "baseline" ? `baseline · ${run.metadata.repository_id ?? ""} · manifest r${run.metadata.manifest_revision ?? "?"}` : kind === "workflow" ? `workflow · plan ${run.metadata.plan_id ?? ""} r${run.metadata.plan_revision ?? "?"}` : typeof run.metadata?.prompt === "string" ? `session · ${run.metadata.prompt.slice(0, 60)}` : "session";
  return `${run.id}  ${p(run.state, runTone[run.state])}  ${what}  ${when(run.created_at)}`;
}

function eventLine(event) {
  const reason = typeof event.payload?.reason === "string" ? `  reason: ${event.payload.reason}` : "";
  const state = typeof event.payload?.state === "string" ? `  ${event.payload.state}` : "";
  return `${String(event.sequence).padStart(5)}  ${when(event.timestamp)}  ${event.type}${state}${reason}`;
}

function checkLine(result, options) {
  return `  ${result.recipe_id}: ${painter(options)(result.status, checkTone[result.status])}${result.exit_code === null || result.exit_code === undefined ? "" : ` (exit ${result.exit_code})`}${result.tests_detected !== undefined ? ` · ${result.tests_detected} test(s) detected` : ""}${result.reason ? ` · ${result.reason}` : ""}${result.artifact_refs?.length ? ` · logs: ${result.artifact_refs.join(", ")}` : ""}`;
}

/** What the runtime admits for this candidate now, from its own decisions. */
function decisions(view) {
  const out = [];
  if (view.active) out.push("The runtime is running this workflow's checks, reviewer or repair; cancellation is available.");
  const allowed = { validate: view.validate_allowed, revalidate: view.revalidate_allowed, repair: view.repair_allowed };
  for (const [name, value] of Object.entries(allowed)) {
    if (value === true) out.push(`${name} is available`);
    else if (value === false && view.decision_reasons?.[name]) out.push(`${name} is not available: ${view.decision_reasons[name]}`);
  }
  return out;
}

export function formatCandidate(view, options) {
  const p = painter(options);
  if (!view.evidence) return ["No candidate is recorded for this run.", ...(view.active ? ["The runtime is running the scoped writer."] : [])].join("\n");
  const evidence = view.evidence;
  const actions = { validate: view.validate_allowed, revalidate: view.revalidate_allowed, repair: view.repair_allowed, reasons: view.decision_reasons ?? {} };
  const lines = [
    `Candidate r${evidence.candidate.revision}  ${p(evidence.status, candidateTone[evidence.status])}`,
    `candidate hash: ${evidence.candidate.hash}`,
    `approved plan hash: ${evidence.candidate.plan_hash}`,
    ...Object.entries(evidence.candidate.repository_commits).map(([id, commit]) => `${id} commit: ${commit}`),
    `checks (${evidence.results.length} result(s)):`,
    ...evidence.results.map((result) => checkLine(result, options)),
  ];
  if (evidence.review) lines.push(`independent review: ${p(evidence.review.verdict, verdictTone[evidence.review.verdict])} (${evidence.review.findings.length} finding(s); session ${evidence.review.reviewer_session})`, ...evidence.review.findings.map((finding) => `  ${p(finding.severity, severityTone[finding.severity])} ${finding.path}:${finding.line} ${finding.explanation}`));
  else lines.push("independent review: none recorded");
  if (evidence.reason) {
    lines.push(`reason: ${evidence.reason}`);
    const step = nextStep(evidence.reason, actions);
    if (step) lines.push(`next: ${step}`);
  }
  lines.push(...decisions(view));
  if (view.usage) lines.push(`usage: ${view.usage.attempts} of ${view.usage.max_attempts} writer attempt(s) · ${view.usage.elapsed_seconds}s of ${view.usage.timeout_seconds}s · ${dollars(view.usage.cost_usd_micros)} of ${dollars(view.usage.cost_budget_usd_micros)} · ${view.usage.repairs} repair(s)${view.usage.cost_unreported ? " · some model spend was reported without a cost" : ""}`);
  if (view.dependency_overrides?.length) lines.push(`dependency overrides: ${view.dependency_overrides.map(overrideLine).join("; ")}`);
  if (view.tasks?.length) lines.push("tasks:", ...view.tasks.flatMap(taskLines));
  // A testing-setup workflow (ADR 0022): the recipes the candidate must pass and the developer's handoff.
  if (view.prerequisite) lines.push(...handoffLines(view.prerequisite));
  return lines.join("\n");
}

/** The testing-setup handoff of a setup workflow's candidate view, with `next` in the runtime's words. */
export function handoffLines(handoff) {
  return [
    `testing setup for ${handoff.repository_id}: ${handoff.reviewed ? "reviewed with a passed verdict" : "not yet reviewed with a passed verdict"}${handoff.candidate_commit ? ` · candidate commit ${handoff.candidate_commit}` : ""}`,
    "proposed required checks (confirm these in the next manifest revision after merging):",
    ...(handoff.checks ?? []).map((check) => `  ${check.id}: ${[check.executable, ...(check.args ?? [])].join(" ")}${check.cwd && check.cwd !== "." ? ` (in ${check.cwd})` : ""} · ${check.timeout_seconds}s${check.capabilities?.length ? ` · ${check.capabilities.join(", ")}` : ""}`),
    `next: ${handoff.next}`,
  ];
}

/** The runtime's testing-setup offer (ADR 0022): its reason and its next step, unchanged. */
export function offerLines(prerequisite, indent = "  ") {
  return [`${indent}testing setup needed for ${prerequisite.repository_id}: ${prerequisite.reason}`, `${indent}next: ${prerequisite.next}`];
}

const overrideLine = (override) => `${override.action} ${override.consumer} <- ${override.producer} (${override.justification})`;

/** One task record with its assignment trace and, for an advisory task, its structured result (ADR 0023). */
export function taskLines(task) {
  const lines = [`  ${task.task_id}  ${task.state}  ${task.repository_id} · role ${task.role ?? "implementer"}${task.depends_on?.length ? ` · after ${task.depends_on.join(", ")}` : ""}${task.candidate_commit ? ` · commit ${task.candidate_commit}` : ""}${task.attempt_id ? ` · attempt ${task.attempt_id}` : ""}${task.reason ? ` · ${task.reason}` : ""}`];
  if (task.assigned_by) lines.push(`    assigned by ${task.assigned_by.approved_by} · approval ${task.assigned_by.approval_id} at ${when(task.assigned_by.approved_at)} · plan ${task.assigned_by.plan_id} r${task.assigned_by.plan_revision} · ${task.assigned_by.plan_hash}`);
  if (task.derived_from_task) lines.push(`    derived from task ${task.derived_from_task}`);
  if (task.dependency_overrides?.length) lines.push(`    dependency overrides: ${task.dependency_overrides.map(overrideLine).join("; ")}`);
  const result = task.advisory_result;
  if (result) {
    lines.push(`    advisory result: ${result.findings?.length ?? 0} finding(s), ${result.proposed_tasks?.length ?? 0} proposed task(s), ${result.risks?.length ?? 0} risk(s)`);
    for (const finding of result.findings ?? []) lines.push(`      finding: ${finding}`);
    for (const proposed of result.proposed_tasks ?? []) lines.push(`      proposed task ${proposed.id} (${proposed.repository_id}, ${proposed.role ?? "implementer"})${proposed.depends_on?.length ? ` after ${proposed.depends_on.join(", ")}` : ""}${proposed.paths?.length ? ` · paths ${proposed.paths.join(", ")}` : ""}${proposed.rationale ? ` · ${proposed.rationale}` : ""}`);
    for (const risk of result.risks ?? []) lines.push(`      risk: ${risk}`);
    lines.push(`      a proposed task becomes real only through a plan revision you create (plan --task …;derived_from=${task.task_id}) and approve`);
  }
  return lines;
}

function formatBaseline(baseline, options) {
  const step = baseline.reason ? baselineStep(baseline.status, baseline.reason) : "";
  return [`${baseline.run_id}  ${painter(options)(baseline.status, baselineTone[baseline.status])}  manifest r${baseline.manifest_revision} · commit ${short(baseline.identity?.commit)} · ${baseline.results?.length ?? 0}/${baseline.required_checks?.length ?? 0} required results`, ...(baseline.reason ? [`  reason: ${baseline.reason}${step && !baseline.prerequisite ? `  next: ${step}` : ""}`] : []), ...(baseline.prerequisite ? offerLines(baseline.prerequisite) : []), ...(baseline.results ?? []).map((result) => checkLine(result, options))].join("\n");
}

function formatProject(view) {
  const registration = view.repositories?.[0];
  const observation = registration?.observation;
  return [
    `${view.project.name} (${view.project.id})  ${view.project.revision > 0 ? `manifest r${view.project.revision}` : "unconfirmed"}`,
    ...(registration ? [`repository ${registration.repository_id} · ${registration.local_path}`] : ["no registered repository"]),
    ...(observation ? [`remote: ${observation.identity?.remote ?? "no portable origin"} · HEAD ${short(observation.head_commit)} on ${observation.branch ?? "detached HEAD"} · dirty ${observation.dirty?.staged ?? 0} staged, ${observation.dirty?.unstaged ?? 0} unstaged, ${observation.dirty?.untracked ?? 0} untracked`] : []),
    view.manifest ? `confirmed manifest: revision ${view.manifest.revision} · ${view.manifest.hash} · base ${Object.values(view.manifest.base_commits ?? {})[0] ?? ""}` : "confirmed manifest: none",
    view.discovery ? `discovery: proposal for revision ${view.discovery.proposed_manifest?.revision} (${view.discovery.manifest_problems?.length ?? 0} problem(s), ${view.discovery.questions?.length ?? 0} question(s))` : "discovery: none stored",
    ...(view.prerequisites?.length ? ["prerequisites (a feature plan is refused until each is established):", ...view.prerequisites.flatMap((prerequisite) => offerLines(prerequisite))] : []),
  ].join("\n");
}

/** The Home summary: projects, validation health per repository, blockers and the create-ticket shortcut. */
export function formatHome(summary, options) {
  const p = painter(options);
  const lines = [];
  if (!summary.projects.length) return "No projects registered. Register a repository (register <name> <repository-id> <path>) to start.";
  for (const project of summary.projects) {
    lines.push(`${project.name} (${project.id})  ${project.revision > 0 ? `manifest r${project.revision}` : "unconfirmed"} · ${project.tickets} ticket(s) · ${project.active_workflows} active workflow(s)`);
    for (const repository of project.repositories) {
      const baseline = repository.baseline;
      lines.push(`  ${repository.repository_id}: ${baseline ? `baseline ${p(baseline.status, baselineTone[baseline.status])} · manifest r${baseline.manifest_revision} · commit ${short(baseline.commit)}${baseline.reason ? ` · ${baseline.reason}` : ""}` : "no baseline"}${repository.prerequisite ? " · testing setup needed" : ""}`);
    }
  }
  lines.push(summary.blockers.length ? `blockers (${summary.blockers.length}):` : "blockers: none");
  for (const blocker of summary.blockers) lines.push(`  ${blocker.project_id} · ${blocker.title}: ${blocker.detail}${blocker.run_id ? ` (run ${blocker.run_id})` : ""}`);
  lines.push("create a ticket: create-ticket <project> --title … --intent … --criterion … [--purpose testing_setup]");
  return lines.join("\n");
}

/** The Kanban projection: every column with its read-only cards, then the note that nothing is dragged. */
export function formatBoard(board, options) {
  const p = painter(options);
  const lines = [];
  for (const { column, cards } of board.columns) {
    lines.push(`${column.title} (${cards.length})  ${column.description}`);
    for (const card of cards) lines.push(`  ${card.kind === "prerequisite" ? `[prerequisite] ${card.title} · ${card.project_id} · ${card.reason ?? ""}` : `[ticket] ${card.title} · ${card.project_id} · ${card.ticket_id} r${card.ticket_revision}${card.purpose ? ` · ${card.purpose.replace(/_/g, " ")}` : ""}${card.run_id ? ` · run ${card.run_id} ${p(card.state, runTone[card.state])} (plan r${card.plan_revision})` : " · no plan yet"}`}`);
  }
  lines.push(board.note);
  return lines.join("\n");
}

function formatDiscovery(discovery) {
  const checks = (discovery.repositories ?? []).flatMap((repo) => (repo.proposed_checks ?? []).map((proposed) => `  ${repo.repository_id}: ${proposed.check.executable} ${proposed.check.args.join(" ")}  ${proposed.check.required ? "required" : "optional"} · ${proposed.confidence} · ${proposed.evidence.join(" · ")}`));
  return [
    `Discovery ${discovery.id} proposes manifest revision ${discovery.proposed_manifest?.revision}`,
    ...(discovery.questions?.length ? ["open questions:", ...discovery.questions.map((q) => `  ${q.topic}: ${q.detail}`)] : []),
    ...(discovery.manifest_problems?.length ? [`proposal needs edits before confirmation: ${discovery.manifest_problems.join("; ")}`] : []),
    "proposed checks:", ...(checks.length ? checks : ["  none"]),
    "proposed manifest (edit, then confirm it with `confirm <project> <file>`):",
    JSON.stringify(discovery.proposed_manifest, null, 2),
  ].join("\n");
}

function formatPlanRecord(plan) {
  return [`Plan ${plan.id} revision ${plan.revision}  ticket ${plan.ticket_id} r${plan.ticket_revision}`, `immutable plan hash: ${plan.hash}`, `base: ${Object.entries(plan.base_commits ?? {}).map(([id, commit]) => `${id} ${commit}`).join(", ")} · paths ${plan.tasks?.[0]?.paths?.join(", ") ?? ""} · operations ${plan.tasks?.[0]?.operations?.join(", ") ?? ""}`, `budgets: ${plan.budgets?.max_attempts} attempt(s), ${plan.budgets?.timeout_seconds}s, ${dollars(plan.budgets?.cost_usd_micros)}`, "complete plan:", JSON.stringify(plan, null, 2)].join("\n");
}

function formatTicket(ticket) {
  const usage = ticket.usage ? ` · ${ticket.usage.workflows} workflow(s), ${ticket.usage.attempts} attempt(s), ${ticket.usage.repairs} repair(s), ${ticket.usage.elapsed_seconds}s, ${dollars(ticket.usage.cost_usd_micros)}` : "";
  return `${ticket.id}  r${ticket.revision}  ${ticket.source}  ${ticket.title}${usage}\n  ${ticket.intent}\n  criteria: ${ticket.acceptance_criteria.join(" | ")}`;
}

/**
 * The doctor report as `luuna-runtime doctor` prints it: status, item name, detail and the
 * required marker per line, then the verdict. Details name credentials, never values.
 */
export const orbitTone = { succeeded: "success", failed: "danger", blocked: "danger", cancelled: "neutral", skipped: "neutral" };

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** One line per repository: branch, upstream distance, uncommitted changes and recipes. */
export function formatOrbit(view, options) {
  const p = painter(options);
  const repositories = view.repositories ?? [];
  const lines = [`${view.name} (${view.project_id}) · ${plural(repositories.length, "repository", "repositories")} · ${view.manifest_revision == null ? "manifest unconfirmed" : `manifest r${view.manifest_revision}`}`];
  for (const repository of repositories) {
    if (!repository.present) { lines.push(`  ${repository.repository_id}  ${p("missing", "attention")}  ${repository.local_path}  (orbit-sync clones it)`); continue; }
    const dirty = repository.dirty ? repository.dirty.staged + repository.dirty.unstaged + repository.dirty.untracked + repository.dirty.conflicted : 0;
    const upstream = repository.upstream ? `  ${repository.upstream.name} ↑${repository.upstream.ahead} ↓${repository.upstream.behind}` : "  no upstream";
    const recipes = repository.recipes?.length ? `  recipes: ${repository.recipes.join(", ")}` : "";
    lines.push(`  ${repository.repository_id}  ${repository.branch ?? "(detached)"}${upstream}  ${dirty ? p(`${dirty} changed`, "attention") : p("clean", "neutral")}  ${repository.local_path}${recipes}`);
    if (repository.error) lines.push(`    ${p(repository.error, "danger")}`);
  }
  return lines.join("\n");
}

/** Per repository: the outcome, then the tail of its output. */
export function formatOrbitExecution(execution, options) {
  const p = painter(options);
  const results = execution.results ?? [];
  const lines = [`${execution.kind ?? "orbit"} ${(execution.command ?? []).join(" ")} · ${plural(results.length, "repository", "repositories")} · not evidence`];
  for (const result of results) {
    lines.push(`── ${result.repository_id}  ${p(result.status, orbitTone[result.status])}${result.action ? ` (${result.action})` : ""}${result.exit_code == null ? "" : ` exit ${result.exit_code}`}${result.reason && result.reason !== `exit code ${result.exit_code}` ? ` · ${result.reason}` : ""}`);
    for (const text of [result.stdout_excerpt, result.stderr_excerpt]) if (text && text.trim()) lines.push(text.trimEnd().split(/\r?\n/).map((line) => `   ${line}`).join("\n"));
  }
  return lines.join("\n");
}

/** What the sandbox reaches, and the limits that come with it. */
export function formatSandboxPlan(plan, options) {
  const p = painter(options);
  return [
    `sandbox ${plan.project_id} · ${plan.backend} · ${plan.available ? p("available", "success") : p("unavailable", "danger")}${plan.reason ? ` · ${plan.reason}` : ""}`,
    `  starts in ${plan.workdir}`,
    ...(plan.repositories ?? []).map((r) => `  read-write ${r.repository_id}: ${r.host_path}${r.sandbox_path !== r.host_path ? ` (as ${r.sandbox_path})` : ""}`),
    `  home ${plan.home}`,
    `  network ${plan.network}`,
    ...(plan.notes ?? []).map((note) => `  note: ${note}`),
    `  open it with: lu sbx ${plan.project_id}${plan.network === "none" ? " --network none" : ""}`,
  ].join("\n");
}

export function formatDoctor(report) {
  const lines = report.items.map((item) => `${item.status.padEnd(8)} ${item.name.padEnd(20)} ${item.detail}${item.required ? " (required)" : ""}`);
  lines.push(`doctor: ${report.ok ? "ok" : "FAILED"}`);
  return lines.join("\n");
}

/** Renders one command result for a terminal; `id` is the catalog id; `options.colour` paints the tones. */
export function format(id, value, options = {}) {
  if (value === undefined || value === null) return "";
  const p = painter(options);
  switch (id) {
    case "doctor": return formatDoctor(value);
    case "health": return `runtime ${p(value.status, value.status === "ok" ? "success" : "danger")} · Pi ${value.pi_version} · native execution ${value.native_execution ? "yes" : "no"} · build ${value.build_identity ?? "unknown"}`;
    case "projects.list": return value.length ? value.map((project) => `${project.id}  ${project.revision > 0 ? `manifest r${project.revision}` : "unconfirmed"}  ${project.name}`).join("\n") : "No projects registered.";
    case "projects.show": case "projects.register": case "projects.manifest.confirm": case "projects.repositories.rebind": return formatProject(value);
    case "projects.discover": return formatDiscovery(value);
    case "projects.events": case "runs.events": return value.length ? value.map(eventLine).join("\n") : "No events.";
    case "baselines.start": case "runs.start": case "runs.show": case "runs.cancel": case "runs.implement": case "runs.validate": case "runs.repair": return runLine(value, options);
    case "baselines.list": return value.length ? value.map((baseline) => formatBaseline(baseline, options)).join("\n") : "No baselines recorded.";
    case "runs.list": return value.length ? value.map((run) => runLine(run, options)).join("\n") : "No runs.";
    case "components.status": case "components.enable": return `components ${value.enabled ? "enabled" : "not enabled"}${value.workspace_path ? ` · ${value.workspace_path}` : ""}${value.reason ? ` · ${value.reason}` : ""}`;
    case "memory.list": return value.length ? value.map((record) => `${record.id}  ${record.scope}  ${record.hash}\n  ${record.content}\n  provenance: ${record.provenance}`).join("\n") : "No memory records in this view.";
    case "memory.create": return `${value.id}  ${value.scope}  ${value.hash}`;
    case "memory.delete": return value.deleted ? "Memory deleted." : "Memory not deleted.";
    case "prompts.list": return value.length ? value.map((prompt) => `${prompt.name}  version ${prompt.version}${prompt.hash ? `  ${prompt.hash}` : ""}`).join("\n") : "No prompts.";
    case "prompts.create": case "prompts.render": return `${value.name}  version ${value.version}  ${value.hash}\n${value.body}`;
    case "tickets.create": case "tickets.show": case "tickets.reconcile": case "tickets.update": return formatTicket(value);
    case "memory.update": return `${value.id}  ${value.scope}  ${value.hash}\n  ${value.content}\n  provenance: ${value.provenance}`;
    case "memory.user.export": return `${value.memory.length} private user memory record(s) exported at ${value.exported_at} · omits ${value.omitted.join(", ")}\n${value.memory.map((record) => `${record.id}  ${record.hash}\n  ${record.content}\n  provenance: ${record.provenance}`).join("\n")}`;
    case "memory.retention.show": case "memory.retention.set": return `process memory: ${value.process_max_age_days === null ? "kept" : `${value.process_max_age_days} day(s)`} · project memory: ${value.project_max_age_days === null ? "kept" : `${value.project_max_age_days} day(s)`} · user memory is never subject to a project policy`;
    case "memory.retention.apply": return value.deleted.length ? `Deleted ${value.deleted.length} expired record(s) at ${value.applied_at}: ${value.deleted.map((record) => `${record.id} (${record.scope}, created ${record.created_at})`).join(", ")}` : `No memory record exceeded the retention policy at ${value.applied_at}.`;
    case "tickets.list": return value.length ? value.map(formatTicket).join("\n") : "No tickets.";
    case "tickets.source": return `source ${value.source ?? "unknown"} · id ${value.source_id ?? "none"} · revision ${value.source_revision ?? "none"} · reconciliation ${value.reconciliation_required ? "REQUIRED" : "not required"}${value.workspace ? ` · ${value.workspace}` : ""}`;
    case "plans.create": return `${formatPlanRecord(value.plan)}\nworkflow run: ${runLine(value.run, options)}`;
    case "plans.list": return value.length ? value.map((plan) => `${plan.id}  r${plan.revision}  ${plan.hash}`).join("\n") : "No plan revisions.";
    case "plans.show": return formatPlanRecord(value);
    case "plans.approve": return `Approved plan ${value.approval.plan_id} r${value.approval.plan_revision} by ${value.approval.approved_by} (hash ${value.approval.plan_hash})\nworkflow run: ${runLine(value.run, options)}`;
    case "runs.stream": return `Followed ${value.run_id}: ${value.events_followed} event(s), last sequence ${value.last_sequence}, run ${value.state}.`;
    case "runs.candidate": return formatCandidate(value, options);
    case "runs.diff": return [`Diff for ${value.candidate_hash}  ${value.repository_id} · base ${value.base_commit} · candidate commit ${value.commit}`, value.diff || (value.truncated ? "Diff omitted because it exceeds the display limit." : "No changes."), ...(value.truncated ? ["This diff is truncated. It does not show all candidate changes."] : []), ...(value.worktree_drift ? [value.worktree_drift] : []), ...(value.files ? value.files.map((file) => `  ${file.path} · ${file.status} · ${file.shown}`) : [])].join("\n");
    case "runs.worktrees": return value.length ? value.map((lease) => `${lease.id}  ${p(lease.state, leaseTone[lease.state])}  ${lease.repository_id}  ${lease.path}${lease.candidate_commit ? ` · candidate ${lease.candidate_commit}` : ""}${lease.reason ? ` · ${lease.reason}` : ""}`).join("\n") : "No worktree leases.";
    case "runs.attempts": return value.length ? value.map((attempt) => `attempt ${attempt.number}  ${attempt.state}  task ${attempt.task_id}  ${when(attempt.started_at)}${attempt.finished_at ? ` → ${when(attempt.finished_at)}` : ""}`).join("\n") : "No writer attempts recorded.";
    case "runs.tasks": return value.length ? value.flatMap(taskLines).join("\n") : "No task records: a single-task implementer plan runs the M2c writer path and records no task graph.";
    case "projection.home": return formatHome(value, options);
    case "projection.board": return formatBoard(value, options);
    case "artifacts.read": return value || "Empty log.";
    case "orbit.status": return formatOrbit(value, options);
    case "orbit.exec": case "orbit.run": case "orbit.sync": return formatOrbitExecution(value, options);
    case "orbit.sandbox": return formatSandboxPlan(value, options);
    case "shutdown": return `Runtime ${value.status}. Runs, candidates and worktrees stay durable; start it again with the same data directory and token.`;
    default: return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
}

export { eventLine, runLine };
