import { useEffect, useRef, useState } from "react";
import type { AttemptRecord, CandidateDiff, ComponentContext, DependencyOverride, LuunaClient, PlanRevision, PublicationRecord, RunRecord, SetupCheckRequest, TaskRecord, TestingPrerequisite, Ticket } from "@luuna/api-client";
import { ApiError, DEFAULT_PLAN_BUDGETS, overrideFromRefusal, planBudgetProblem } from "@luuna/api-client";
import { settleAction } from "../workflow-state";
import { actionFailure, utf8Bytes } from "../failures";
import { COMPLETED, useNotify } from "../ui";
import { TEXT_LIMITS, parseBudgets, planRequestFromRows, planRetryIdentity } from "./model";
import type { TaskRow } from "./model";
import { modelSettings } from "./settings";
import type { RunSettings } from "./settings";
import type { TicketActions } from "./TicketCard";

export interface InspectionState {
  diffs: Record<string, CandidateDiff>;
  attempts: Record<string, AttemptRecord[]>;
  publications: Record<string, PublicationRecord>;
  tasks: Record<string, TaskRecord[]>;
  logs: Record<string, { candidateHash: string; artifactId: string; text: string }>;
}

const NO_INSPECTIONS: InspectionState = { diffs: {}, attempts: {}, publications: {}, tasks: {}, logs: {} };

interface Options {
  client: LuunaClient | null;
  projectId: string;
  repositoryId: string;
  settings: RunSettings;
  componentContext?: ComponentContext;
  componentsEnabled: boolean;
  reload: () => void;
  onChanged: () => void;
  /** A relationship refusal quotes the override that would allow the plan (ADR 0023). */
  onSuggestedOverride: (override: DependencyOverride) => void;
}

/**
 * Every ticket, plan and candidate action, each guarded: one runtime request at a time, the
 * refusal reported in the runtime's words, and nothing reported from an aborted (disconnected or
 * switched) request. The runtime owns every execution, validation, review and repair decision.
 */
