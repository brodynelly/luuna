import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskGraph, TicketCard, Workflows, boundedMap, parseBudgets, planRequestFromRows, planRetryIdentity, readWorkflowReplay, readWorkflows, rowsFromProposal, setupTicketDraft, taskResumable } from "../Workflows";
import { planRequestForTasks } from "@luuna/api-client";
import type { CandidateView, EventEnvelope, LuunaClient, PlanRevision, RunState, TaskRecord, TaskState } from "@luuna/api-client";
import { advanceWorkflowReplay, canCancel, settleAction, workflowReason } from "../workflow-state";
import { noActions, offer, planOf, runOf, ticket } from "./fixtures.test-support";

// Workflow state, reads and the request bodies the desktop sends (parity with the TUI, R02).
test("idle workflows never offer process cancellation", () => {
  for (const state of ["plan_ready", "approved", "validating", "paused", "failed", "cancelled"] as RunState[]) expect(canCancel(state)).toBe(false);
  expect(canCancel("implementing")).toBe(true);
  expect(canCancel("running")).toBe(true);
});

test("workflow reasons come from the latest durable reason event", () => {
  const events = [{ payload: { reason: "old" } }, { payload: { reason: "writer exceeded cost budget" } }, { payload: {} }] as EventEnvelope[];
  expect(workflowReason(events)).toBe("writer exceeded cost budget");
  expect(workflowReason([])).toBe("");
});

test("workflow replay reduces each page before fetching the next and stops on an invalid page", async () => {
  let reduced = 0;
  const events = vi.fn(async (_id: string, after: number) => {
    expect(reduced).toBe(after);
    if (after === 3000) return [];
    return Array.from({ length: 1000 }, (_, index) => ({ schema_version: "0.1", timestamp: "", project_id: "p", type: "x", run_id: "r", event_id: `e-${after + index + 1}`, sequence: after + index + 1,
      get payload() { reduced = after + index + 1; return { reason: `reason-${reduced}` }; },
    } as EventEnvelope));
  });
  const signal = new AbortController().signal;
  expect(await readWorkflowReplay({ events } as unknown as LuunaClient, "r", undefined, signal)).toEqual({ cursor: 3000, reason: "reason-3000" });
  expect(events).toHaveBeenCalledTimes(4);
  const gap = vi.fn(async () => [{ run_id: "r", sequence: 2, payload: {} } as EventEnvelope]);
  await expect(readWorkflowReplay({ events: gap } as unknown as LuunaClient, "r", undefined, signal)).rejects.toThrow();
  expect(gap).toHaveBeenCalledTimes(1);
});

test("a plan draft keeps one idempotency key until it is created or changed", () => {
  const request = { task: { repository_id: "app", paths: ["src"], operations: ["read" as const] }, budgets: { max_attempts: 2 } };
  const first = planRetryIdentity(null, 1, request, () => "first");
  expect(planRetryIdentity(first, 1, request, () => { throw new Error("a retry must reuse the key"); })).toBe(first);
  expect(planRetryIdentity(first, 1, { ...request, budgets: { max_attempts: 3 } }, () => "edited").key).toBe("edited");
  expect(planRetryIdentity(first, 2, request, () => "next-revision").key).toBe("next-revision");
});

