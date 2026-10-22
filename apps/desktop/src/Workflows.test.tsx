import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ByteCount, boundedMap, PlanReview, TEXT_LIMITS, TicketCard, Workflows, parseBudgets, planRetryIdentity, readWorkflowReplay, readWorkflows, ticketTextSizes } from "./Workflows";
import type { RunSnapshot, TicketActions } from "./Workflows";
import { planBudgetProblem } from "@luuna/api-client";
import type { CandidateView, EventEnvelope, LuunaClient, PlanRevision, RunRecord, RunState, Ticket } from "@luuna/api-client";
import { advanceWorkflowReplay, canCancel, planBlocker, planSupersedes, settleAction, workflowReason } from "./workflow-state";

test("approval presents every immutable field and full hash before acknowledgment", () => {
  const plan = { id: "plan-1", revision: 7, hash: `sha256:${"abcdef01".repeat(8)}`, permissions: { operations: ["write"] }, required_checks: [{ command: "private-check" }], tasks: [{ acceptance_criteria: ["all criteria visible"] }], manifest_hash: "manifest-identity", future_field: "also visible", component_context: { memory: [{ id: "memory-1", scope: "user", hash: "sha256:memory", content: "Explicitly selected knowledge", provenance: "Developer supplied note" }], prompt: { name: "guidance", version: 2, hash: "sha256:prompt", body: "Exact selected prompt content" } } } as unknown as PlanRevision;
  const html = renderToStaticMarkup(<PlanReview plan={plan} canApprove busy={false} onApprove={() => { throw new Error("unreviewed approval"); }} />);
  expect(html).toContain(plan.hash);
  for (const value of ["permissions", "operations", "private-check", "all criteria visible", "manifest-identity", "also visible", "Explicitly selected knowledge", "Developer supplied note", "Exact selected prompt content", "sha256:memory", "sha256:prompt"]) expect(html).toContain(value);
  expect(html).toMatch(/<button[^>]*disabled/);
  expect(html).toContain("I reviewed this complete plan and hash.");
});


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

const ticket: Ticket = { schema_version: "0.1", id: "ticket-1", project_id: "p", revision: 1, source: "luuna_sqlite_temporary", title: "Implement the greeting", intent: "Print it", acceptance_criteria: ["prints"], repository_ids: ["app"], created_at: "", updated_at: "" };
const planOf = (revision: number) => ({ id: "plan-1", revision, hash: `sha256:${String(revision).repeat(64)}`, base_commits: { app: "c".repeat(40) }, tasks: [{ paths: ["src"] }], budgets: { max_workers: 1, max_attempts: 2, timeout_seconds: 600, cost_usd_micros: 1_000_000 } }) as unknown as PlanRevision;
const runOf = (id: string, state: RunState, revision = 1, planRevision = 1): RunRecord => ({ id, project_id: "p", state, revision, metadata: { kind: "workflow", plan_id: "plan-1", plan_revision: planRevision }, created_at: "", updated_at: `t${revision}` });
const noActions: TicketActions = { reconcile() {}, plan() {}, approve() {}, implement() {}, cancel() {}, validate() {}, repair() {}, diff() {}, attempts() {}, tasks() {}, artifact() {}, publish() {}, publication() {}, reconcilePublication() {} };

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
const pendingEvidence = { candidate: { schema_version: "0.1", id: "c", revision: 1, plan_hash: "sha256:p", repository_commits: { app: "b".repeat(40) }, dependency_bindings: {}, hash: `sha256:${"a".repeat(64)}` }, run_id: "run-1", implementer_session: "w", repository_trees: {}, status: "pending" as const, results: [], started_at: "", elapsed_seconds: 1, cost_usd_micros: 1, validation_generation: 1 };
const snapshot = (candidate: CandidateView, reason = ""): RunSnapshot => ({ revision: 1, updated: "t1", cursor: 0, reason, leases: [], candidate });
function card(run: RunRecord, candidate: CandidateView, reason = "", earlier: { plan: PlanRevision; run?: RunRecord }[] = []) {
  const latest = planOf(earlier.length + 1);
  return renderToStaticMarkup(<TicketCard ticket={ticket} revisions={[...earlier, { plan: latest, run }]} snapshots={new Map([[run.id, snapshot(candidate, reason)]])} diffs={{}} logs={{}} busy={false} connected actions={noActions} />);
}
const planButton = (html: string) => html.match(/<button[^>]*>Plan r\d+<\/button>/)?.[0] ?? "";