export function useWorkflowActions({ client, projectId, repositoryId, settings, componentContext, componentsEnabled, reload, onChanged, onSuggestedOverride }: Options) {
  const [inspections, setInspections] = useState<InspectionState>(NO_INSPECTIONS);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The offer a refused implementation carried (ADR 0022), beside the project view's offers.
  const [refusedOffer, setRefusedOffer] = useState<TestingPrerequisite | null>(null);
  const planDelivery = useRef<Record<string, { content: string; key: string }>>({});
  const operation = useRef<AbortController | null>(null);
  const notify = useNotify();

  useEffect(() => () => operation.current?.abort(), []);

  useEffect(() => {
    // An action started against the previous runtime or project must not report into this one.
    operation.current?.abort();
    setBusy(false);
    setInspections((current) => ({ ...NO_INSPECTIONS, publications: current.publications, tasks: current.tasks }));
    setError("");
    planDelivery.current = {};
  }, [client, projectId]);

  function guarded(label: string, action: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    // Disconnecting or switching project aborts the controller: a late result then reports nothing.
    void settleAction(controller, action, {
      succeeded: () => { reload(); onChanged(); if (COMPLETED[label]) notify(COMPLETED[label]); },
      // A refusal usually means the authoritative state moved; show it.
      failed: (failure) => {
        setError(actionFailure(label, failure));
        if (failure instanceof ApiError && failure.prerequisite) setRefusedOffer(failure.prerequisite);
        const suggested = failure instanceof ApiError ? overrideFromRefusal(failure.message) : null;
        if (suggested) onSuggestedOverride(suggested);
        reload();
      },
      settled: () => setBusy(false),
    });
  }

  /** Records an inspection's result for one run, unless the request was aborted. */
  function keep<K extends keyof InspectionState>(key: K, runId: string, signal: AbortSignal, value: InspectionState[K][string]) {
    if (!signal.aborted) setInspections((current) => ({ ...current, [key]: { ...current[key], [runId]: value } }));
  }

  function plan(ticket: Ticket, latestRevision: number, checks: SetupCheckRequest[] = []) {
    guarded("Planning", async (signal) => {
      if (!client) return;
      const budgets = parseBudgets(settings.attempts, settings.timeoutSeconds, settings.costDollars);
      const problem = planBudgetProblem(budgets);
      if (problem) throw new Error(problem);
      const setup = ticket.purpose === "testing_setup";
      // A setup plan is exactly one writer task on the offered repository with the recipes from its form (ADR 0022).
      const single: TaskRow = { repository_id: ticket.repository_ids.includes(repositoryId) ? repositoryId : ticket.repository_ids[0] ?? repositoryId, paths: settings.paths, write: settings.write, depends_on: [] };
      const rows = settings.taskRows.length && !setup ? settings.taskRows : [single];
      const workers = rows.length > 1 ? Number(settings.maxWorkers) : DEFAULT_PLAN_BUDGETS.max_workers;
      // The same builder the TUI uses, so both clients send one body for the same tasks.
      const request = planRequestFromRows(rows, { ...budgets, max_workers: workers }, componentsEnabled ? componentContext : undefined, setup ? [] : settings.overrideRows, setup ? checks : []);
      const delivery = planRetryIdentity(planDelivery.current[ticket.id] ?? null, latestRevision, request);
      planDelivery.current[ticket.id] = delivery;
      await client.createPlan(ticket.id, { ...request, idempotency_key: delivery.key }, signal);
      if (signal.aborted) return;
      delete planDelivery.current[ticket.id];
    });
  }

  function approve(revision: PlanRevision) {
    guarded("Approval", async (signal) => {
      if (!client) return;
      const approvedBy = settings.approver.trim() || "developer";
      if (utf8Bytes(approvedBy) > TEXT_LIMITS.approver) throw new Error(`The approver name is ${utf8Bytes(approvedBy)} bytes; the runtime accepts at most ${TEXT_LIMITS.approver} (UTF-8).`);
      await client.approvePlan(revision.id, { plan_revision: revision.revision, plan_hash: revision.hash, approved_by: approvedBy }, signal);
    });
  }

  const model = () => modelSettings(settings);
  const hashOf = (run: RunRecord, view: { evidence: { candidate: { hash: string } } | null }) => view.evidence?.candidate.hash;

  const actions: Omit<TicketActions, "derive"> = {
    reconcile: (ticket) => guarded("Ticket reconciliation", async (signal) => { await client!.reconcileTicket(ticket.id, ticket.revision, signal); }),
    plan,
    approve,
    update: (ticket, request) => guarded("Ticket edit", async (signal) => { if (client) await client.updateTicket(ticket.id, request, signal); }),
    implement: (run, taskId) => guarded(taskId ? "Task resumption" : "Implementation", async (signal) => { if (client) await client.implement(run.id, { ...(taskId && { task_id: taskId }), ...model() }, signal); }),
    cancel: (run) => guarded("Cancellation", async (signal) => { if (client) await client.cancelRun(run.id, signal); }),
    validate: (run, view) => guarded("Validation", async (signal) => {
      const hash = hashOf(run, view);
      if (client && hash) await client.validateCandidate(run.id, { candidate_hash: hash, auto_repair: settings.autoRepair, ...model() }, signal);
    }),
    repair: (run, view) => guarded("Repair", async (signal) => {
      const hash = hashOf(run, view);
      if (client && hash) await client.repairCandidate(run.id, { candidate_hash: hash, ...model() }, signal);
    }),
    diff: (run) => guarded("Diff inspection", async (signal) => { if (client) keep("diffs", run.id, signal, await client.candidateDiff(run.id, signal)); }),
    publish: (run, view) => guarded("Publication", async (signal) => {
      const hash = hashOf(run, view);
      if (!client || !hash) return;
      keep("publications", run.id, signal, await client.publish(run.id, { expected_hash: hash, idempotency_key: `publish-${run.id}-${hash.slice(7, 31)}` }, signal));
    }),
    publication: (run) => guarded("Publication inspection", async (signal) => { if (client) keep("publications", run.id, signal, await client.publication(run.id, signal)); }),
    reconcilePublication: (run) => guarded("Publication reconciliation", async (signal) => { if (client) keep("publications", run.id, signal, await client.reconcilePublication(run.id, signal)); }),
    repairPublication: (run, view) => guarded("Repair after a CI failure", async (signal) => {
      const hash = hashOf(run, view);
      if (!client || !hash) return;
      const { run: _started, ...record } = await client.repairPublication(run.id, { candidate_hash: hash, ...model() }, signal);
      keep("publications", run.id, signal, record);
    }),
    tasks: (run) => guarded("Task graph inspection", async (signal) => { if (client) keep("tasks", run.id, signal, await client.tasks(run.id, signal)); }),
    attempts: (run) => guarded("Attempt inspection", async (signal) => { if (client) keep("attempts", run.id, signal, await client.attempts(run.id, signal)); }),
    artifact: (run, view, artifactId) => guarded("Log inspection", async (signal) => {
      const hash = hashOf(run, view);
      if (!client || !hash) return;
      const text = await client.artifact(run.id, artifactId, signal);
      keep("logs", run.id, signal, { candidateHash: hash, artifactId, text });
    }),
  };

  return { actions, guarded, inspections, error, setError, busy, refusedOffer };
}
