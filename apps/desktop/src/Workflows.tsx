import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { CandidateDiff, CandidateView, ComponentContext, CreatePlanRequest, LuunaClient, Operation, PlanBudgetRequest, PlanRevision, RunRecord, Ticket, TicketSourceStatus, WorktreeLease } from "@luuna/api-client";
import { DEFAULT_PLAN_BUDGETS, planBudgetProblem, readEventPages } from "@luuna/api-client";
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
      const [leases, events, candidate] = await Promise.all([
        client.worktrees(run.id, signal),
        readEventPages((after, page) => client.events(run.id, after, signal, page), seen?.cursor ?? 0, EVENT_PAGE),
        client.candidate(run.id, signal),
      ]);
      // Only the cursor and displayed reason are kept; a gap or foreign event fails the whole read.
      const replay = advanceWorkflowReplay(run.id, { cursor: seen?.cursor ?? 0, reason: seen?.reason ?? "" }, events);
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
    ticket.source === "missions" ? client.ticketSource(ticket.id, signal) : Promise.resolve(null),
  ]));
  const planLists = details.map(([plans]) => plans);
  const sources = details.map(([, source]) => source);
  return {
    list,
    sources: Object.fromEntries(list.flatMap((ticket, index) => sources[index] ? [[ticket.id, sources[index]!]] : [])),
    plans: Object.fromEntries(list.map((ticket, index) => [ticket.id, planLists[index]])),
  };
}

