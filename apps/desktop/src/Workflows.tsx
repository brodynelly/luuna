import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AttemptRecord, CandidateDiff, CandidateView, ComponentContext, CreatePlanRequest, DependencyOverride, LuunaClient, PlanBudgetRequest, PlanRevision, PublicationRecord, RunRecord, SetupCheckRequest, TaskRecord, TaskRole, TaskState, TestingPrerequisite, Ticket, TicketPurpose, TicketSourceStatus, UpdateTicketRequest, WorktreeLease } from "@luuna/api-client";
import { ApiError, DEFAULT_PLAN_BUDGETS, TASK_ROLES, advisoryRole, overrideFromRefusal, planBudgetProblem, planRequestForTasks } from "@luuna/api-client";
import { advanceWorkflowReplay, allowedActions, canCancel, planBlocker, planSupersedes, settleAction, workflowNeedsRefresh } from "./workflow-state";
import { CandidateReview } from "./CandidateReview";
import { retryIdentity } from "./ProjectComponents";
import { actionFailure, describeFailure, nextStep, utf8Bytes } from "./failures";
import { StatusBadge } from "./design/StatusBadge";
import { runTone } from "./design/tone";

const message = describeFailure;

/** Events are read after each workflow's cursor, at most this many per request. */
const EVENT_PAGE = 1000;

/** The runtime's ticket and approver limits, in UTF-8 bytes. */
export const TEXT_LIMITS = { title: 200, intent: 16_000, criterion: 16_000, approver: 200 } as const;

/** Budget fields as typed; the cost is entered in dollars and sent in micro-dollars. */
export function parseBudgets(attempts: string, timeoutSeconds: string, costDollars: string): PlanBudgetRequest {
  const number = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));
  return { max_attempts: number(attempts), timeout_seconds: number(timeoutSeconds), cost_usd_micros: Math.round(number(costDollars) * 1_000_000) };
}

/**
 * One row of the desktop's task-graph editor (ADR 0017): a repository, its writer paths and the
 * rows it waits for; since ADR 0023 also its role (an advisory role reads only) and the advisory
 * task of an earlier revision it derives from.
 */
export interface TaskRow { repository_id: string; paths: string; write: boolean; depends_on: string[]; role?: TaskRole; derived_from_task?: string }

/**
 * The plan request the desktop sends, through the builder the TUI shares (R02): one row is the
 * single-task form in its pre-M4 shape; several rows are a task graph whose task ids are the
 * repository ids, with `max_workers` sent only when it is not the default. Roles and derivations
 * travel only when given, `overrides` are the plan's dependency overrides (ADR 0023) and `checks`
 * a testing-setup plan's proposed recipes (ADR 0022).
 */
export function planRequestFromRows(rows: TaskRow[], budgets: PlanBudgetRequest, componentContext?: ComponentContext, overrides: DependencyOverride[] = [], checks: SetupCheckRequest[] = []): Omit<CreatePlanRequest, "idempotency_key"> {
  return planRequestForTasks(rows.map((row) => ({ repository_id: row.repository_id, paths: row.paths.split(","), operations: row.write && !advisoryRole(row.role) ? ["read", "write"] : ["read"], depends_on: row.depends_on, ...(row.role && { role: row.role }), ...(row.derived_from_task?.trim() && { derived_from_task: row.derived_from_task }) })), budgets, { componentContext, dependencyOverrides: overrides, checks });
}

/** One row of the setup-plan form: a check recipe as the developer types it (ADR 0022). */
export interface CheckRow { id: string; executable: string; args: string; cwd: string; timeout: string }

export const EMPTY_CHECK_ROW: CheckRow = { id: "unit", executable: "", args: "", cwd: "", timeout: "600" };

/** The recipes a setup plan proposes, in the manifest-check shape; rows without an id or an executable are skipped. */
export function setupChecksFromRows(rows: CheckRow[]): SetupCheckRequest[] {
  return rows.filter((row) => row.id.trim() && row.executable.trim()).map((row) => ({ id: row.id.trim(), executable: row.executable.trim(), args: row.args.split(/\s+/).filter(Boolean), ...(row.cwd.trim() && { cwd: row.cwd.trim() }), timeout_seconds: Number(row.timeout) }));
}

/** The ticket the offer pre-fills: purpose testing_setup, scoped to the offered repository, naming the runtime's reason and next step. */
export function setupTicketDraft(offer: TestingPrerequisite): { purpose: TicketPurpose; title: string; intent: string; criteria: string; repositoryIds: string[] } {
  return {
    purpose: "testing_setup",
    title: `Establish the testing setup for ${offer.repository_id}`,
    intent: `Repository ${offer.repository_id} has no usable testing setup: ${offer.reason}. Add the test harness and at least one real test so that the proposed required checks execute a counted test in the candidate worktree. Runtime next step: ${offer.next}`,
    criteria: ["The proposed required check recipes run in the candidate worktree and exit 0", "A recognised test runner reports at least one executed test", "No feature code changes"].join("\n"),
    repositoryIds: [offer.repository_id],
  };
}

/** The rows the derive convenience pre-fills from an advisory task's proposal (ADR 0023 point 4): every task derives from the advisory task. */
export function rowsFromProposal(task: TaskRecord): TaskRow[] {
  const proposed = task.advisory_result?.proposed_tasks ?? [];
  const ids = proposed.map((item) => item.repository_id);
  return proposed.map((item) => {
    const role = TASK_ROLES.includes(item.role as TaskRole) ? item.role as TaskRole : "implementer";
    return { repository_id: item.repository_id, paths: (item.paths ?? []).join(",") || "src", write: !advisoryRole(role), depends_on: (item.depends_on ?? []).map((dependency) => proposed.find((other) => other.id === dependency)?.repository_id ?? dependency).filter((dependency) => ids.includes(dependency)), role, derived_from_task: task.task_id };
  });
}

/** Task states `POST …/implement` with `task_id` resumes (ADR 0017 point 8). */
export const RESUMABLE_TASK_STATES: readonly TaskState[] = ["failed", "blocked", "interrupted"];

/** Whether a task of this run can be resumed under the original approval: the run settled failed or interrupted and the task did not complete. */
export function taskResumable(run: Pick<RunRecord, "state">, task: Pick<TaskRecord, "state">): boolean {
  return (run.state === "failed" || run.state === "interrupted") && RESUMABLE_TASK_STATES.includes(task.state);
}

/** The draft of a ticket edit as the form holds it. */
export interface TicketDraft { title: string; intent: string; criteria: string; repositoryIds: string[] }

/**
 * The edit request for a ticket: only the fields whose value differs from the ticket, at the
 * revision the panel displayed; `null` when nothing changed.
 */
export function ticketEditRequest(ticket: Ticket, draft: TicketDraft): UpdateTicketRequest | null {
  const title = draft.title.trim();
  const intent = draft.intent.trim();
  const criteria = draft.criteria.split("\n").map((line) => line.trim()).filter(Boolean);
  const repositories = draft.repositoryIds.filter(Boolean);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((item, index) => item === b[index]);
  const request: UpdateTicketRequest = {
    expected_revision: ticket.revision,
    ...(title && title !== ticket.title && { title }),
    ...(intent && intent !== ticket.intent && { intent }),
    ...(criteria.length && !same(criteria, ticket.acceptance_criteria) && { acceptance_criteria: criteria }),
    ...(repositories.length && !same(repositories, ticket.repository_ids) && { repository_ids: repositories }),
  };
  return Object.keys(request).length > 1 ? request : null;
}

/** Each ticket field measured as the runtime measures it; criteria count their longest line. */
export function ticketTextSizes(title: string, intent: string, criteria: string[]) {
  return { title: utf8Bytes(title), intent: utf8Bytes(intent), criterion: Math.max(0, ...criteria.map(utf8Bytes)) };
}