test("polling reads only what moved: events after each cursor, settled candidates and tickets once", async () => {
  const event = (run: string, sequence: number, reason?: string) => ({ schema_version: "0.1", event_id: `${run}-${sequence}`, sequence, timestamp: "", project_id: "p", run_id: run, type: "x", payload: reason ? { reason } : {} }) as EventEnvelope;
  const log: Record<string, EventEnvelope[]> = { done: [event("done", 1), event("done", 2, "writer exceeded cost budget")], live: [event("live", 1)] };
  let runs = [runOf("done", "paused", 4), runOf("live", "implementing", 2)];
  const settled: CandidateView = { evidence: null, active: false, repair_allowed: false, revalidate_allowed: false };
  const client = {
    listRuns: vi.fn(async () => runs),
    listTickets: vi.fn(async () => [ticket]),
    ticket: vi.fn(async () => ticket),
    listPlans: vi.fn(async () => [planOf(1)]),
    ticketSource: vi.fn(),
    worktrees: vi.fn(async () => []),
    events: vi.fn(async (id: string, after: number) => log[id].filter((item) => item.sequence > after)),
    candidate: vi.fn(async (id: string) => (id === "live" ? { ...settled, active: true } : settled)),
  };
  const signal = new AbortController().signal;
  const first = (await readWorkflows(client as unknown as LuunaClient, "p", new Map(), true, signal))!;
  expect(first.tickets?.list).toEqual([ticket]);
  expect(first.snapshots.get("done")).toMatchObject({ cursor: 2, reason: "writer exceeded cost budget" });
  // Each read continues until an empty page: a short page is not the end of a bounded log.
  const reads = () => client.events.mock.calls.map(([id, after]) => [id, after]).sort((a, b) => String(a).localeCompare(String(b)));
  expect(reads()).toEqual([["done", 0], ["done", 2], ["live", 0], ["live", 1]]);
  for (const mock of Object.values(client)) mock.mockClear();

  log.live.push(event("live", 2));
  const poll = (await readWorkflows(client as unknown as LuunaClient, "p", first.snapshots, false, signal))!;
  expect(poll.tickets).toBeNull();
  expect(client.listTickets).not.toHaveBeenCalled();
  expect(client.candidate.mock.calls.map(([id]) => id)).toEqual(["live"]);
  expect(reads()).toEqual([["live", 1], ["live", 2]]);
  expect(poll.snapshots.get("done")).toBe(first.snapshots.get("done"));
  expect(poll.snapshots.get("live")?.cursor).toBe(2);
  for (const mock of Object.values(client)) mock.mockClear();

  // A transition re-reads every candidate (one writer per repository) and the tickets, still from each cursor.
  runs = [runOf("done", "paused", 4), runOf("live", "validating", 3)];
  log.live.push(event("live", 3, "candidate recorded"));
  const moved = (await readWorkflows(client as unknown as LuunaClient, "p", poll.snapshots, false, signal))!;
  expect(client.listTickets).toHaveBeenCalledTimes(1);
  expect(client.candidate.mock.calls.map(([id]) => id).sort()).toEqual(["done", "live"]);
  expect(reads()).toEqual([["done", 2], ["live", 2], ["live", 3]]);
  expect(moved.snapshots.get("done")?.reason).toBe("writer exceeded cost budget");
  expect(moved.snapshots.get("live")?.reason).toBe("candidate recorded");
});

test("an action that settles after a disconnect reports nothing into the current view", async () => {
  const report = { succeeded: vi.fn(), failed: vi.fn(), settled: vi.fn() };
  const controller = new AbortController();
  let finish!: () => void;
  const pending = settleAction(controller, () => new Promise<void>((resolve) => { finish = resolve; }), report);
  controller.abort();
  finish();
  await pending;
  expect(report.succeeded).not.toHaveBeenCalled();
  expect(report.settled).not.toHaveBeenCalled();
  const refused = new AbortController();
  const late = settleAction(refused, async () => { refused.abort(); throw new Error("refused late"); }, report);
  await late;
  expect(report.failed).not.toHaveBeenCalled();
  await settleAction(new AbortController(), async () => {}, report);
  expect(report.succeeded).toHaveBeenCalledTimes(1);
  expect(report.settled).toHaveBeenCalledTimes(1);
});

test("workflow cursor retains reasons through empty pages and rejects incomplete replay atomically", () => {
  const event = (sequence: number, payload = {}) => ({ run_id: "run", event_id: `e${sequence}`, sequence, payload }) as EventEnvelope;
  const first = advanceWorkflowReplay("run", { cursor: 0, reason: "" }, [event(1, { reason: "blocked" }), event(2)]);
  expect(first).toEqual({ cursor: 2, reason: "blocked" });
  expect(advanceWorkflowReplay("run", first, [])).toEqual(first);
  expect(advanceWorkflowReplay("run", first, [event(3)])).toEqual({ cursor: 3, reason: "blocked" });
  expect(advanceWorkflowReplay("run", first, [event(3, { reason: "" })])).toEqual({ cursor: 3, reason: "" });
  expect(() => advanceWorkflowReplay("run", first, [event(3), event(5)])).toThrow("gap");
  expect(() => advanceWorkflowReplay("other", first, [event(3)])).toThrow("identity");
  expect(first).toEqual({ cursor: 2, reason: "blocked" });
});

test("bounded reads keep input order with at most four requests in flight", async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await boundedMap([1, 2, 3, 4, 5, 6, 7, 8, 9], async (value) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 10 - value));
    inFlight--;
    return value * 2;
  });
  expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
  expect(peak).toBeLessThanOrEqual(4);
});