interface Props {
  client: LuunaClient | null;
  projectId: string;
  repositoryId: string;
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
export function Workflows({ client, projectId, repositoryId, manifestConfirmed, connectionEpoch = 0, componentContext, componentsEnabled = false, componentEpoch = 0, onChanged }: Props) {
  const [tickets, setTickets] = useState<TicketState>({ list: [], sources: {}, plans: {} });
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [snapshots, setSnapshots] = useState<Map<string, RunSnapshot>>(new Map());
  const [diffs, setDiffs] = useState<Record<string, CandidateDiff>>({});
  const [logs, setLogs] = useState<Record<string, { candidateHash: string; artifactId: string; text: string }>>({});
  const [title, setTitle] = useState("");
  const [intent, setIntent] = useState("");
  const [criteria, setCriteria] = useState("");
  const [paths, setPaths] = useState("src");
  const [write, setWrite] = useState(true);
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
      failed: (failure) => { setError(actionFailure(label, failure)); reload(); },
      settled: () => setBusy(false),
    });
  }

  const ticketRequest = {
    title: title.trim(), intent: intent.trim(),
    acceptance_criteria: criteria.split("\n").map((line) => line.trim()).filter(Boolean), repository_ids: [repositoryId],
  };
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
      ticketDelivery.current = null;
    });
  }

  function plan(ticket: Ticket, latestRevision: number) {
    guarded("Planning", async (signal) => {
      if (!client) return;
      const budgets = parseBudgets(attempts, timeoutSeconds, costDollars);
      const problem = planBudgetProblem(budgets);
      if (problem) throw new Error(problem);
      const operations: Operation[] = write ? ["read", "write"] : ["read"];
      const request = {
        task: { repository_id: repositoryId, paths: paths.split(",").map((p) => p.trim()).filter(Boolean), operations },
        budgets,
        ...(componentsEnabled && componentContext && (componentContext.memory_ids.length > 0 || componentContext.prompt) ? { component_context: componentContext } : {}),
      };
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

  const actions: TicketActions = {
    reconcile: (ticket) => guarded("Ticket reconciliation", async (signal) => { await client!.reconcileTicket(ticket.id, ticket.revision, signal); }),
    plan,
    approve,
    implement: (run) => guarded("Implementation", async (signal) => { if (client) await client.implement(run.id, modelSettings(), signal); }),
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
    artifact: (run, view, artifactId) => guarded("Log inspection", async (signal) => {
      if (!client || !view.evidence) return;
      const text = await client.artifact(run.id, artifactId, signal);
      if (!signal.aborted) setLogs((previous) => ({ ...previous, [run.id]: { candidateHash: view.evidence!.candidate.hash, artifactId, text } }));
    }),
  };

  return <section className="workflows subpanel" aria-labelledby="workflows-heading">
    <div className="panel-heading"><h3 id="workflows-heading">Tickets, plans and candidates</h3><button type="button" className="text-button" disabled={!client || busy} onClick={reload}>Refresh workflows</button></div>
    <p className="scope">{componentsEnabled ? "Tickets are authoritative in luuna-missions; reconcile external edits before re-planning." : "Tickets use legacy local storage until you enable project components above."} Approve the complete immutable plan, then run the scoped writer in its managed worktree. The runtime binds validation and independent review to the exact candidate hash.</p>
    {(error || loadError) && <div className="error" role="alert">{error || loadError}<button className="text-button" type="button" onClick={() => { setError(""); setLoadError(""); }}>Dismiss</button></div>}
    <form onSubmit={createTicket} className="ticket-form form-group">
      <fieldset disabled={!client || busy || !manifestConfirmed}>
        <label>Ticket title<input value={title} onChange={(event) => setTitle(event.target.value)} required aria-describedby="ticket-title-bytes" placeholder="Implement the greeting" /></label>
        <ByteCount id="ticket-title-bytes" bytes={sizes.title} limit={TEXT_LIMITS.title} />
        <label>Intent<textarea value={intent} onChange={(event) => setIntent(event.target.value)} required rows={3} aria-describedby="ticket-intent-bytes" placeholder="What should change and why" /></label>
        <ByteCount id="ticket-intent-bytes" bytes={sizes.intent} limit={TEXT_LIMITS.intent} />
        <label>Acceptance criteria (one per line)<textarea value={criteria} onChange={(event) => setCriteria(event.target.value)} required rows={2} aria-describedby="ticket-criteria-bytes" /></label>
        <ByteCount id="ticket-criteria-bytes" prefix="Longest criterion: " bytes={sizes.criterion} limit={TEXT_LIMITS.criterion} />
        <div className="form-footer"><small>{!manifestConfirmed ? "Confirm a manifest before creating tickets." : tooLong ? "Shorten the field marked too long: the runtime counts UTF-8 bytes, so accented letters, CJK text and emoji take more than one." : "Tickets are scoped to this project's registered repository."}</small><button className="primary" disabled={!title.trim() || !intent.trim() || !criteria.trim() || tooLong}>Create ticket</button></div>
      </fieldset>
    </form>
    <div className="tray run-settings">
      <div className="plan-controls field-row">
        <label>Writer paths (comma separated)<input value={paths} onChange={(event) => setPaths(event.target.value)} spellCheck={false} /></label>
        <label className="checkbox"><input type="checkbox" checked={write} onChange={(event) => setWrite(event.target.checked)} /> allow writes</label>
        <label>Approver<input value={approver} onChange={(event) => setApprover(event.target.value)} /></label>
      </div>
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
    {tickets.list.length > 0 && <ul className="tickets record-list" aria-label="Tickets">{tickets.list.map((ticket) => {
      const revisions = tickets.plans[ticket.id] ?? [];
      return <TicketCard key={ticket.id} ticket={ticket} source={tickets.sources[ticket.id]} revisions={revisions.map((plan) => ({ plan, run: runFor(plan) }))} snapshots={snapshots} diffs={diffs} logs={logs} busy={busy} connected={client !== null} actions={actions} />;
    })}</ul>}
  </section>;
}

export interface TicketActions {
  reconcile: (ticket: Ticket) => void;
  plan: (ticket: Ticket, latestRevision: number) => void;
  approve: (plan: PlanRevision) => void;
  implement: (run: RunRecord) => void;
  cancel: (run: RunRecord) => void;
  validate: (run: RunRecord, view: CandidateView) => void;
  repair: (run: RunRecord, view: CandidateView) => void;
  diff: (run: RunRecord) => void;
  artifact: (run: RunRecord, view: CandidateView, artifactId: string) => void;
}

/** One ticket: its latest plan revision's workflow, with earlier revisions summarised. */
export function TicketCard({ ticket, source, revisions, snapshots, diffs, logs, busy, connected, actions }: {
  ticket: Ticket;
  source?: TicketSourceStatus;
  revisions: { plan: PlanRevision; run?: RunRecord }[];
  snapshots: Map<string, RunSnapshot>;
  diffs: Record<string, CandidateDiff>;
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
  // The first writer has no candidate yet, so the candidate review cannot offer its cancel.
  const writerActive = run !== undefined && !candidate?.evidence && canCancel(run.state, candidate?.active);
  const earlier = revisions.slice(0, -1).flatMap(({ plan, run: earlierRun }) => earlierRun ? [{ plan, run: earlierRun }] : []);
  const reason = run && ["failed", "cancelled", "interrupted", "testing_blocked", "paused"].includes(run.state) ? snapshot?.reason ?? "" : "";
  const step = run && reason ? nextStep(reason, allowedActions(run, candidate)) : "";
  return <li className="record ticket-card">
    <div className="ticket-head"><strong>{ticket.title}</strong><StatusBadge>ticket r{ticket.revision} · {ticket.source.replace(/_/g, " ")}</StatusBadge></div>
    <small className="ticket-intent">{ticket.intent}</small>
    {source?.reconciliation_required && <p className="failure-note" role="status">This ticket changed outside Luuna. Reconcile its current source before creating another plan or starting work.</p>}
    <div className="ticket-actions actions">
      {ticket.source === "missions" && <button type="button" disabled={busy || !connected} onClick={() => actions.reconcile(ticket)}>Reconcile external changes</button>}
      <button type="button" disabled={busy || !connected || source?.reconciliation_required || blocker !== "" || !confirmed} onClick={() => actions.plan(ticket, latest?.revision ?? 0)}>{latest ? `Plan r${latest.revision + 1}` : "Plan"}</button>
      {latest && run && run.state === "approved" && <button type="button" className="primary" disabled={busy || source?.reconciliation_required} onClick={() => actions.implement(run)}>Implement</button>}
      {writerActive && <button type="button" className="danger" disabled={busy} onClick={() => actions.cancel(run)}>Cancel workflow</button>}
      {run && <StatusBadge tone={runTone[run.state]}>{run.state.replace(/_/g, " ")}</StatusBadge>}
      {blocker && <small className="plan-blocker">{blocker}</small>}
    </div>
    {supersedes && latest && <label className="plan-supersede"><input type="checkbox" checked={acknowledged === supersedes} disabled={busy || !connected} onChange={(event) => setAcknowledged(event.target.checked ? supersedes : "")} /> Plan r{latest.revision + 1} anyway: {supersedes}</label>}
    {writerActive && latest && <p className="callout writer-status" data-tone="active" role="status">The runtime is running the scoped writer for plan r{latest.revision}. Closing this view does not cancel the workflow.</p>}
    {latest && <PlanReview key={latest.hash} plan={latest} canApprove={run?.state === "plan_ready" && !source?.reconciliation_required} busy={busy} onApprove={() => actions.approve(latest)} />}
    {latest && <small className="plan-meta meta">plan <code>{latest.id}</code> r{latest.revision} · base <code>{Object.values(latest.base_commits)[0]?.slice(0, 12)}</code> · paths {latest.tasks[0]?.paths.join(", ")} · budget {latest.budgets.max_attempts} attempt(s), {latest.budgets.timeout_seconds}s, ${(latest.budgets.cost_usd_micros / 1_000_000).toFixed(2)}</small>}
    {earlier.length > 0 && <small className="plan-history meta">Earlier revisions: {earlier.map(({ plan, run: earlierRun }, index) => <span key={plan.id}>{index > 0 && " · "}r{plan.revision} <StatusBadge tone={runTone[earlierRun.state]}>{earlierRun.state.replace(/_/g, " ")}</StatusBadge></span>)}</small>}
    {run && reason && <small className="failure-note" data-tone={runTone[run.state]}>{reason}{step && <> <span className="recovery-note">{step}</span></>}</small>}
    {(snapshot?.leases ?? []).map((lease) => <small key={lease.id} className="worktree-line meta">worktree <code>{lease.path}</code> · {lease.state}{lease.candidate_commit && <> · candidate <code>{lease.candidate_commit.slice(0, 12)}</code></>}{lease.reason && ` · ${lease.reason}`}</small>)}
    {run && candidate && <CandidateReview run={run} view={candidate} diff={diffs[run.id]} log={logs[run.id]} busy={busy} onValidate={() => actions.validate(run, candidate)} onRepair={() => actions.repair(run, candidate)} onCancel={() => actions.cancel(run)} onDiff={() => actions.diff(run)} onArtifact={(id) => actions.artifact(run, candidate, id)} />}
  </li>;
}

export function PlanReview({ plan, canApprove, busy, onApprove }: { plan: PlanRevision; canApprove: boolean; busy: boolean; onApprove: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  return <div className="plan-review">
    <p className="meta">Immutable plan hash: <code className="plan-hash">{plan.hash}</code></p>
    <pre className="plan-document" aria-label="Complete immutable plan" tabIndex={0}>{JSON.stringify(plan, null, 2)}</pre>
    {canApprove && <>
      <label className="plan-acknowledgment"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I reviewed this complete plan and hash.</label>
      <button type="button" className="primary" disabled={busy || !reviewed} onClick={() => { if (reviewed) onApprove(); }}>Approve r{plan.revision}</button>
    </>}
  </div>;
}