/**
 * One delivery identity per plan draft: a retry after a lost response replays the revision it
 * created. The draft is the request planned on top of `latestRevision`, so once the panel shows
 * the revision it created, planning again is a new draft with a new key.
 */
export function planRetryIdentity(previous: { content: string; key: string } | null, latestRevision: number, request: Omit<CreatePlanRequest, "idempotency_key">, create?: () => string) {
  return retryIdentity(previous, JSON.stringify({ after: latestRevision, request }), create);
}

export function ByteCount({ id, bytes, limit, prefix = "" }: { id: string; bytes: number; limit: number; prefix?: string }) {
  return <small id={id} className="byte-count meta">{prefix}{bytes} of {limit} bytes{bytes > limit ? " · too long" : ""}</small>;
}

/** What the panel last read for one workflow run; events are only ever read after `cursor`. */
export interface RunSnapshot {
  revision: number;
  updated: string;
  cursor: number;
  reason: string;
  leases: WorktreeLease[];
  candidate: CandidateView;
}

export interface TicketState {
  list: Ticket[];
  sources: Record<string, TicketSourceStatus>;
  plans: Record<string, PlanRevision[]>;
}

/**
 * One read of a project's workflows. A poll re-reads only workflows that are active; when any
 * workflow moved (or `full` asks for it) tickets, plans and every candidate are re-read, because
 * one workflow's transition can change another's decisions (one writer per repository). Events
 * are always read after each workflow's last cursor, never replayed from the start.
 */
export async function readWorkflows(client: LuunaClient, projectId: string, known: Map<string, RunSnapshot>, full: boolean, signal: AbortSignal): Promise<{ runs: RunRecord[]; snapshots: Map<string, RunSnapshot>; tickets: TicketState | null } | null> {
  const all = await client.listRuns(signal);
  if (signal.aborted) return null;
  const runs = all.filter((run) => run.metadata.kind === "workflow" && run.project_id === projectId);
  const moved = (run: RunRecord) => { const seen = known.get(run.id); return !seen || seen.revision !== run.revision || seen.updated !== run.updated_at; };
  const transition = full || runs.length !== known.size || runs.some(moved);
  const stale = runs.filter((run) => transition || workflowNeedsRefresh(run, known.get(run.id)?.candidate));
  const [tickets, fresh] = await Promise.all([
    transition ? readTickets(client, projectId, signal) : Promise.resolve(null),
    boundedMap(stale, async (run) => {
      const seen = known.get(run.id);
      const [leases, replay, candidate] = await Promise.all([
        client.worktrees(run.id, signal),
        readWorkflowReplay(client, run.id, seen, signal),
        client.candidate(run.id, signal),
      ]);
      return { run, leases, replay, candidate };
    }),
  ]);
  if (signal.aborted) return null;
  const snapshots = new Map<string, RunSnapshot>();
  for (const run of runs) {
    const seen = known.get(run.id);
    const read = fresh.find((item) => item.run.id === run.id);
    if (!read) { if (seen) snapshots.set(run.id, seen); continue; }
    snapshots.set(run.id, { revision: run.revision, updated: run.updated_at, cursor: read.replay.cursor, reason: read.replay.reason, leases: read.leases, candidate: read.candidate });
  }
  return { runs, snapshots, tickets };
}

/** Reduce and release each bounded page before requesting more history. */
export async function readWorkflowReplay(client: Pick<LuunaClient, "events">, runId: string, seen: Pick<RunSnapshot, "cursor" | "reason"> | undefined, signal: AbortSignal) {
  let replay = { cursor: seen?.cursor ?? 0, reason: seen?.reason ?? "" };
  for (;;) {
    signal.throwIfAborted();
    const page = await client.events(runId, replay.cursor, signal, { limit: EVENT_PAGE });
    signal.throwIfAborted();
    if (!page.length) return replay;
    const next = advanceWorkflowReplay(runId, replay, page);
    if (next.cursor <= replay.cursor) throw new Error("Workflow event page did not advance its cursor.");
    replay = next;
  }
}

/** Run `task` over `items` with at most four requests in flight, keeping input order. */
export async function boundedMap<T, R>(items: T[], task: (item: T) => Promise<R>, limit = 4): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await task(items[index]); }
  }));
  return results;
}

async function readTickets(client: LuunaClient, projectId: string, signal: AbortSignal): Promise<TicketState> {
  const list = await client.listTickets(projectId, signal);
  const details = await boundedMap(list, (ticket) => Promise.all([
    client.listPlans(ticket.id, signal),
    client.ticket(ticket.id, signal),
    ticket.source === "missions" ? client.ticketSource(ticket.id, signal) : Promise.resolve(null),
  ]));
  const planLists = details.map(([plans]) => plans);
  const sources = details.map(([, , source]) => source);
  return {
    list: details.map(([, ticket]) => ticket),
    sources: Object.fromEntries(list.flatMap((ticket, index) => sources[index] ? [[ticket.id, sources[index]!]] : [])),
    plans: Object.fromEntries(list.map((ticket, index) => [ticket.id, planLists[index]])),
  };
}

interface Props {
  client: LuunaClient | null;
  projectId: string;
  repositoryId: string;
  /** Every registered repository; the task-graph editor and ticket scope choose among them. */
  repositoryIds?: string[];
  /** The runtime's testing-setup offers from the project view (ADR 0022), one per repository without a usable testing setup. */
  prerequisites?: TestingPrerequisite[];
  manifestConfirmed: boolean;
  /** Incremented when the runtime answers again after an outage. */
  connectionEpoch?: number;
  componentContext?: ComponentContext;
  componentsEnabled?: boolean;
  componentEpoch?: number;
  onChanged: () => void;
}

/**
 * A source-revisioned ticket, an exact plan approval and the candidate workflow.
 * The runtime owns all execution, validation, review and repair decisions.
 */