test("the plan form sends one task in its pre-M4 shape and a task graph with dependencies and workers through the shared builder", () => {
  const budgets = parseBudgets("2", "600", "1.00");
  // One row: exactly the single-task body the panel sent before M4 (no id, no tasks, no max_workers).
  expect(planRequestFromRows([{ repository_id: "app", paths: "src, lib", write: true, depends_on: [] }], { ...budgets, max_workers: 1 })).toEqual({ task: { repository_id: "app", paths: ["src", "lib"], operations: ["read", "write"] }, budgets: { max_attempts: 2, timeout_seconds: 600, cost_usd_micros: 1_000_000 } });
  expect(planRequestFromRows([{ repository_id: "app", paths: "src", write: false, depends_on: [] }], budgets, { memory_ids: [], prompt: null })).not.toHaveProperty("component_context");
  expect(planRequestFromRows([{ repository_id: "app", paths: "src", write: false, depends_on: [] }], budgets, { memory_ids: ["mem-1"], prompt: null })).toMatchObject({ task: { operations: ["read"] }, component_context: { memory_ids: ["mem-1"] } });
  // Three rows: the body the TUI sends for `--task shared=lib --task api=src>shared --task consumer=src,tests>shared,api --workers 2 --attempts 3`.
  const graph = planRequestFromRows([
    { repository_id: "shared", paths: "lib", write: true, depends_on: [] },
    { repository_id: "api", paths: "src", write: true, depends_on: ["shared"] },
    { repository_id: "consumer", paths: "src,tests", write: true, depends_on: ["shared", "api"] },
  ], { max_attempts: 3, max_workers: 2 });
  expect(graph).toEqual({
    tasks: [
      { id: "shared", repository_id: "shared", paths: ["lib"], operations: ["read", "write"] },
      { id: "api", repository_id: "api", paths: ["src"], operations: ["read", "write"], depends_on: ["shared"] },
      { id: "consumer", repository_id: "consumer", paths: ["src", "tests"], operations: ["read", "write"], depends_on: ["shared", "api"] },
    ],
    budgets: { max_attempts: 3, max_workers: 2 },
  });
  expect(graph).toEqual(planRequestForTasks([
    { id: "shared", repository_id: "shared", paths: ["lib"], operations: ["read", "write"], depends_on: [] },
    { id: "api", repository_id: "api", paths: ["src"], operations: ["read", "write"], depends_on: ["shared"] },
    { id: "consumer", repository_id: "consumer", paths: ["src", "tests"], operations: ["read", "write"], depends_on: ["shared", "api"] },
  ], { max_attempts: 3, max_workers: 2 }));
  // What no runtime would accept is refused before any request.
  expect(() => planRequestFromRows([{ repository_id: "a", paths: "src", write: true, depends_on: [] }, { repository_id: "a", paths: "src", write: true, depends_on: [] }], budgets)).toThrow("distinct repository");
  expect(() => planRequestFromRows([{ repository_id: "a", paths: "src", write: true, depends_on: [] }, { repository_id: "b", paths: "src", write: true, depends_on: [] }], { ...budgets, max_workers: 3 })).toThrow("between 1 and 2");
});

test("a task of a settled graph resumes by task_id only in the resumable states, with the implement capability", () => {
  const task = (task_id: string, state: TaskState, depends_on: string[] = []): TaskRecord => ({ run_id: "run-1", task_id, repository_id: task_id, state, depends_on, updated_at: "" });
  for (const state of ["failed", "blocked", "interrupted"] as TaskState[]) {
    expect(taskResumable(runOf("run-1", "failed"), task("t", state))).toBe(true);
    expect(taskResumable(runOf("run-1", "interrupted"), task("t", state))).toBe(true);
    for (const runState of ["implementing", "approved", "validating", "cancelled", "reviewed", "completed"] as RunState[]) expect(taskResumable(runOf("run-1", runState), task("t", state)), `${runState}/${state}`).toBe(false);
  }
  for (const state of ["queued", "running", "completed", "cancelled"] as TaskState[]) expect(taskResumable(runOf("run-1", "failed"), task("t", state))).toBe(false);
  const resumed: string[] = [];
  const html = renderToStaticMarkup(<TaskGraph run={runOf("run-1", "failed")} tasks={[task("shared", "completed"), task("api", "failed", ["shared"]), task("consumer", "blocked", ["shared", "api"])]} busy={false} onResume={(id) => resumed.push(id)} />);
  expect(html).toContain("Resume task api");
  expect(html).toContain("Resume task consumer");
  expect(html).not.toContain("Resume task shared");
  expect(html.match(/data-capability="runs.implement"/g)).toHaveLength(2);
  const settled = renderToStaticMarkup(<TaskGraph run={runOf("run-1", "validating")} tasks={[task("shared", "completed"), task("api", "completed")]} busy={false} onResume={() => {}} />);
  expect(settled).not.toContain("Resume task");
  expect(settled).not.toContain('data-capability="runs.implement"');
});

