// Human-readable rendering of runtime records. Every state is shown as the runtime's unchanged
// text (the same words the desktop badges show); the runtime's reasons and the shared next step
// follow the state. Nothing here decides what is allowed: it prints the runtime's decisions.
import { baselineStep, nextStep } from "@luuna/api-client";

const short = (hash) => (typeof hash === "string" && hash.length > 20 ? `${hash.slice(0, 19)}…` : String(hash ?? ""));
const when = (value) => (typeof value === "string" ? value.replace("T", " ").replace(/\.\d+Z$/, "Z") : "");
const dollars = (micros) => `$${(Number(micros ?? 0) / 1_000_000).toFixed(4)}`;

function runLine(run) {
  const kind = run.metadata?.kind;
  const what = kind === "baseline" ? `baseline · ${run.metadata.repository_id ?? ""} · manifest r${run.metadata.manifest_revision ?? "?"}` : kind === "workflow" ? `workflow · plan ${run.metadata.plan_id ?? ""} r${run.metadata.plan_revision ?? "?"}` : typeof run.metadata?.prompt === "string" ? `session · ${run.metadata.prompt.slice(0, 60)}` : "session";
  return `${run.id}  ${run.state}  ${what}  ${when(run.created_at)}`;
}

function eventLine(event) {
  const reason = typeof event.payload?.reason === "string" ? `  reason: ${event.payload.reason}` : "";
  const state = typeof event.payload?.state === "string" ? `  ${event.payload.state}` : "";
  return `${String(event.sequence).padStart(5)}  ${when(event.timestamp)}  ${event.type}${state}${reason}`;
}