export function Workflows({ client, projectId, repositoryId, repositoryIds = [repositoryId], prerequisites = [], manifestConfirmed, connectionEpoch = 0, componentContext, componentsEnabled = false, componentEpoch = 0, onChanged }: Props) {
  const [tickets, setTickets] = useState<TicketState>({ list: [], sources: {}, plans: {} });
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [snapshots, setSnapshots] = useState<Map<string, RunSnapshot>>(new Map());
  const [diffs, setDiffs] = useState<Record<string, CandidateDiff>>({});
  const [attemptLists, setAttemptLists] = useState<Record<string, AttemptRecord[]>>({});
  const [publications, setPublications] = useState<Record<string, PublicationRecord>>({});
  const [taskLists, setTaskLists] = useState<Record<string, TaskRecord[]>>({});
  const [logs, setLogs] = useState<Record<string, { candidateHash: string; artifactId: string; text: string }>>({});
  const [title, setTitle] = useState("");
  const [intent, setIntent] = useState("");
  const [criteria, setCriteria] = useState("");
  const [purpose, setPurpose] = useState<TicketPurpose>("feature");
  const [paths, setPaths] = useState("src");
  const [write, setWrite] = useState(true);
  const [ticketRepositories, setTicketRepositories] = useState<string[]>([repositoryId]);
  // The task graph editor: the single-task form is the default; adding a row opens the graph.
  const [taskRows, setTaskRows] = useState<TaskRow[]>([]);
  const [maxWorkers, setMaxWorkers] = useState("1");
  // The plan's dependency overrides (ADR 0023): shown once the runtime refuses a plan for a relationship, or when a row exists.
  const [overrideRows, setOverrideRows] = useState<DependencyOverride[]>([]);
  // The offer a refused implementation carried (ADR 0022), beside the project view's offers.
  const [refusedOffer, setRefusedOffer] = useState<TestingPrerequisite | null>(null);
  const [approver, setApprover] = useState("developer");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [attempts, setAttempts] = useState(String(DEFAULT_PLAN_BUDGETS.max_attempts));
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(DEFAULT_PLAN_BUDGETS.timeout_seconds));
  const [costDollars, setCostDollars] = useState((DEFAULT_PLAN_BUDGETS.cost_usd_micros / 1_000_000).toFixed(2));
  const [autoRepair, setAutoRepair] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const ticketDelivery = useRef<{ content: string; key: string } | null>(null);
  const planDelivery = useRef<Record<string, { content: string; key: string }>>({});
  const known = useRef(new Map<string, RunSnapshot>());
  // A forced load re-reads tickets, plans and every candidate; a poll re-reads only what moved.
  const forced = useRef(true);
  const operation = useRef<AbortController | null>(null);

  function reload() {
    forced.current = true;
    setTick((value) => value + 1);
  }

  async function load(signal: AbortSignal): Promise<boolean> {
    if (!client) return false;
    const read = await readWorkflows(client, projectId, known.current, forced.current, signal);
    if (!read || signal.aborted) return false;
    known.current = read.snapshots;
    forced.current = false;
    setSnapshots(read.snapshots);
    setRuns(read.runs);
    if (read.tickets) setTickets(read.tickets);
    return read.runs.some((run) => workflowNeedsRefresh(run, read.snapshots.get(run.id)?.candidate));
  }

  useEffect(() => () => operation.current?.abort(), []);

  useEffect(() => {
    // An action started against the previous runtime or project must not report into this one.
    operation.current?.abort();
    setBusy(false);
    setTickets({ list: [], sources: {}, plans: {} });
    setRuns([]);
    setSnapshots(new Map());
    setDiffs({});
    setAttemptLists({});
    setLogs({});
    setError("");
    setLoadError("");
    setAutoRepair(false);
    ticketDelivery.current = null;
    planDelivery.current = {};
    known.current = new Map();
    forced.current = true;
  }, [client, projectId]);

  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    // Schedule after each request settles so slow requests are never repeatedly
    // aborted by the polling interval; a transient failure gets its own retry.
    load(controller.signal).then((follow) => {
      if (!controller.signal.aborted) setLoadError("");
      if (!controller.signal.aborted && follow) timer = setTimeout(() => setTick((value) => value + 1), 1500);
    }).catch((failure) => {
      if (controller.signal.aborted) return;
      setLoadError(message(failure));
      timer = setTimeout(() => setTick((value) => value + 1), 3000);
    });
    return () => { controller.abort(); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, tick]);

  useEffect(() => {
    if (connectionEpoch > 0) reload();
  }, [connectionEpoch]);

  useEffect(() => { reload(); }, [componentEpoch]);

  function guarded(label: string, action: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    // Disconnecting or switching project aborts the controller: a late result then reports nothing.
    void settleAction(controller, action, {
      succeeded: () => { reload(); onChanged(); },
      // A refusal usually means the authoritative state moved; show it.
      failed: (failure) => {
        setError(actionFailure(label, failure));
        // The structured testing-setup offer of a refused implementation (ADR 0022).
        if (failure instanceof ApiError && failure.prerequisite) setRefusedOffer(failure.prerequisite);
        // A relationship refusal quotes the override that would allow the plan (ADR 0023): pre-fill it for the developer's justification.
        const suggested = failure instanceof ApiError ? overrideFromRefusal(failure.message) : null;
        if (suggested) setOverrideRows((rows) => rows.some((row) => row.consumer === suggested.consumer && row.producer === suggested.producer) ? rows : [...rows, suggested]);
        reload();
      },
      settled: () => setBusy(false),
    });
  }

  const scopedRepositories = ticketRepositories.filter((id) => repositoryIds.includes(id));
  const ticketRequest = {
    title: title.trim(), intent: intent.trim(),
    acceptance_criteria: criteria.split("\n").map((line) => line.trim()).filter(Boolean), repository_ids: scopedRepositories.length ? scopedRepositories : [repositoryId],
    ...(purpose !== "feature" && { purpose }),
  };
  // The offers shown: the project view's, plus the one a refused implementation carried for a repository the view does not name yet.
  const offers = [...prerequisites, ...(refusedOffer && !prerequisites.some((offer) => offer.repository_id === refusedOffer.repository_id) ? [refusedOffer] : [])];

  /** Pre-fills the ticket form from the runtime's offer; the developer reviews it and creates the ticket. */
  function prefillSetupTicket(offer: TestingPrerequisite) {
    const draft = setupTicketDraft(offer);
    setPurpose(draft.purpose);
    setTitle(draft.title);
    setIntent(draft.intent);
    setCriteria(draft.criteria);
    setTicketRepositories(draft.repositoryIds);
    if (typeof document !== "undefined") document.getElementById("ticket-title")?.focus();
  }
  const sizes = ticketTextSizes(ticketRequest.title, ticketRequest.intent, ticketRequest.acceptance_criteria);
  const tooLong = sizes.title > TEXT_LIMITS.title || sizes.intent > TEXT_LIMITS.intent || sizes.criterion > TEXT_LIMITS.criterion;

  function createTicket(event: FormEvent) {
    event.preventDefault();
    if (tooLong) return;
    const request = ticketRequest;
    ticketDelivery.current = retryIdentity(ticketDelivery.current, JSON.stringify(request));
    const key = ticketDelivery.current.key;
    guarded("Ticket creation", async (signal) => {
      if (!client) return;
      await client.createTicket(projectId, { idempotency_key: key, ...request }, signal);
      if (signal.aborted) return;
      setTitle("");
      setIntent("");
      setCriteria("");
      setPurpose("feature");
      ticketDelivery.current = null;
    });
  }

  function plan(ticket: Ticket, latestRevision: number, checks: SetupCheckRequest[] = []) {
    guarded("Planning", async (signal) => {
      if (!client) return;
      const budgets = parseBudgets(attempts, timeoutSeconds, costDollars);
      const problem = planBudgetProblem(budgets);
      if (problem) throw new Error(problem);
      const setup = ticket.purpose === "testing_setup";
      // A setup plan is exactly one writer task on the offered repository with the recipes from its form (ADR 0022).
      const rows: TaskRow[] = taskRows.length && !setup ? taskRows : [{ repository_id: ticket.repository_ids.includes(repositoryId) ? repositoryId : ticket.repository_ids[0] ?? repositoryId, paths, write, depends_on: [] }];
      const workers = rows.length > 1 ? Number(maxWorkers) : DEFAULT_PLAN_BUDGETS.max_workers;
      // The same builder the TUI uses, so both clients send one body for the same tasks.
      const request = planRequestFromRows(rows, { ...budgets, max_workers: workers }, componentsEnabled ? componentContext : undefined, setup ? [] : overrideRows, setup ? checks : []);
      const delivery = planRetryIdentity(planDelivery.current[ticket.id] ?? null, latestRevision, request);
      planDelivery.current[ticket.id] = delivery;
      await client.createPlan(ticket.id, { ...request, idempotency_key: delivery.key }, signal);
      if (signal.aborted) return;
      delete planDelivery.current[ticket.id];
    });
  }

  function approve(plan: PlanRevision) {
    guarded("Approval", async (signal) => {
      if (!client) return;
      const approvedBy = approver.trim() || "developer";
      if (utf8Bytes(approvedBy) > TEXT_LIMITS.approver) throw new Error(`The approver name is ${utf8Bytes(approvedBy)} bytes; the runtime accepts at most ${TEXT_LIMITS.approver} (UTF-8).`);
      await client.approvePlan(plan.id, { plan_revision: plan.revision, plan_hash: plan.hash, approved_by: approvedBy }, signal);
    });
  }

  function modelSettings(): { provider?: string; model?: string } {
    return { ...(provider.trim() && { provider: provider.trim() }), ...(model.trim() && { model: model.trim() }) };
  }

  function runFor(plan: PlanRevision): RunRecord | undefined {
    return runs.find((run) => run.metadata.plan_id === plan.id && run.metadata.plan_revision === plan.revision);
  }

  /** The derive convenience (ADR 0023 point 4): the next plan's rows are the proposal's tasks, each deriving from the advisory task; the developer edits and approves them like any plan. */
  function derive(task: TaskRecord) {
    const rows = rowsFromProposal(task);
    if (!rows.length) return;
    setTaskRows(rows);
    setMaxWorkers("1");
    if (typeof document !== "undefined") document.getElementById("plan-task-graph")?.scrollIntoView?.({ block: "start" });
  }

  const actions: TicketActions = {
    reconcile: (ticket) => guarded("Ticket reconciliation", async (signal) => { await client!.reconcileTicket(ticket.id, ticket.revision, signal); }),
    plan,
    derive,
    approve,
    update: (ticket, request) => guarded("Ticket edit", async (signal) => { if (client) await client.updateTicket(ticket.id, request, signal); }),
    implement: (run, taskId) => guarded(taskId ? "Task resumption" : "Implementation", async (signal) => { if (client) await client.implement(run.id, { ...(taskId && { task_id: taskId }), ...modelSettings() }, signal); }),
    cancel: (run) => guarded("Cancellation", async (signal) => { if (client) await client.cancelRun(run.id, signal); }),
    validate: (run, view) => guarded("Validation", async (signal) => {
      if (!client || !view.evidence) return;
      await client.validateCandidate(run.id, { candidate_hash: view.evidence.candidate.hash, auto_repair: autoRepair, ...modelSettings() }, signal);
    }),
    repair: (run, view) => guarded("Repair", async (signal) => {
      if (!client || !view.evidence) return;
      await client.repairCandidate(run.id, { candidate_hash: view.evidence.candidate.hash, ...modelSettings() }, signal);
    }),
    diff: (run) => guarded("Diff inspection", async (signal) => {
      if (!client) return;
      const diff = await client.candidateDiff(run.id, signal);
      if (!signal.aborted) setDiffs((previous) => ({ ...previous, [run.id]: diff }));
    }),
    publish: (run, view) => guarded("Publication", async (signal) => {
      if (!client || !view.evidence) return;
      const hash = view.evidence.candidate.hash;
      const record = await client.publish(run.id, { expected_hash: hash, idempotency_key: `publish-${run.id}-${hash.slice(7, 31)}` }, signal);
      if (!signal.aborted) setPublications((previous) => ({ ...previous, [run.id]: record }));
    }),
    publication: (run) => guarded("Publication inspection", async (signal) => {
      if (!client) return;
      const record = await client.publication(run.id, signal);
      if (!signal.aborted) setPublications((previous) => ({ ...previous, [run.id]: record }));
    }),
    reconcilePublication: (run) => guarded("Publication reconciliation", async (signal) => {
      if (!client) return;
      const record = await client.reconcilePublication(run.id, signal);
      if (!signal.aborted) setPublications((previous) => ({ ...previous, [run.id]: record }));
    }),
    repairPublication: (run, view) => guarded("Repair after a CI failure", async (signal) => {
      if (!client || !view.evidence) return;
      const { run: _started, ...record } = await client.repairPublication(run.id, { candidate_hash: view.evidence.candidate.hash, ...modelSettings() }, signal);
      if (!signal.aborted) setPublications((previous) => ({ ...previous, [run.id]: record }));
    }),
    tasks: (run) => guarded("Task graph inspection", async (signal) => {
      if (!client) return;
      const list = await client.tasks(run.id, signal);
      if (!signal.aborted) setTaskLists((previous) => ({ ...previous, [run.id]: list }));
    }),
    attempts: (run) => guarded("Attempt inspection", async (signal) => {
      if (!client) return;
      const list = await client.attempts(run.id, signal);
      if (!signal.aborted) setAttemptLists((previous) => ({ ...previous, [run.id]: list }));
    }),
    artifact: (run, view, artifactId) => guarded("Log inspection", async (signal) => {
      if (!client || !view.evidence) return;
      const text = await client.artifact(run.id, artifactId, signal);
      if (!signal.aborted) setLogs((previous) => ({ ...previous, [run.id]: { candidateHash: view.evidence!.candidate.hash, artifactId, text } }));
    }),
  };

  return <section className="workflows subpanel" aria-labelledby="workflows-heading">
    <div className="panel-heading"><h3 id="workflows-heading">Tickets, plans and candidates</h3><button type="button" className="text-button" disabled={!client || busy} data-capability="tickets.list tickets.show tickets.source plans.list runs.candidate runs.worktrees" onClick={reload}>Refresh workflows</button></div>
    <p className="scope">{componentsEnabled ? "Tickets are authoritative in luuna-missions; reconcile external edits before re-planning." : "Tickets use legacy local storage until you enable project components above."} Approve the complete immutable plan, then run the scoped writer in its managed worktree. The runtime binds validation and independent review to the exact candidate hash.</p>
    {(error || loadError) && <div className="error" role="alert">{error || loadError}<button className="text-button" type="button" onClick={() => { setError(""); setLoadError(""); }}>Dismiss</button></div>}
    {offers.length > 0 && <ul className="prerequisite-offers record-list" aria-label="Testing-setup prerequisites">{offers.map((offer) => <li key={offer.repository_id} className="record record-headed prerequisite-offer" data-tone="attention">
      <StatusBadge tone="attention">testing setup needed</StatusBadge>
      <strong>Repository <code>{offer.repository_id}</code> has no usable testing setup; feature plans for it are refused until the prerequisite is established.</strong>
      <small className="failure-note" data-tone="attention">{offer.reason} <span className="recovery-note">{offer.next}</span></small>
      <div className="actions">
        <button type="button" disabled={!client || busy || !manifestConfirmed} data-capability="tickets.create" onClick={() => prefillSetupTicket(offer)}>Create the testing-setup ticket for {offer.repository_id}</button>
        <small>Pre-fills the ticket form below with purpose testing setup, scoped to {offer.repository_id}; you review it and create the ticket, then plan it with the check recipes that will become the baseline.</small>
      </div>
    </li>)}</ul>}
    <form onSubmit={createTicket} className="ticket-form form-group" id="ticket-form">
      <fieldset disabled={!client || busy || !manifestConfirmed}>
        <label>Ticket title<input id="ticket-title" value={title} onChange={(event) => setTitle(event.target.value)} required aria-describedby="ticket-title-bytes" placeholder="Implement the greeting" /></label>
        <ByteCount id="ticket-title-bytes" bytes={sizes.title} limit={TEXT_LIMITS.title} />
        <label>Intent<textarea value={intent} onChange={(event) => setIntent(event.target.value)} required rows={3} aria-describedby="ticket-intent-bytes" placeholder="What should change and why" /></label>
        <ByteCount id="ticket-intent-bytes" bytes={sizes.intent} limit={TEXT_LIMITS.intent} />
        <label>Acceptance criteria (one per line)<textarea value={criteria} onChange={(event) => setCriteria(event.target.value)} required rows={2} aria-describedby="ticket-criteria-bytes" /></label>
        <ByteCount id="ticket-criteria-bytes" prefix="Longest criterion: " bytes={sizes.criterion} limit={TEXT_LIMITS.criterion} />
        <label>Purpose<select aria-label="Ticket purpose" value={purpose} onChange={(event) => setPurpose(event.target.value as TicketPurpose)}><option value="feature">feature</option><option value="testing_setup">testing setup (the prerequisite a repository without a usable testing setup is offered)</option></select></label>
        {repositoryIds.length > 1 && <div className="ticket-repositories field-row" role="group" aria-label="Repositories the ticket may touch">{repositoryIds.map((id) => <label key={id} className="checkbox"><input type="checkbox" checked={scopedRepositories.includes(id)} onChange={(event) => setTicketRepositories((current) => event.target.checked ? [...current.filter((item) => item !== id), id] : current.filter((item) => item !== id))} /> {id}</label>)}</div>}
        <div className="form-footer"><small>{!manifestConfirmed ? "Confirm a manifest before creating tickets." : tooLong ? "Shorten the field marked too long: the runtime counts UTF-8 bytes, so accented letters, CJK text and emoji take more than one." : repositoryIds.length > 1 ? "Tickets are scoped to the registered repositories you tick; a plan's tasks stay within them." : "Tickets are scoped to this project's registered repository."}</small><button className="primary" disabled={!title.trim() || !intent.trim() || !criteria.trim() || tooLong} data-capability="tickets.create">Create ticket</button></div>
      </fieldset>
    </form>
    <div className="tray run-settings">
      {taskRows.length === 0 ? <div className="plan-controls field-row">
        <label>Writer paths (comma separated)<input value={paths} onChange={(event) => setPaths(event.target.value)} spellCheck={false} /></label>
        <label className="checkbox"><input type="checkbox" checked={write} onChange={(event) => setWrite(event.target.checked)} /> allow writes</label>
        <label>Approver<input value={approver} onChange={(event) => setApprover(event.target.value)} /></label>
        {repositoryIds.length > 1 && <button type="button" className="text-button" onClick={() => setTaskRows([{ repository_id: repositoryId, paths, write, depends_on: [] }, { repository_id: repositoryIds.find((id) => id !== repositoryId) ?? repositoryId, paths: "src", write: true, depends_on: [] }])}>Plan a task graph across repositories</button>}
      </div> : <div className="plan-task-graph" id="plan-task-graph">
        <ul className="task-rows record-list" aria-label="Plan tasks">{taskRows.map((row, index) => <li key={index} className="record task-row field-row">
          <label>Repository<select aria-label={`Task ${index + 1} repository`} value={row.repository_id} onChange={(event) => setTaskRows((rows) => rows.map((item, i) => i === index ? { ...item, repository_id: event.target.value } : item))}>{[...new Set([...repositoryIds, row.repository_id])].map((id) => <option key={id} value={id}>{id}</option>)}</select></label>
          <label>Role<select aria-label={`Task ${index + 1} role`} value={row.role ?? "implementer"} onChange={(event) => setTaskRows((rows) => rows.map((item, i) => i === index ? { ...item, role: event.target.value as TaskRole, write: advisoryRole(event.target.value) ? false : item.write } : item))}>{TASK_ROLES.map((role) => <option key={role} value={role}>{role.replace(/_/g, " ")}</option>)}</select></label>
          <label>Writer paths (comma separated)<input value={row.paths} onChange={(event) => setTaskRows((rows) => rows.map((item, i) => i === index ? { ...item, paths: event.target.value } : item))} spellCheck={false} /></label>
          <label className="checkbox"><input type="checkbox" checked={row.write && !advisoryRole(row.role)} disabled={advisoryRole(row.role)} onChange={(event) => setTaskRows((rows) => rows.map((item, i) => i === index ? { ...item, write: event.target.checked } : item))} /> allow writes{advisoryRole(row.role) ? " (an advisory role reads only and records findings, proposed tasks and risks)" : ""}</label>
          <label>Derived from advisory task<input value={row.derived_from_task ?? ""} onChange={(event) => setTaskRows((rows) => rows.map((item, i) => i === index ? { ...item, derived_from_task: event.target.value } : item))} spellCheck={false} placeholder="task id of an earlier revision" /></label>
          <span className="task-dependencies" role="group" aria-label={`Task ${index + 1} waits for`}>after: {taskRows.filter((_, i) => i !== index).map((other) => <label key={other.repository_id} className="checkbox"><input type="checkbox" checked={row.depends_on.includes(other.repository_id)} onChange={(event) => setTaskRows((rows) => rows.map((item, i) => i === index ? { ...item, depends_on: event.target.checked ? [...item.depends_on, other.repository_id] : item.depends_on.filter((id) => id !== other.repository_id) } : item))} /> {other.repository_id}</label>)}</span>
          <button type="button" className="text-button" onClick={() => setTaskRows((rows) => rows.filter((_, i) => i !== index).map((item) => ({ ...item, depends_on: item.depends_on.filter((id) => id !== row.repository_id) })))}>Remove task {index + 1}</button>
        </li>)}</ul>
        <div className="field-row">
          <button type="button" className="text-button" onClick={() => setTaskRows((rows) => [...rows, { repository_id: repositoryIds.find((id) => !rows.some((row) => row.repository_id === id)) ?? repositoryId, paths: "src", write: true, depends_on: [] }])}>Add task</button>
          <label>Concurrent writers<input type="number" inputMode="numeric" min={1} max={Math.min(4, Math.max(1, taskRows.length))} step={1} value={maxWorkers} onChange={(event) => setMaxWorkers(event.target.value)} aria-describedby="plan-workers-note" /></label>
          <label>Approver<input value={approver} onChange={(event) => setApprover(event.target.value)} /></label>
          <button type="button" className="text-button" onClick={() => setTaskRows([])}>Back to one task</button>
        </div>
        <small id="plan-workers-note">Each task targets a distinct repository; a task runs after the tasks it waits for, and the runtime binds their exact candidates into its writer and checks. Writers run concurrently up to this many (1 to the number of tasks, at most 4). A repository lead or project orchestrator reads only and records findings, proposed tasks and risks; a task derived from such a proposal names it, so the assignment trace keeps its parent.</small>
        {(overrideRows.length > 0 || /dependency_overrides/.test(error)) && <div className="plan-overrides" role="group" aria-label="Dependency overrides">
          <small>Departures from the confirmed repository relationships, hashed with the plan (ADR 0023): waive a dependency a confirmed relationship implies, or add one between repositories with no confirmed relationship. The runtime refuses an override that applies to nothing and names the override a refused plan needs.</small>
          <ul className="override-rows record-list" aria-label="Dependency override rows">{overrideRows.map((row, index) => <li key={index} className="record override-row field-row">
            <label>Consumer task<select aria-label={`Override ${index + 1} consumer`} value={row.consumer} onChange={(event) => setOverrideRows((rows) => rows.map((item, i) => i === index ? { ...item, consumer: event.target.value } : item))}>{[...new Set([row.consumer, ...taskRows.map((task) => task.repository_id)])].filter(Boolean).map((id) => <option key={id} value={id}>{id}</option>)}</select></label>
            <label>Producer task<select aria-label={`Override ${index + 1} producer`} value={row.producer} onChange={(event) => setOverrideRows((rows) => rows.map((item, i) => i === index ? { ...item, producer: event.target.value } : item))}>{[...new Set([row.producer, ...taskRows.map((task) => task.repository_id)])].filter(Boolean).map((id) => <option key={id} value={id}>{id}</option>)}</select></label>
            <label>Action<select aria-label={`Override ${index + 1} action`} value={row.action} onChange={(event) => setOverrideRows((rows) => rows.map((item, i) => i === index ? { ...item, action: event.target.value as DependencyOverride["action"] } : item))}><option value="waive">waive</option><option value="add">add</option></select></label>
            <label>Justification<input value={row.justification} onChange={(event) => setOverrideRows((rows) => rows.map((item, i) => i === index ? { ...item, justification: event.target.value } : item))} required placeholder="why this plan departs from the confirmed relationship" /></label>
            <button type="button" className="text-button" onClick={() => setOverrideRows((rows) => rows.filter((_, i) => i !== index))}>Remove override {index + 1}</button>
          </li>)}</ul>
          <button type="button" className="text-button" onClick={() => setOverrideRows((rows) => [...rows, { consumer: taskRows[0]?.repository_id ?? "", producer: taskRows[1]?.repository_id ?? "", action: "waive", justification: "" }])}>Add override</button>
        </div>}
      </div>}
      <div className="plan-budgets field-row">
        <label>Writer attempts<input type="number" inputMode="numeric" min={1} max={10} step={1} value={attempts} onChange={(event) => setAttempts(event.target.value)} /></label>
        <label>Time budget (seconds)<input type="number" inputMode="numeric" min={1} max={86400} step={1} value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(event.target.value)} /></label>
        <label>Cost budget (USD)<input type="number" inputMode="decimal" min={0.000001} max={1000} step="any" value={costDollars} onChange={(event) => setCostDollars(event.target.value)} /></label>
        <small>Budgets for the next plan revision, approved with its hash: 1 to 10 writer attempts, up to 86400 seconds and $1000. Time and cost are cumulative across the writer, checks, independent review and repairs.</small>
      </div>
      <div className="model-fields workflow-models field-row">
        <label>Workflow provider<input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Runtime default" spellCheck={false} maxLength={128} /></label>
        <label>Workflow model<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Runtime default" spellCheck={false} maxLength={256} /></label>
        <small>Applies to the next writer, validation/reviewer or repair action. Every independent review uses a fresh session.</small>
      </div>
      <label className="workflow-auto-repair"><input type="checkbox" checked={autoRepair} onChange={(event) => setAutoRepair(event.target.checked)} /> Repair automatically within approved budgets</label>
    </div>
    {tickets.list.length > 0 && <ul className="tickets record-list" aria-label="Tickets" data-capability="tickets.list">{tickets.list.map((ticket) => {
      const revisions = tickets.plans[ticket.id] ?? [];
      return <TicketCard key={ticket.id} ticket={ticket} source={tickets.sources[ticket.id]} revisions={revisions.map((plan) => ({ plan, run: runFor(plan) }))} snapshots={snapshots} diffs={diffs} attempts={attemptLists} publications={publications} tasks={taskLists} logs={logs} busy={busy} connected={client !== null} actions={actions} repositoryIds={repositoryIds} />;
    })}</ul>}
  </section>;
}