test("the runtime's testing-setup offer is rendered from the project view with a create control that pre-fills a testing_setup ticket", () => {
  const html = renderToStaticMarkup(<Workflows client={null} projectId="p" repositoryId="app" prerequisites={[offer]} manifestConfirmed onChanged={() => {}} />);
  expect(html).toContain('aria-label="Testing-setup prerequisites"');
  expect(html).toContain("Create the testing-setup ticket for app");
  expect(html).toContain(offer.reason);
  expect(html).toContain("POST /api/v1/projects/p/tickets with purpose testing_setup");
  // The offer's control is a state-specific variant of ticket creation: the form's primary and the offer both carry tickets.create.
  expect(html.match(/data-capability="tickets.create"/g)).toHaveLength(2);
  expect(html).toMatch(/<span class="state" data-tone="attention">testing setup needed<\/span>/);
  expect(html).toContain('aria-label="Ticket purpose"');
  expect(html).toMatch(/<option value="testing_setup"[^>]*>testing setup/);
  expect(renderToStaticMarkup(<Workflows client={null} projectId="p" repositoryId="app" manifestConfirmed onChanged={() => {}} />)).not.toContain("Testing-setup prerequisites");
  const draft = setupTicketDraft(offer);
  expect(draft.purpose).toBe("testing_setup");
  expect(draft.repositoryIds).toEqual(["app"]);
  expect(draft.title).toBe("Establish the testing setup for app");
  expect(draft.intent).toContain(offer.reason);
  expect(draft.intent).toContain(offer.next);
});

test("task rows send their role and derivation, overrides travel with the plan, and an advisory row reads only", () => {
  const budgets = parseBudgets("2", "600", "1.00");
  const rows = [
    { repository_id: "shared", paths: "lib", write: true, depends_on: [], role: "repository_lead" as const },
    { repository_id: "api", paths: "src", write: true, depends_on: ["shared"], derived_from_task: "orchestrate" },
    { repository_id: "consumer", paths: "src", write: true, depends_on: [], role: "implementer" as const },
  ];
  const overrides = [{ consumer: "consumer", producer: "api", action: "waive" as const, justification: "the consumer pins the published package" }];
  const request = planRequestFromRows(rows, { ...budgets, max_workers: 2 }, undefined, overrides);
  expect(request).toEqual({
    tasks: [
      { id: "shared", repository_id: "shared", paths: ["lib"], operations: ["read"], role: "repository_lead" },
      { id: "api", repository_id: "api", paths: ["src"], operations: ["read", "write"], depends_on: ["shared"], derived_from_task: "orchestrate" },
      { id: "consumer", repository_id: "consumer", paths: ["src"], operations: ["read", "write"] },
    ],
    dependency_overrides: overrides,
    budgets: { max_attempts: 2, timeout_seconds: 600, cost_usd_micros: 1_000_000, max_workers: 2 },
  });
  // The TUI's `plan --task "shared=lib;role=repository_lead" --task "api=src>shared;derived_from=orchestrate" --task consumer=src --override consumer:api:waive:…` sends the same body.
  expect(request).toEqual(planRequestForTasks([
    { id: "shared", repository_id: "shared", paths: ["lib"], operations: ["read"], depends_on: [], role: "repository_lead" },
    { id: "api", repository_id: "api", paths: ["src"], operations: ["read", "write"], depends_on: ["shared"], derived_from_task: "orchestrate" },
    { id: "consumer", repository_id: "consumer", paths: ["src"], operations: ["read", "write"], depends_on: [] },
  ], { ...budgets, max_workers: 2 }, { dependencyOverrides: overrides }));
  const multi = renderToStaticMarkup(<Workflows client={null} projectId="p" repositoryId="app" repositoryIds={["app", "web"]} manifestConfirmed onChanged={() => {}} />);
  expect(multi).not.toContain('aria-label="Task 1 role"');
  expect(() => planRequestFromRows([rows[0], { ...rows[2], repository_id: "shared" }], budgets)).toThrow("distinct repository");
});