function checkLine(result) {
  return `  ${result.recipe_id}: ${result.status}${result.exit_code === null || result.exit_code === undefined ? "" : ` (exit ${result.exit_code})`}${result.tests_detected !== undefined ? ` · ${result.tests_detected} test(s) detected` : ""}${result.reason ? ` · ${result.reason}` : ""}${result.artifact_refs?.length ? ` · logs: ${result.artifact_refs.join(", ")}` : ""}`;
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

export function formatCandidate(view) {
  if (!view.evidence) return ["No candidate is recorded for this run.", ...(view.active ? ["The runtime is running the scoped writer."] : [])].join("\n");
  const evidence = view.evidence;
  const actions = { validate: view.validate_allowed, revalidate: view.revalidate_allowed, repair: view.repair_allowed, reasons: view.decision_reasons ?? {} };
  const lines = [
    `Candidate r${evidence.candidate.revision}  ${evidence.status}`,
    `candidate hash: ${evidence.candidate.hash}`,
    `approved plan hash: ${evidence.candidate.plan_hash}`,
    ...Object.entries(evidence.candidate.repository_commits).map(([id, commit]) => `${id} commit: ${commit}`),
    `checks (${evidence.results.length} result(s)):`,
    ...evidence.results.map(checkLine),
  ];
  if (evidence.review) lines.push(`independent review: ${evidence.review.verdict} (${evidence.review.findings.length} finding(s); session ${evidence.review.reviewer_session})`, ...evidence.review.findings.map((finding) => `  ${finding.severity} ${finding.path}:${finding.line} ${finding.explanation}`));
  else lines.push("independent review: none recorded");
  if (evidence.reason) {
    lines.push(`reason: ${evidence.reason}`);
    const step = nextStep(evidence.reason, actions);
    if (step) lines.push(`next: ${step}`);
  }
  lines.push(...decisions(view));
  if (view.usage) lines.push(`usage: ${view.usage.attempts} of ${view.usage.max_attempts} writer attempt(s) · ${view.usage.elapsed_seconds}s of ${view.usage.timeout_seconds}s · ${dollars(view.usage.cost_usd_micros)} of ${dollars(view.usage.cost_budget_usd_micros)} · ${view.usage.repairs} repair(s)${view.usage.cost_unreported ? " · some model spend was reported without a cost" : ""}`);
  return lines.join("\n");
}

function formatBaseline(baseline) {
  const step = baseline.reason ? baselineStep(baseline.status, baseline.reason) : "";
  return [`${baseline.run_id}  ${baseline.status}  manifest r${baseline.manifest_revision} · commit ${short(baseline.identity?.commit)} · ${baseline.results?.length ?? 0}/${baseline.required_checks?.length ?? 0} required results`, ...(baseline.reason ? [`  reason: ${baseline.reason}${step ? `  next: ${step}` : ""}`] : []), ...(baseline.results ?? []).map(checkLine)].join("\n");
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
  ].join("\n");
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

/** Renders one command result for a terminal; `id` is the catalog id. */
export function format(id, value) {
  if (value === undefined || value === null) return "";
  switch (id) {
    case "health": return `runtime ${value.status} · Pi ${value.pi_version} · native execution ${value.native_execution ? "yes" : "no"} · build ${value.build_identity ?? "unknown"}`;
    case "projects.list": return value.length ? value.map((project) => `${project.id}  ${project.revision > 0 ? `manifest r${project.revision}` : "unconfirmed"}  ${project.name}`).join("\n") : "No projects registered.";
    case "projects.show": case "projects.register": case "projects.manifest.confirm": case "projects.repositories.rebind": return formatProject(value);
    case "projects.discover": return formatDiscovery(value);
    case "projects.events": case "runs.events": return value.length ? value.map(eventLine).join("\n") : "No events.";
    case "baselines.start": case "runs.start": case "runs.show": case "runs.cancel": case "runs.implement": case "runs.validate": case "runs.repair": return runLine(value);
    case "baselines.list": return value.length ? value.map(formatBaseline).join("\n") : "No baselines recorded.";
    case "runs.list": return value.length ? value.map(runLine).join("\n") : "No runs.";
    case "components.status": case "components.enable": return `components ${value.enabled ? "enabled" : "not enabled"}${value.workspace_path ? ` · ${value.workspace_path}` : ""}${value.reason ? ` · ${value.reason}` : ""}`;
    case "memory.list": return value.length ? value.map((record) => `${record.id}  ${record.scope}  ${record.hash}\n  ${record.content}\n  provenance: ${record.provenance}`).join("\n") : "No memory records in this view.";
    case "memory.create": return `${value.id}  ${value.scope}  ${value.hash}`;
    case "memory.delete": return value.deleted ? "Memory deleted." : "Memory not deleted.";
    case "prompts.list": return value.length ? value.map((prompt) => `${prompt.name}  version ${prompt.version}${prompt.hash ? `  ${prompt.hash}` : ""}`).join("\n") : "No prompts.";
    case "prompts.create": case "prompts.render": return `${value.name}  version ${value.version}  ${value.hash}\n${value.body}`;
    case "tickets.create": case "tickets.show": case "tickets.reconcile": return formatTicket(value);
    case "tickets.list": return value.length ? value.map(formatTicket).join("\n") : "No tickets.";
    case "tickets.source": return `source ${value.source ?? "unknown"} · id ${value.source_id ?? "none"} · revision ${value.source_revision ?? "none"} · reconciliation ${value.reconciliation_required ? "REQUIRED" : "not required"}${value.workspace ? ` · ${value.workspace}` : ""}`;
    case "plans.create": return `${formatPlanRecord(value.plan)}\nworkflow run: ${runLine(value.run)}`;
    case "plans.list": return value.length ? value.map((plan) => `${plan.id}  r${plan.revision}  ${plan.hash}`).join("\n") : "No plan revisions.";
    case "plans.show": return formatPlanRecord(value);
    case "plans.approve": return `Approved plan ${value.approval.plan_id} r${value.approval.plan_revision} by ${value.approval.approved_by} (hash ${value.approval.plan_hash})\nworkflow run: ${runLine(value.run)}`;
    case "runs.stream": return `Followed ${value.run_id}: ${value.events_followed} event(s), last sequence ${value.last_sequence}, run ${value.state}.`;
    case "runs.candidate": return formatCandidate(value);
    case "runs.diff": return [`Diff for ${value.candidate_hash}  ${value.repository_id} · base ${value.base_commit} · candidate commit ${value.commit}`, value.diff || (value.truncated ? "Diff omitted because it exceeds the display limit." : "No changes."), ...(value.truncated ? ["This diff is truncated. It does not show all candidate changes."] : []), ...(value.worktree_drift ? [value.worktree_drift] : []), ...(value.files ? value.files.map((file) => `  ${file.path} · ${file.status} · ${file.shown}`) : [])].join("\n");
    case "runs.worktrees": return value.length ? value.map((lease) => `${lease.id}  ${lease.state}  ${lease.repository_id}  ${lease.path}${lease.candidate_commit ? ` · candidate ${lease.candidate_commit}` : ""}${lease.reason ? ` · ${lease.reason}` : ""}`).join("\n") : "No worktree leases.";
    case "runs.attempts": return value.length ? value.map((attempt) => `attempt ${attempt.number}  ${attempt.state}  task ${attempt.task_id}  ${when(attempt.started_at)}${attempt.finished_at ? ` → ${when(attempt.finished_at)}` : ""}`).join("\n") : "No writer attempts recorded.";
    case "artifacts.read": return value || "Empty log.";
    case "shutdown": return `Runtime ${value.status}. Runs, candidates and worktrees stay durable; start it again with the same data directory and token.`;
    default: return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
}

export { eventLine, runLine };