export interface TicketActions {
  reconcile: (ticket: Ticket) => void;
  update: (ticket: Ticket, request: UpdateTicketRequest) => void;
  /** With `checks`, a testing-setup plan proposing those recipes as the repository's baseline (ADR 0022). */
  plan: (ticket: Ticket, latestRevision: number, checks?: SetupCheckRequest[]) => void;
  /** Pre-fills the next plan's tasks from an advisory task's proposal, each deriving from it (ADR 0023). */
  derive?: (task: TaskRecord) => void;
  approve: (plan: PlanRevision) => void;
  /** With `taskId`, resumes that failed, blocked or interrupted task of a settled graph under the original approval. */
  implement: (run: RunRecord, taskId?: string) => void;
  cancel: (run: RunRecord) => void;
  validate: (run: RunRecord, view: CandidateView) => void;
  repair: (run: RunRecord, view: CandidateView) => void;
  diff: (run: RunRecord) => void;
  attempts: (run: RunRecord) => void;
  tasks: (run: RunRecord) => void;
  artifact: (run: RunRecord, view: CandidateView, artifactId: string) => void;
  publish: (run: RunRecord, view: CandidateView) => void;
  publication: (run: RunRecord) => void;
  reconcilePublication: (run: RunRecord) => void;
  repairPublication: (run: RunRecord, view: CandidateView) => void;
}