test("the task graph shows each task's trace and advisory result, and derives the next plan's rows from a proposal", () => {
  const trace = { approved_by: "developer", approval_id: "approval-1", approved_at: "2026-10-22T10:00:00Z", plan_id: "plan-1", plan_revision: 1, plan_hash: `sha256:${"e".repeat(64)}` };
  const orchestrate: TaskRecord = { run_id: "run-1", task_id: "orchestrate", repository_id: "app", role: "project_orchestrator", state: "completed", depends_on: [], assigned_by: trace, dependency_overrides: [], advisory_result: { findings: ["the API lacks a contract test"], proposed_tasks: [{ id: "lead", repository_id: "web", role: "repository_lead", depends_on: [], paths: ["src"] }, { id: "api-task", repository_id: "app", role: "implementer", depends_on: ["lead"], paths: ["src", "tests"], rationale: "contract first" }], risks: ["the shared package is unpinned"] }, updated_at: "" };
  const consumer: TaskRecord = { run_id: "run-1", task_id: "consumer", repository_id: "web", role: "implementer", state: "failed", depends_on: ["orchestrate"], assigned_by: trace, derived_from_task: "orchestrate", dependency_overrides: [{ consumer: "consumer", producer: "shared", action: "waive", justification: "pinned package" }], reason: "scope violation", updated_at: "" };
  const derived: TaskRecord[] = [];
  const html = renderToStaticMarkup(<TaskGraph run={runOf("run-1", "completed")} tasks={[orchestrate, consumer]} busy={false} onResume={() => {}} onDerive={(task) => derived.push(task)} />);
  expect(html).toContain("role project orchestrator");
  expect(html).toContain("assigned by developer · approval <code>approval-1</code> at 2026-10-22T10:00:00Z · plan <code>plan-1</code> r1");
  expect(html).toContain(trace.plan_hash);
  expect(html).toContain("derived from advisory task <code>orchestrate</code>");
  expect(html).toContain("waive <code>consumer</code> ← <code>shared</code> (pinned package)");
  expect(html).toContain("Advisory result: 1 finding(s), 2 proposed task(s), 1 risk(s)");
  expect(html).toContain("the API lacks a contract test");
  expect(html).toContain("the shared package is unpinned");
  expect(html).toContain("contract first");
  expect(html).toContain("Derive plan from this proposal");
  expect(html).not.toContain("Resume task");
  expect(renderToStaticMarkup(<TaskGraph run={runOf("run-1", "completed")} tasks={[orchestrate]} busy={false} onResume={() => {}} />)).not.toContain("Derive plan from this proposal");
  // The derived rows: the proposal's tasks on their repositories, dependencies mapped to repository ids, every row deriving from the advisory task.
  expect(rowsFromProposal(orchestrate)).toEqual([
    { repository_id: "web", paths: "src", write: false, depends_on: [], role: "repository_lead", derived_from_task: "orchestrate" },
    { repository_id: "app", paths: "src,tests", write: true, depends_on: ["web"], role: "implementer", derived_from_task: "orchestrate" },
  ]);
  expect(planRequestFromRows(rowsFromProposal(orchestrate), parseBudgets("2", "600", "1.00"))).toMatchObject({ tasks: [{ id: "web", role: "repository_lead", operations: ["read"], derived_from_task: "orchestrate" }, { id: "app", depends_on: ["web"], derived_from_task: "orchestrate" }] });
  expect(rowsFromProposal(consumer)).toEqual([]);
  // A single advisory task's graph is inspectable although the plan has one task.
  const advisoryPlan = { ...planOf(1), tasks: [{ paths: ["src"], role: "project_orchestrator" }] } as unknown as PlanRevision;
  expect(renderToStaticMarkup(<TicketCard ticket={ticket} revisions={[{ plan: advisoryPlan, run: runOf("run-1", "completed") }]} snapshots={new Map()} diffs={{}} logs={{}} busy={false} connected actions={noActions} />)).toContain("Show task graph");
});
