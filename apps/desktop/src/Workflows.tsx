import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { CandidateDiff, CandidateView, LuunaClient, Operation, PlanRevision, RunRecord, Ticket, WorktreeLease } from "@luuna/api-client";
import { workflowNeedsRefresh, workflowReason } from "./workflow-state";
import { CandidateReview } from "./CandidateReview";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The runtime could not be reached.";
}

interface Props {
  client: LuunaClient | null;
  projectId: string;
  repositoryId: string;
  manifestConfirmed: boolean;
  onChanged: () => void;
}

/**
 * A temporary local ticket, an exact plan approval and the candidate workflow.
 * The runtime owns all execution, validation, review and repair decisions.
 */
export function Workflows({ client, projectId, repositoryId, manifestConfirmed, onChanged }: Props) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [plans, setPlans] = useState<Record<string, PlanRevision[]>>({});
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [leases, setLeases] = useState<Record<string, WorktreeLease[]>>({});
  const [candidates, setCandidates] = useState<Record<string, CandidateView>>({});
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
  const [autoRepair, setAutoRepair] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  async function load(signal: AbortSignal): Promise<boolean> {
    if (!client) return false;
    const [list, all] = await Promise.all([client.listTickets(projectId, signal), client.listRuns(signal)]);
    if (signal.aborted) return false;
    const workflowRuns = all.filter((run) => run.metadata.kind === "workflow" && run.project_id === projectId);
    const planLists = await Promise.all(list.map((ticket) => client.listPlans(ticket.id, signal)));
    if (signal.aborted) return false;
    const [leaseLists, eventLists, candidateViews] = await Promise.all([
      Promise.all(workflowRuns.map((run) => client.worktrees(run.id, signal))),
      Promise.all(workflowRuns.map((run) => client.events(run.id, 0, signal))),
      Promise.all(workflowRuns.map((run) => client.candidate(run.id, signal))),
    ]);
    if (signal.aborted) return false;
    setReasons(Object.fromEntries(workflowRuns.map((run, index) => {
      return [run.id, workflowReason(eventLists[index])];
    })));
    setTickets(list);
    setPlans(Object.fromEntries(list.map((ticket, index) => [ticket.id, planLists[index]])));
    setRuns(workflowRuns);
    setLeases(Object.fromEntries(workflowRuns.map((run, index) => [run.id, leaseLists[index]])));
    setCandidates(Object.fromEntries(workflowRuns.map((run, index) => [run.id, candidateViews[index]])));
    return workflowRuns.some((run, index) => workflowNeedsRefresh(run, candidateViews[index]));
  }

  useEffect(() => {
    setTickets([]);
    setPlans({});
    setRuns([]);
    setLeases({});
    setCandidates({});
    setDiffs({});
    setLogs({});
    setReasons({});
    setError("");
    setLoadError("");
    setAutoRepair(false);
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

  async function guarded(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setTick((value) => value + 1);
      onChanged();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  function createTicket(event: FormEvent) {
    event.preventDefault();
    void guarded(async () => {
      if (!client) return;
      await client.createTicket(projectId, {
        idempotency_key: crypto.randomUUID(),
        title: title.trim(),
        intent: intent.trim(),
        acceptance_criteria: criteria.split("\n").map((line) => line.trim()).filter(Boolean),
        repository_ids: [repositoryId],
      });
      setTitle("");
      setIntent("");
      setCriteria("");
    });
  }

  function plan(ticket: Ticket) {
    void guarded(async () => {
      if (!client) return;
      const operations: Operation[] = write ? ["read", "write"] : ["read"];
      await client.createPlan(ticket.id, {
        task: { repository_id: repositoryId, paths: paths.split(",").map((p) => p.trim()).filter(Boolean), operations },
      });
    });
  }

  function approve(plan: PlanRevision) {
    void guarded(async () => {
      if (!client) return;
      await client.approvePlan(plan.id, { plan_revision: plan.revision, plan_hash: plan.hash, approved_by: approver.trim() || "developer" });
    });
  }

  function implement(run: RunRecord) {
    void guarded(async () => {
      if (!client) return;
      await client.implement(run.id, modelSettings());
    });
  }

  function validate(run: RunRecord, view: CandidateView) {
    void guarded(async () => {
      if (!client || !view.evidence) return;
      await client.validateCandidate(run.id, { candidate_hash: view.evidence.candidate.hash, auto_repair: autoRepair, ...modelSettings() });
    });
  }

  function repair(run: RunRecord, view: CandidateView) {
    void guarded(async () => {
      if (!client || !view.evidence) return;
      await client.repairCandidate(run.id, { candidate_hash: view.evidence.candidate.hash, ...modelSettings() });
    });
  }

  function cancel(run: RunRecord) {
    void guarded(async () => { if (client) await client.cancelRun(run.id); });
  }

  function modelSettings(): { provider?: string; model?: string } {
    return { ...(provider.trim() && { provider: provider.trim() }), ...(model.trim() && { model: model.trim() }) };
  }

  function inspectDiff(run: RunRecord) {
    void guarded(async () => {
      if (!client) return;
      const diff = await client.candidateDiff(run.id);
      setDiffs((previous) => ({ ...previous, [run.id]: diff }));
    });
  }

  function inspectArtifact(run: RunRecord, view: CandidateView, artifactId: string) {
    void guarded(async () => {
      if (!client || !view.evidence) return;
      const text = await client.artifact(run.id, artifactId);
      setLogs((previous) => ({ ...previous, [run.id]: { candidateHash: view.evidence!.candidate.hash, artifactId, text } }));
    });
  }

  function runFor(plan: PlanRevision): RunRecord | undefined {
    return runs.find((run) => run.metadata.plan_id === plan.id && run.metadata.plan_revision === plan.revision);
  }

  return <section className="workflows" aria-labelledby="workflows-heading">
    <div className="panel-heading"><h3 id="workflows-heading">Tickets, plans and candidates</h3><button type="button" className="text-button" disabled={!client || busy} onClick={() => setTick((value) => value + 1)}>Refresh workflows</button></div>
    <p className="scope">A ticket is a temporary local record until Missions is integrated. Approve the complete immutable plan, then run the scoped writer in its managed worktree. Validate the resulting candidate with the approved checks and an independent reviewer; the runtime binds every result to its exact candidate hash.</p>
    {(error || loadError) && <div className="error" role="alert">{error || loadError}<button className="text-button" type="button" onClick={() => { setError(""); setLoadError(""); }}>Dismiss</button></div>}
    <form onSubmit={createTicket} className="ticket-form">
      <fieldset disabled={!client || busy || !manifestConfirmed}>
        <label>Ticket title<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} placeholder="Implement the greeting" /></label>
        <label>Intent<textarea value={intent} onChange={(event) => setIntent(event.target.value)} required rows={3} placeholder="What should change and why" /></label>
        <label>Acceptance criteria (one per line)<textarea value={criteria} onChange={(event) => setCriteria(event.target.value)} required rows={2} /></label>
        <div className="form-footer"><small>{manifestConfirmed ? "Tickets are scoped to this project's registered repository." : "Confirm a manifest before creating tickets."}</small><button className="primary" disabled={!title.trim() || !intent.trim() || !criteria.trim()}>Create ticket</button></div>
      </fieldset>
    </form>
    <div className="plan-controls">
      <label>Writer paths (comma separated)<input value={paths} onChange={(event) => setPaths(event.target.value)} spellCheck={false} /></label>
      <label className="checkbox"><input type="checkbox" checked={write} onChange={(event) => setWrite(event.target.checked)} /> allow writes</label>
      <label>Approver<input value={approver} onChange={(event) => setApprover(event.target.value)} /></label>
    </div>
    <div className="model-fields workflow-models">
      <label>Workflow provider<input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Runtime default" spellCheck={false} maxLength={128} /></label>
      <label>Workflow model<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Runtime default" spellCheck={false} maxLength={256} /></label>
      <small>Applies to the next writer, validation/reviewer or repair action. Every independent review uses a fresh session.</small>
    </div>
    <label className="workflow-auto-repair"><input type="checkbox" checked={autoRepair} onChange={(event) => setAutoRepair(event.target.checked)} /> Repair automatically within approved budgets</label>
    {tickets.length > 0 && <ul className="tickets" aria-label="Tickets">{tickets.map((ticket) => {
      const revisions = plans[ticket.id] ?? [];
      const latest = revisions[revisions.length - 1];
      const run = latest ? runFor(latest) : undefined;
      const runLeases = run ? leases[run.id] ?? [] : [];
      const candidate = run ? candidates[run.id] : undefined;
      return <li key={ticket.id}>
        <div className="ticket-head"><strong>{ticket.title}</strong><span className="state">ticket r{ticket.revision} · {ticket.source.replace(/_/g, " ")}</span></div>
        <small>{ticket.intent}</small>
        <div className="ticket-actions">
          <button type="button" disabled={busy || !client} onClick={() => plan(ticket)}>{latest ? `Plan r${latest.revision + 1}` : "Plan"}</button>
          {latest && run && run.state === "approved" && <button type="button" className="primary" disabled={busy} onClick={() => implement(run)}>Implement</button>}
          {run && <span className={`state ${run.state}`}>{run.state.replace(/_/g, " ")}</span>}
        </div>
        {latest && <PlanReview key={latest.hash} plan={latest} canApprove={run?.state === "plan_ready"} busy={busy} onApprove={() => approve(latest)} />}
        {latest && <small>plan {latest.id} r{latest.revision} · base <code>{Object.values(latest.base_commits)[0]?.slice(0, 12)}</code> · paths {latest.tasks[0]?.paths.join(", ")} · budget {latest.budgets.max_attempts} attempt(s), {latest.budgets.timeout_seconds}s</small>}
        {run && ["failed", "cancelled", "interrupted", "testing_blocked", "paused"].includes(run.state) && reasons[run.id] && <small className="failure-note">{reasons[run.id]}</small>}
        {runLeases.map((lease) => <small key={lease.id}>worktree <code>{lease.path}</code> · {lease.state}{lease.candidate_commit && <> · candidate <code>{lease.candidate_commit.slice(0, 12)}</code></>}{lease.reason && ` · ${lease.reason}`}</small>)}
        {run && candidate && <CandidateReview run={run} view={candidate} diff={diffs[run.id]} log={logs[run.id]} busy={busy} onValidate={() => validate(run, candidate)} onRepair={() => repair(run, candidate)} onCancel={() => cancel(run)} onDiff={() => inspectDiff(run)} onArtifact={(id) => inspectArtifact(run, candidate, id)} />}
      </li>;
    })}</ul>}
  </section>;
}

export function PlanReview({ plan, canApprove, busy, onApprove }: { plan: PlanRevision; canApprove: boolean; busy: boolean; onApprove: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  return <div className="plan-review">
    <p>Immutable plan hash: <code style={{ overflowWrap: "anywhere" }}>{plan.hash}</code></p>
    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} aria-label="Complete immutable plan">{JSON.stringify(plan, null, 2)}</pre>
    {canApprove && <>
      <label><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I reviewed this complete plan and hash.</label>
      <button type="button" disabled={busy || !reviewed} onClick={() => { if (reviewed) onApprove(); }}>Approve r{plan.revision}</button>
    </>}
  </div>;
}