/** One ticket: its latest plan revision's workflow, with earlier revisions summarised. */
export function TicketCard({ ticket, source, revisions, snapshots, diffs, attempts = {}, publications = {}, tasks = {}, logs, busy, connected, actions, repositoryIds = ticket.repository_ids }: {
  ticket: Ticket;
  source?: TicketSourceStatus;
  /** The registered repositories a ticket edit may scope the ticket to. */
  repositoryIds?: string[];
  revisions: { plan: PlanRevision; run?: RunRecord }[];
  snapshots: Map<string, RunSnapshot>;
  diffs: Record<string, CandidateDiff>;
  attempts?: Record<string, AttemptRecord[]>;
  publications?: Record<string, PublicationRecord>;
  tasks?: Record<string, TaskRecord[]>;
  logs: Record<string, { candidateHash: string; artifactId: string; text: string }>;
  busy: boolean;
  connected: boolean;
  actions: TicketActions;
}) {
  const latest = revisions.at(-1)?.plan;
  const run = revisions.at(-1)?.run;
  const snapshot = run ? snapshots.get(run.id) : undefined;
  const candidate = snapshot?.candidate;
  const blocker = latest ? planBlocker(latest.revision, run, candidate) : "";
  // Leaving a pending, approved or reviewed revision behind is confirmed; the confirmation lapses
  // when what would be left behind changes.
  const supersedes = latest ? planSupersedes(latest.revision, run, candidate) : "";
  const [acknowledged, setAcknowledged] = useState("");
  const confirmed = supersedes === "" || acknowledged === supersedes;
  // A testing-setup ticket's plan proposes the recipes typed here (ADR 0022); the ticket's purpose is the runtime's record.
  const setup = ticket.purpose === "testing_setup";
  const [checkRows, setCheckRows] = useState<CheckRow[]>([EMPTY_CHECK_ROW]);
  const setupChecks = setup ? setupChecksFromRows(checkRows) : [];
  // The first writer has no candidate yet, so the candidate review cannot offer its cancel.
  const writerActive = run !== undefined && !candidate?.evidence && canCancel(run.state, candidate?.active);
  const earlier = revisions.slice(0, -1).flatMap(({ plan, run: earlierRun }) => earlierRun ? [{ plan, run: earlierRun }] : []);
  const reason = run && ["failed", "cancelled", "interrupted", "testing_blocked", "paused"].includes(run.state) ? snapshot?.reason ?? "" : "";
  const step = run && reason ? nextStep(reason, allowedActions(run, candidate)) : "";
  return <li className="record ticket-card" id={`ticket-${ticket.id}`} tabIndex={-1}>
    <div className="ticket-head"><strong>{ticket.title}</strong><StatusBadge>ticket r{ticket.revision} · {ticket.source.replace(/_/g, " ")}{setup && " · testing setup"}</StatusBadge></div>
    <small className="ticket-intent">{ticket.intent}</small>
    {source?.reconciliation_required && <p className="failure-note" role="status">This ticket changed outside Luuna. Reconcile its current source before creating another plan or starting work.</p>}
    {setup && <SetupChecksEditor ticket={ticket} rows={checkRows} busy={busy || !connected} onChange={setCheckRows} />}
    <div className="ticket-actions actions">
      {ticket.source === "missions" && <button type="button" disabled={busy || !connected} data-capability="tickets.reconcile" onClick={() => actions.reconcile(ticket)}>Reconcile external changes</button>}
      <button type="button" disabled={busy || !connected || source?.reconciliation_required || blocker !== "" || !confirmed} data-capability="plans.create" onClick={() => actions.plan(ticket, latest?.revision ?? 0, setup ? setupChecks : undefined)}>{latest ? `Plan ${setup ? "setup " : ""}r${latest.revision + 1}` : setup ? "Plan setup" : "Plan"}</button>
      {latest && run && run.state === "approved" && <button type="button" className="primary" disabled={busy || source?.reconciliation_required} data-capability="runs.implement" onClick={() => actions.implement(run)}>Implement</button>}
      {writerActive && <button type="button" className="danger" disabled={busy} data-capability="runs.cancel" onClick={() => actions.cancel(run)}>Cancel workflow</button>}
      {run && <StatusBadge tone={runTone[run.state]}>{run.state.replace(/_/g, " ")}</StatusBadge>}
      {blocker && <small className="plan-blocker">{blocker}</small>}
    </div>
    <TicketEditor ticket={ticket} repositoryIds={repositoryIds} busy={busy || !connected} latestRevision={latest?.revision} onSave={(request) => actions.update(ticket, request)} />
    {supersedes && latest && <label className="plan-supersede"><input type="checkbox" checked={acknowledged === supersedes} disabled={busy || !connected} onChange={(event) => setAcknowledged(event.target.checked ? supersedes : "")} /> Plan r{latest.revision + 1} anyway: {supersedes}</label>}
    {writerActive && latest && <p className="callout writer-status" data-tone="active" role="status">The runtime is running the scoped writer for plan r{latest.revision}. Closing this view does not cancel the workflow.</p>}
    <p className="meta" aria-label="Cumulative ticket usage">{ticket.usage ? <>All plan revisions: {ticket.usage.workflows} workflow(s), {ticket.usage.attempts} writer attempt(s), {ticket.usage.repairs} repair(s), {ticket.usage.elapsed_seconds}s, ${(ticket.usage.cost_usd_micros / 1_000_000).toFixed(4)} recorded or reserved.{ticket.usage.cost_unreported && " Some provider usage has no reported price; this is not the complete cost."} A new revision does not erase this usage.</> : "Cumulative ticket usage is unavailable from this runtime."}</p>
    {latest && <PlanReview key={latest.hash} plan={latest} canApprove={run?.state === "plan_ready" && !source?.reconciliation_required} busy={busy} onApprove={() => actions.approve(latest)} />}
    {latest && <small className="plan-meta meta">plan <code>{latest.id}</code> r{latest.revision} · base <code>{Object.values(latest.base_commits)[0]?.slice(0, 12)}</code> · paths {latest.tasks[0]?.paths.join(", ")} · budget {latest.budgets.max_attempts} attempt(s), {latest.budgets.timeout_seconds}s, ${(latest.budgets.cost_usd_micros / 1_000_000).toFixed(2)}</small>}
    {earlier.length > 0 && <small className="plan-history meta">Earlier revisions: {earlier.map(({ plan, run: earlierRun }, index) => <span key={plan.id}>{index > 0 && " · "}r{plan.revision} <StatusBadge tone={runTone[earlierRun.state]}>{earlierRun.state.replace(/_/g, " ")}</StatusBadge></span>)}</small>}
    {run && reason && <small className="failure-note" data-tone={runTone[run.state]}>{reason}{step && <> <span className="recovery-note">{step}</span></>}</small>}
    {(snapshot?.leases ?? []).map((lease) => <small key={lease.id} className="worktree-line meta" data-capability="runs.worktrees">worktree <code>{lease.path}</code> · {lease.state}{lease.candidate_commit && <> · candidate <code>{lease.candidate_commit.slice(0, 12)}</code></>}{lease.reason && ` · ${lease.reason}`}</small>)}
    {run && latest && (latest.tasks.length > 1 || latest.tasks.some((task) => advisoryRole(task.role))) && <div className="tasks-inspection actions"><button type="button" className="text-button" disabled={busy || !connected} data-capability="runs.tasks" onClick={() => actions.tasks(run)}>Show task graph</button>{tasks[run.id] && <TaskGraph run={run} tasks={tasks[run.id]} overrides={latest.dependency_overrides ?? []} busy={busy || !connected || source?.reconciliation_required === true} onResume={(taskId) => actions.implement(run, taskId)} onDerive={actions.derive && blocker === "" ? (task) => actions.derive?.(task) : undefined} />}</div>}
    {run && <div className="attempts-inspection actions"><button type="button" className="text-button" disabled={busy || !connected} data-capability="runs.attempts" onClick={() => actions.attempts(run)}>Show writer attempts</button>{attempts[run.id] && <small className="meta" aria-label="Writer attempts">{attempts[run.id].length === 0 ? "No writer attempts recorded." : attempts[run.id].map((attempt) => `attempt ${attempt.number} (${attempt.task_id}): ${attempt.state}`).join(" · ")}</small>}</div>}
    {run && candidate && <CandidateReview run={run} view={candidate} diff={diffs[run.id]} log={logs[run.id]} busy={busy} handoff={candidate.prerequisite ?? undefined} worktrees={snapshot?.leases ?? []} onValidate={() => actions.validate(run, candidate)} onRepair={() => actions.repair(run, candidate)} onCancel={() => actions.cancel(run)} onDiff={() => actions.diff(run)} onArtifact={(id) => actions.artifact(run, candidate, id)} publication={publications[run.id]} onPublish={() => actions.publish(run, candidate)} onPublication={() => actions.publication(run)} onReconcilePublication={() => actions.reconcilePublication(run)} onRepairPublication={() => actions.repairPublication(run, candidate)} />}
  </li>;
}

