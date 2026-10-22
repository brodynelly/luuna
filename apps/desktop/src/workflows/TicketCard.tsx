import { useState } from "react";
import type { AttemptRecord, CandidateDiff, CandidateView, PlanRevision, PublicationRecord, RunRecord, SetupCheckRequest, TaskRecord, Ticket, TicketSourceStatus, UpdateTicketRequest } from "@luuna/api-client";
import { allowedActions, canCancel, planBlocker, planSupersedes } from "../workflow-state";
import { nextStep } from "../failures";
import { CandidateReview } from "../candidate/CandidateReview";
import { Alert, Button, Checkbox, Hint, Inline, ListRow, ReasonNote, Stack, StatusBadge, runTone } from "@luuna/ui";
import { EMPTY_CHECK_ROW, setupChecksFromRows, stateText } from "./model";
import type { CheckRow } from "./model";
import type { RunSnapshot } from "./read";
import { PlanReview } from "./PlanReview";
import { TicketEditor } from "./TicketEditor";
import { SetupChecksEditor } from "./SetupChecksEditor";
import { PlanMeta, RunEvidence, TicketUsage } from "./TicketEvidence";

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

export interface TicketCardProps {
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
}

const REASONED = ["failed", "cancelled", "interrupted", "testing_blocked", "paused"];

/** The plan control's label: the next revision, or the first plan (a setup plan names itself). */
function planLabel(latest: PlanRevision | undefined, setup: boolean): string {
  if (latest) return `Plan ${setup ? "setup " : ""}r${latest.revision + 1}`;
  return setup ? "Plan setup" : "Plan";
}

/** One ticket: its latest plan revision's workflow, with earlier revisions summarised. */
export function TicketCard({ ticket, source, revisions, snapshots, diffs, attempts = {}, publications = {}, tasks = {}, logs, busy, connected, actions, repositoryIds = ticket.repository_ids }: TicketCardProps) {
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
  const reason = run && REASONED.includes(run.state) ? snapshot?.reason ?? "" : "";
  const step = run && reason ? nextStep(reason, allowedActions(run, candidate)) : "";
  const offline = busy || !connected;
  const reconcile = source?.reconciliation_required === true;
  const badge = `ticket r${ticket.revision} · ${stateText(ticket.source)}${setup ? " · testing setup" : ""}`;
  return <ListRow className="ticket-card" id={`ticket-${ticket.id}`} tabIndex={-1} title={<Inline as="span" className="ticket-head"><strong>{ticket.title}</strong></Inline>} trailing={<StatusBadge>{badge}</StatusBadge>} detail={<Stack gap={2}>
    <Hint className="ticket-intent">{ticket.intent}</Hint>
    {reconcile && <Alert tone="attention" announce="status" className="reconcile-note">This ticket changed outside Luuna. Reconcile its current source before creating another plan or starting work.</Alert>}
    {setup && <SetupChecksEditor ticket={ticket} rows={checkRows} busy={offline} onChange={setCheckRows} />}
    <Inline className="ticket-actions" wrap gap={2} justify="between">
      <Inline wrap gap={2}>
        {ticket.source === "missions" && <Button disabled={offline} data-capability="tickets.reconcile" onClick={() => actions.reconcile(ticket)}>Reconcile external changes</Button>}
        <Button disabled={offline || reconcile || blocker !== "" || !confirmed} data-capability="plans.create" onClick={() => actions.plan(ticket, latest?.revision ?? 0, setup ? setupChecks : undefined)}>{planLabel(latest, setup)}</Button>
        {latest && run && run.state === "approved" && <Button variant="primary" disabled={busy || reconcile} data-capability="runs.implement" onClick={() => actions.implement(run)}>Implement</Button>}
      </Inline>
      {(writerActive || run) && <Inline gap={2}>
        {writerActive && <Button variant="danger" disabled={busy} data-capability="runs.cancel" onClick={() => actions.cancel(run)}>Cancel workflow</Button>}
        {run && <StatusBadge tone={runTone[run.state]}>{stateText(run.state)}</StatusBadge>}
      </Inline>}
    </Inline>
    {blocker && <Hint className="plan-blocker">{blocker}</Hint>}
    <TicketEditor ticket={ticket} repositoryIds={repositoryIds} busy={offline} latestRevision={latest?.revision} onSave={(request) => actions.update(ticket, request)} />
    {supersedes && latest && <Checkbox className="plan-supersede" label={`Plan r${latest.revision + 1} anyway: ${supersedes}`} checked={acknowledged === supersedes} disabled={offline} onChange={(event) => setAcknowledged(event.target.checked ? supersedes : "")} />}
    {writerActive && latest && <Alert tone="active" announce="status" className="writer-status">The runtime is running the scoped writer for plan r{latest.revision}. Closing this view does not cancel the workflow.</Alert>}
    <TicketUsage ticket={ticket} />
    {latest && <PlanReview key={latest.hash} plan={latest} canApprove={run?.state === "plan_ready" && !reconcile} busy={busy} onApprove={() => actions.approve(latest)} />}
    {latest && <PlanMeta plan={latest} earlier={revisions.slice(0, -1)} />}
    {run && reason && <ReasonNote tone={runTone[run.state]} reason={reason} next={step} />}
    {run && <RunEvidence run={run} plan={latest} snapshot={snapshot} attempts={attempts[run.id]} tasks={tasks[run.id]} busy={busy} connected={connected} blocked={blocker !== ""} reconcile={reconcile} actions={actions} />}
    {run && candidate && <CandidateReview run={run} view={candidate} diff={diffs[run.id]} log={logs[run.id]} busy={busy} handoff={candidate.prerequisite ?? undefined} worktrees={snapshot?.leases ?? []}
      onValidate={() => actions.validate(run, candidate)} onRepair={() => actions.repair(run, candidate)} onCancel={() => actions.cancel(run)} onDiff={() => actions.diff(run)}
      onArtifact={(id) => actions.artifact(run, candidate, id)} publication={publications[run.id]} onPublish={() => actions.publish(run, candidate)} onPublication={() => actions.publication(run)}
      onReconcilePublication={() => actions.reconcilePublication(run)} onRepairPublication={() => actions.repairPublication(run, candidate)} />}
  </Stack>} />;
}