test("a new plan revision is held back while the latest revision's work is active, and confirmed when it leaves work behind", () => {
  const writing = card(runOf("run-1", "implementing"), { evidence: null, active: true, repair_allowed: false, revalidate_allowed: false });
  expect(planButton(writing)).toContain("disabled");
  expect(writing).toContain("Plan r2 is available once r1&#x27;s active work settles; cancel it to stop sooner.");
  expect(writing).not.toContain("anyway");
  const reviewing = card(runOf("run-1", "validating"), { evidence: { ...pendingEvidence, status: "reviewing" }, active: true, repair_allowed: false, revalidate_allowed: false });
  expect(planButton(reviewing)).toContain("disabled");
  // A pending candidate is never a dead end: when the runtime refuses its validation (a moved
  // manifest, spent budgets), confirming the new revision is the way on.
  const waiting = card(runOf("run-1", "validating"), { evidence: pendingEvidence, active: false, repair_allowed: false, revalidate_allowed: false, validate_allowed: false, decision_reasons: { validate: "manifest changed; re-plan", repair: null, revalidate: null } });
  expect(planButton(waiting)).toContain("disabled");
  expect(waiting).not.toContain("is available once");
  expect(waiting).toMatch(/<label class="plan-supersede"><input type="checkbox"\/> Plan r2 anyway: r1&#x27;s candidate is waiting for validation and can no longer be validated once r2 exists.<\/label>/);
  for (const [state, left] of [["approved", "approval no longer authorizes"], ["reviewed", "reviewed candidate keeps its evidence"]] as const) {
    const html = card(runOf("run-1", state), { evidence: state === "reviewed" ? { ...pendingEvidence, status: "reviewed" } : null, active: false, repair_allowed: false, revalidate_allowed: false });
    expect(planButton(html), state).toContain("disabled");
    expect(html, state).toContain(left);
  }
  for (const state of ["paused", "failed", "interrupted", "cancelled", "plan_ready"] as RunState[]) {
    const settled = card(runOf("run-1", state), { evidence: state === "plan_ready" ? null : { ...pendingEvidence, status: state === "cancelled" ? "cancelled" : "failed" }, active: false, repair_allowed: false, revalidate_allowed: false });
    expect(planButton(settled), state).not.toContain("disabled");
    expect(settled, state).not.toContain("is available once");
    expect(settled, state).not.toContain("anyway");
  }
  expect(planBlocker(1)).toBe("");
  expect(planSupersedes(1)).toBe("");
  expect(planSupersedes(1, runOf("run-1", "validating"), { evidence: { ...pendingEvidence, status: "validating" }, active: true, repair_allowed: false, revalidate_allowed: false })).toBe("");
});

test("the first writer attempt can be cancelled from the ticket card and says what runs", () => {
  const writing = card(runOf("run-1", "implementing"), { evidence: null, active: true, repair_allowed: false, revalidate_allowed: false });
  expect(writing).toContain("Cancel workflow");
  expect(writing).toContain("The runtime is running the scoped writer for plan r1. Closing this view does not cancel the workflow.");
  // Once a candidate exists its review owns the cancel, so the card never shows two.
  const repairing = card(runOf("run-1", "implementing"), { evidence: pendingEvidence, active: true, repair_allowed: false, revalidate_allowed: false });
  expect(repairing.match(/Cancel workflow/g)).toHaveLength(1);
  expect(card(runOf("run-1", "approved"), { evidence: null, active: false, repair_allowed: false, revalidate_allowed: false })).not.toContain("Cancel workflow");
});

test("a recorded reason under the ticket names the refusal instead of a refused action, and earlier revisions stay visible", () => {
  const paused = card(runOf("run-2", "paused", 1, 2), { evidence: { ...pendingEvidence, status: "paused" }, active: false, repair_allowed: false, revalidate_allowed: false, decision_reasons: { validate: "x", repair: "repair limit reached: 2 of 2 repairs used", revalidate: "x" } }, "independent review did not pass; repair or re-plan required", [{ plan: planOf(1), run: runOf("run-1", "cancelled") }]);
  expect(paused).toContain("Repair is not available: repair limit reached: 2 of 2 repairs used. Read the findings, then create the next plan revision.");
  expect(paused).not.toContain("repair the candidate or");
  expect(paused).toContain("Earlier revisions: <span>r1 <span class=\"state\" data-tone=\"neutral\">cancelled</span></span>");
  expect(paused).toContain("budget 2 attempt(s), 600s, $1.00");
  const noChange = card(runOf("run-1", "failed"), { evidence: null, active: false, repair_allowed: false, revalidate_allowed: false }, "writer settled without changing any file");
  expect(noChange).toContain("The writer changed nothing. Create the next plan revision with the paths the change needs");
});

test("plan budgets are entered with the runtime's defaults and bounds", () => {
  const html = renderToStaticMarkup(<Workflows client={null} projectId="p" repositoryId="app" manifestConfirmed onChanged={() => {}} />);
  for (const field of ["Writer attempts<input type=\"number\" inputMode=\"numeric\" min=\"1\" max=\"10\" step=\"1\" value=\"2\"", "Time budget (seconds)<input type=\"number\" inputMode=\"numeric\" min=\"1\" max=\"86400\" step=\"1\" value=\"600\"", "Cost budget (USD)<input type=\"number\" inputMode=\"decimal\" min=\"0.000001\" max=\"1000\" step=\"any\" value=\"1.00\""]) expect(html).toContain(field);
  expect(html).toContain("cumulative across the writer, checks, independent review and repairs");
  expect(parseBudgets("3", "1800", "2.5")).toEqual({ max_attempts: 3, timeout_seconds: 1800, cost_usd_micros: 2_500_000 });
  expect(parseBudgets("2", "600", "1.00")).toEqual({ max_attempts: 2, timeout_seconds: 600, cost_usd_micros: 1_000_000 });
  expect(planBudgetProblem(parseBudgets("", "600", "1"))).toBe("budgets.max_attempts must be between 1 and 10");
  expect(planBudgetProblem(parseBudgets("2", "90000", "1"))).toBe("budgets.timeout_seconds must be between 1 and 86400");
  expect(planBudgetProblem(parseBudgets("2", "600", "1000.01"))).toBe("budgets.cost_usd_micros must be between 1 and 1000000000");
  expect(planBudgetProblem(parseBudgets("2", "600", "abc"))).toBe("budgets.cost_usd_micros must be between 1 and 1000000000");
});

test("ticket text is counted in UTF-8 bytes with a visible counter, as the runtime counts it", () => {
  const html = renderToStaticMarkup(<Workflows client={null} projectId="p" repositoryId="app" manifestConfirmed onChanged={() => {}} />);
  expect(html).toContain("0 of 200 bytes");
  expect(html).toContain("Longest criterion: 0 of 16000 bytes");
  expect(html).not.toMatch(/maxLength="200"/);
  const cjk = ticketTextSizes("漢".repeat(100), "intent", ["short", "é".repeat(10)]);
  expect(cjk).toEqual({ title: 300, intent: 6, criterion: 20 });
  expect(cjk.title > TEXT_LIMITS.title).toBe(true);
  expect(renderToStaticMarkup(<ByteCount id="x" bytes={300} limit={200} />)).toContain("300 of 200 bytes · too long");
  expect(ticketTextSizes("", "", []).criterion).toBe(0);
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

test("the approver sees cumulative usage including unpriced provider work", () => {
  const html = renderToStaticMarkup(<TicketCard ticket={{ ...ticket, usage: { workflows: 3, attempts: 4, repairs: 1, elapsed_seconds: 77, cost_usd_micros: 250000, cost_unreported: true } }} revisions={[{ plan: planOf(2), run: runOf("run-1", "plan_ready") }]} snapshots={new Map()} diffs={{}} logs={{}} busy={false} connected actions={noActions} />);
  expect(html).toContain("3 workflow(s)");
  expect(html).toContain("$0.2500 recorded or reserved");
  expect(html).toContain("Some provider usage has no reported price");
  expect(html.indexOf("Cumulative ticket usage")).toBeLessThan(html.indexOf("Approve r2"));
});