/**
 * The durable task graph of a workflow with a state-specific control: a failed, blocked or
 * interrupted task of a settled (failed or interrupted) graph resumes by `task_id` under the
 * original approval, keeping completed tasks' commits and worktrees (ADR 0017 point 8). The
 * runtime re-checks the approval, the budgets and every binding before anything runs.
 */
export function TaskGraph({ run, tasks, overrides = [], busy, onResume, onDerive }: { run: RunRecord; tasks: TaskRecord[]; overrides?: DependencyOverride[]; busy: boolean; onResume: (taskId: string) => void; onDerive?: (task: TaskRecord) => void }) {
  return <ul className="record-list task-graph" aria-label="Task graph">{tasks.map((task) => {
    const named = task.dependency_overrides ?? overrides.filter((override) => override.consumer === task.task_id || override.producer === task.task_id);
    const result = task.advisory_result ?? undefined;
    return <li key={task.task_id} className="record task-record">
      <div className="task-line"><code>{task.task_id}</code> ({task.repository_id}) · role {String(task.role ?? "implementer").replace(/_/g, " ")} · {task.state}{task.depends_on.length ? ` · after ${task.depends_on.join(", ")}` : ""}{task.candidate_commit ? ` · commit ${task.candidate_commit.slice(0, 12)}` : ""}{task.reason ? ` · ${task.reason}` : ""}
        {taskResumable(run, task) && <button type="button" disabled={busy} data-capability="runs.implement" onClick={() => onResume(task.task_id)}>Resume task {task.task_id}</button>}</div>
      {task.assigned_by && <small className="task-trace meta" aria-label={`Assignment trace of ${task.task_id}`}>assigned by {task.assigned_by.approved_by} · approval <code>{task.assigned_by.approval_id}</code> at {task.assigned_by.approved_at} · plan <code>{task.assigned_by.plan_id}</code> r{task.assigned_by.plan_revision} · <code>{task.assigned_by.plan_hash}</code></small>}
      {task.derived_from_task && <small className="task-trace meta">derived from advisory task <code>{task.derived_from_task}</code></small>}
      {named.length > 0 && <small className="task-trace meta">dependency overrides: {named.map((override, index) => <span key={index}>{index > 0 && "; "}{override.action} <code>{override.consumer}</code> ← <code>{override.producer}</code> ({override.justification})</span>)}</small>}
      {result && <div className="advisory-result" aria-label={`Advisory result of ${task.task_id}`}>
        <small className="meta">Advisory result: {result.findings.length} finding(s), {result.proposed_tasks.length} proposed task(s), {result.risks.length} risk(s). A proposed task becomes real only through a plan revision you create and approve.</small>
        {result.findings.length > 0 && <ul className="advisory-list" aria-label="Findings">{result.findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul>}
        {result.proposed_tasks.length > 0 && <ul className="advisory-list" aria-label="Proposed tasks">{result.proposed_tasks.map((proposed) => <li key={proposed.id}><code>{proposed.id}</code> ({proposed.repository_id}, {String(proposed.role ?? "implementer").replace(/_/g, " ")}){proposed.depends_on?.length ? ` · after ${proposed.depends_on.join(", ")}` : ""}{proposed.paths?.length ? ` · paths ${proposed.paths.join(", ")}` : ""}{proposed.rationale ? ` · ${proposed.rationale}` : ""}</li>)}</ul>}
        {result.risks.length > 0 && <ul className="advisory-list" aria-label="Risks">{result.risks.map((risk, index) => <li key={index}>{risk}</li>)}</ul>}
        {onDerive && result.proposed_tasks.length > 0 && <div className="actions"><button type="button" disabled={busy} onClick={() => onDerive(task)}>Derive plan from this proposal</button><small>Pre-fills the next plan revision's tasks with this proposal, each deriving from <code>{task.task_id}</code>; you edit, create and approve it like any plan.</small></div>}
      </div>}
    </li>;
  })}</ul>;
}

/** The setup plan's check recipes (ADR 0022 point 3): the manifest-check shape, always required; the approver sees the exact recipes in the plan. */
export function SetupChecksEditor({ ticket, rows, busy, onChange }: { ticket: Ticket; rows: CheckRow[]; busy: boolean; onChange: (rows: CheckRow[]) => void }) {
  const update = (index: number, patch: Partial<CheckRow>) => onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <div className="setup-checks subpanel" role="group" aria-label={`Setup check recipes for ${ticket.id}`}>
    <small className="meta">This is a testing-setup ticket. Its plan proposes these required check recipes for <code>{ticket.repository_ids[0]}</code>; the setup candidate must pass them with at least one counted test, and after review you confirm them in the manifest and run the baseline. Left empty, the confirmed manifest's required recipes are used.</small>
    <ul className="check-rows record-list" aria-label="Check recipes">{rows.map((row, index) => <li key={index} className="record check-row field-row">
      <label>Recipe id<input value={row.id} disabled={busy} onChange={(event) => update(index, { id: event.target.value })} spellCheck={false} /></label>
      <label>Executable<input value={row.executable} disabled={busy} onChange={(event) => update(index, { executable: event.target.value })} spellCheck={false} placeholder="python" /></label>
      <label>Arguments (space separated)<input value={row.args} disabled={busy} onChange={(event) => update(index, { args: event.target.value })} spellCheck={false} placeholder="-m unittest" /></label>
      <label>Working directory (relative; empty is the repository root)<input value={row.cwd} disabled={busy} onChange={(event) => update(index, { cwd: event.target.value })} spellCheck={false} /></label>
      <label>Timeout (seconds)<input type="number" inputMode="numeric" min={1} step={1} value={row.timeout} disabled={busy} onChange={(event) => update(index, { timeout: event.target.value })} /></label>
      {rows.length > 1 && <button type="button" className="text-button" disabled={busy} onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove recipe {index + 1}</button>}
    </li>)}</ul>
    <button type="button" className="text-button" disabled={busy} onClick={() => onChange([...rows, { ...EMPTY_CHECK_ROW, id: `check-${rows.length + 1}` }])}>Add recipe</button>
  </div>;
}

/**
 * Edits a ticket at the revision shown. The runtime advances the revision, so every plan made
 * for the earlier revision is stale and must be re-planned; the form says so before saving.
 */
export function TicketEditor({ ticket, repositoryIds, busy, latestRevision, onSave }: { ticket: Ticket; repositoryIds: string[]; busy: boolean; latestRevision?: number; onSave: (request: UpdateTicketRequest) => void }) {
  const [draft, setDraft] = useState<TicketDraft>({ title: ticket.title, intent: ticket.intent, criteria: ticket.acceptance_criteria.join("\n"), repositoryIds: ticket.repository_ids });
  const request = ticketEditRequest(ticket, draft);
  const sizes = ticketTextSizes(draft.title, draft.intent, draft.criteria.split("\n"));
  const tooLong = sizes.title > TEXT_LIMITS.title || sizes.intent > TEXT_LIMITS.intent || sizes.criterion > TEXT_LIMITS.criterion;
  const choices = [...new Set([...repositoryIds, ...ticket.repository_ids])];
  return <details className="ticket-editor section"><summary>Edit ticket r{ticket.revision}</summary>
    <form className="form-group" onSubmit={(event) => { event.preventDefault(); if (request && !tooLong) onSave(request); }}>
      <fieldset disabled={busy}>
        <label>Revised title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required aria-describedby={`edit-title-bytes-${ticket.id}`} /></label>
        <ByteCount id={`edit-title-bytes-${ticket.id}`} bytes={sizes.title} limit={TEXT_LIMITS.title} />
        <label>Revised intent<textarea value={draft.intent} onChange={(event) => setDraft({ ...draft, intent: event.target.value })} required rows={3} aria-describedby={`edit-intent-bytes-${ticket.id}`} /></label>
        <ByteCount id={`edit-intent-bytes-${ticket.id}`} bytes={sizes.intent} limit={TEXT_LIMITS.intent} />
        <label>Revised acceptance criteria (one per line)<textarea value={draft.criteria} onChange={(event) => setDraft({ ...draft, criteria: event.target.value })} required rows={2} aria-describedby={`edit-criteria-bytes-${ticket.id}`} /></label>
        <ByteCount id={`edit-criteria-bytes-${ticket.id}`} prefix="Longest criterion: " bytes={sizes.criterion} limit={TEXT_LIMITS.criterion} />
        {choices.length > 1 && <div className="ticket-repositories field-row" role="group" aria-label="Repositories the ticket may touch">{choices.map((id) => <label key={id} className="checkbox"><input type="checkbox" checked={draft.repositoryIds.includes(id)} onChange={(event) => setDraft({ ...draft, repositoryIds: event.target.checked ? [...draft.repositoryIds.filter((item) => item !== id), id] : draft.repositoryIds.filter((item) => item !== id) })} /> {id}</label>)}</div>}
        <div className="form-footer"><small>{latestRevision ? `Saving advances the ticket to r${ticket.revision + 1}: plan r${latestRevision} was made for r${ticket.revision} and must be re-planned before any further implementation, validation or publication.` : `Saving advances the ticket to r${ticket.revision}; its plans bind to the revision they were made for.`}</small><button className="primary" disabled={!request || tooLong} data-capability="tickets.update">Save ticket r{ticket.revision + 1}</button></div>
      </fieldset>
    </form>
  </details>;
}

export function PlanReview({ plan, canApprove, busy, onApprove }: { plan: PlanRevision; canApprove: boolean; busy: boolean; onApprove: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  return <div className="plan-review">
    <p className="meta">Immutable plan hash: <code className="plan-hash">{plan.hash}</code></p>
    <pre className="plan-document" aria-label="Complete immutable plan" tabIndex={0} data-capability="plans.show">{JSON.stringify(plan, null, 2)}</pre>
    {canApprove && <>
      <label className="plan-acknowledgment"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I reviewed this complete plan and hash.</label>
      <button type="button" className="primary" disabled={busy || !reviewed} data-capability="plans.approve" onClick={() => { if (reviewed) onApprove(); }}>Approve r{plan.revision}</button>
    </>}
  </div>;
}
