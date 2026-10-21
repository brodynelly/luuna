import { describe, expect, it, vi } from "vitest";
import { ApiError, DEFAULT_PLAN_BUDGETS, LuunaClient, MAX_PAGE, planBudgetProblem, readEventPages, validIdempotencyKey } from "../src/index";
import type { CandidateView, EventEnvelope } from "../src/index";

const json = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json" } });
const task = { repository_id: "app", paths: ["src"], operations: ["read" as const, "write" as const] };

describe("paged reads (contract 2)", () => {
  it("adds an optional limit beside the cursor and keeps the unbounded default", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("[]")));
    const client = new LuunaClient("http://127.0.0.1:4242", "t", fetcher);
    await client.events("run/1", 7);
    await client.events("run/1", 7, undefined, { limit: 500 });
    await client.projectEvents("p", 0, undefined, { limit: MAX_PAGE });
    await client.listRuns(undefined, { limit: 200 });
    await client.listRuns();
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:4242/api/v1/runs/run%2F1/events?after=7",
      "http://127.0.0.1:4242/api/v1/runs/run%2F1/events?after=7&limit=500",
      "http://127.0.0.1:4242/api/v1/projects/p/events?after=0&limit=10000",
      "http://127.0.0.1:4242/api/v1/runs?limit=200",
      "http://127.0.0.1:4242/api/v1/runs",
    ]);
    for (const limit of [0, MAX_PAGE + 1, 1.5, Number.NaN]) {
      expect(() => client.events("r", 0, undefined, { limit })).toThrow("limit must be an integer");
      expect(() => client.listRuns(undefined, { limit })).toThrow("limit must be an integer");
    }
    expect(() => client.events("r", 2 ** 63)).toThrow("Invalid event cursor");
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("reads every event in pages from a cursor and tolerates a runtime that ignores the limit", async () => {
    const event = (sequence: number) => ({ sequence, event_id: `e${sequence}`, run_id: "r" }) as EventEnvelope;
    const all = Array.from({ length: 7 }, (_, index) => event(index + 1));
    const paged = vi.fn(async (after: number, page: { limit?: number }) => all.filter((item) => item.sequence > after).slice(0, page.limit));
    expect((await readEventPages(paged, 2, 2)).map((item) => item.sequence)).toEqual([3, 4, 5, 6, 7]);
    expect(paged.mock.calls.map(([after]) => after)).toEqual([2, 4, 6]);
    const unpaged = vi.fn(async (after: number) => all.filter((item) => item.sequence > after));
    expect((await readEventPages(unpaged, 0, 2)).map((item) => item.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(unpaged.mock.calls.map(([after]) => after)).toEqual([0, 7]);
    // A page that does not advance the cursor ends the read instead of looping.
    const stuck = vi.fn(async () => [event(1), event(2)]);
    expect(await readEventPages(stuck, 5, 2)).toHaveLength(2);
    expect(stuck).toHaveBeenCalledTimes(1);
  });
});

describe("runtime reasons (contracts 3 and 4)", () => {
  it("surfaces a JSON reason for extractor, size and shutdown refusals and marks it as the runtime's", async () => {
    const shutdown = new LuunaClient("http://localhost:4242", "t", vi.fn<typeof fetch>().mockResolvedValue(json(503, { error: "runtime is shutting down" })));
    await expect(shutdown.startBaseline("p", { repository_id: "app" })).rejects.toMatchObject({ status: 503, message: "runtime is shutting down", fromRuntime: true });
    const extractor = new LuunaClient("http://localhost:4242", "t", vi.fn<typeof fetch>().mockResolvedValue(json(422, { error: "Failed to deserialize the JSON body into the target type: manifest.repositories[0].checks[0].required: invalid type: string \"yes\", expected a boolean at line 1 column 345" })));
    await expect(extractor.discover("p")).rejects.toThrow("checks[0].required: invalid type");
    const large = new LuunaClient("http://localhost:4242", "t", vi.fn<typeof fetch>().mockResolvedValue(json(413, { error: "length limit exceeded" })));
    await expect(large.discover("p")).rejects.toThrow("length limit exceeded");
  });

  it("never shows a text body; an older runtime's text/plain rejection stays generic and is marked as such", async () => {
    const legacy = new LuunaClient("http://localhost:4242", "t", vi.fn<typeof fetch>().mockResolvedValue(json(422, "Failed to deserialize the JSON body: unknown field `secret`")));
    const failure = await legacy.discover("p").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 422, message: "Runtime request failed (HTTP 422).", fromRuntime: false });
    const internal = new LuunaClient("http://localhost:4242", "t", vi.fn<typeof fetch>().mockResolvedValue(json(500, { error: "storage detail" })));
    await expect(internal.discover("p")).rejects.toMatchObject({ fromRuntime: false, message: "Runtime request failed (HTTP 500)." });
  });
});

describe("plan creation (contracts 5 and 7)", () => {
  it("sends the draft's idempotency key and budgets and refuses out-of-range budgets before any request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(201, {}));
    const client = new LuunaClient("http://localhost:4242", "t", fetcher);
    const request = { task, budgets: { max_attempts: 3, timeout_seconds: 1800, cost_usd_micros: 2_500_000 }, idempotency_key: "plan-draft-1" };
    await client.createPlan("ticket/1", request);
    expect(String(fetcher.mock.calls[0][0])).toBe("http://localhost:4242/api/v1/tickets/ticket%2F1/plans");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(request);
    for (const [budgets, reason] of [
      [{ max_attempts: 0 }, "budgets.max_attempts must be between 1 and 10"],
      [{ max_attempts: 11 }, "budgets.max_attempts must be between 1 and 10"],
      [{ timeout_seconds: 86_401 }, "budgets.timeout_seconds must be between 1 and 86400"],
      [{ cost_usd_micros: 0 }, "budgets.cost_usd_micros must be between 1 and 1000000000"],
      [{ cost_usd_micros: 1.5 }, "budgets.cost_usd_micros must be between 1 and 1000000000"],
    ] as const) {
      expect(planBudgetProblem(budgets)).toBe(reason);
      await expect(client.createPlan("t", { task, budgets })).rejects.toThrow(reason);
    }
    expect(planBudgetProblem(DEFAULT_PLAN_BUDGETS)).toBeNull();
    expect(DEFAULT_PLAN_BUDGETS).toEqual({ max_attempts: 2, timeout_seconds: 600, cost_usd_micros: 1_000_000 });
    for (const key of ["", " spaced", "x".repeat(129), "kéy"]) {
      expect(validIdempotencyKey(key)).toBe(false);
      await expect(client.createPlan("t", { task, idempotency_key: key })).rejects.toThrow("idempotency key");
    }
    expect(validIdempotencyKey(crypto.randomUUID())).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("drops the key once only for a runtime that cannot decode it, never after a runtime reason", async () => {
    const legacy = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(422, "Failed to deserialize the JSON body into the target type: unknown field `idempotency_key`"))
      .mockResolvedValueOnce(json(201, { plan: { revision: 1 } }));
    const opened = await new LuunaClient("http://localhost:4242", "t", legacy).createPlan("t", { task, idempotency_key: "k" });
    expect(opened).toEqual({ plan: { revision: 1 } });
    expect(JSON.parse(String(legacy.mock.calls[1][1]?.body))).toEqual({ task });
    const conflict = vi.fn<typeof fetch>().mockResolvedValue(json(409, { error: "idempotency key was used for a different plan request" }));
    await expect(new LuunaClient("http://localhost:4242", "t", conflict).createPlan("t", { task, idempotency_key: "k" })).rejects.toThrow("different plan request");
    const refused = vi.fn<typeof fetch>().mockResolvedValue(json(422, { error: "unknown field `idempotency_key`" }));
    await expect(new LuunaClient("http://localhost:4242", "t", refused).createPlan("t", { task, idempotency_key: "k" })).rejects.toThrow("unknown field");
    expect(conflict).toHaveBeenCalledTimes(1);
    expect(refused).toHaveBeenCalledTimes(1);
    const unkeyed = vi.fn<typeof fetch>().mockResolvedValue(json(422, "plain"));
    await expect(new LuunaClient("http://localhost:4242", "t", unkeyed).createPlan("t", { task })).rejects.toThrow("HTTP 422");
    expect(unkeyed).toHaveBeenCalledTimes(1);
  });
});

describe("repository rebind (contract 8) and candidate decisions (contract 1)", () => {
  it("posts an explicit rebind for one registered repository", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(json(200, {})));
    const client = new LuunaClient("http://localhost:4242", "t", fetcher);
    await client.rebindRepository("project one", "app", { local_path: "/srv/moved" });
    await client.rebindRepository("p", "app");
    expect(fetcher.mock.calls.map(([url, init]) => [String(url), init?.method, init?.body])).toEqual([
      ["http://localhost:4242/api/v1/projects/project%20one/repositories/app/rebind", "POST", JSON.stringify({ local_path: "/srv/moved" })],
      ["http://localhost:4242/api/v1/projects/p/repositories/app/rebind", "POST", "{}"],
    ]);
  });

  it("types the decision reasons and workflow usage as optional additions", async () => {
    const body = { evidence: null, active: false, repair_allowed: false, revalidate_allowed: false, validate_allowed: false, decision_reasons: { validate: "no candidate recorded", repair: "no candidate recorded", revalidate: null }, usage: { attempts: 2, max_attempts: 2, elapsed_seconds: 312, timeout_seconds: 600, cost_usd_micros: 420_000, cost_budget_usd_micros: 1_000_000, cost_unreported: false, repairs: 1, max_repairs: 2 } };
    const view: CandidateView = await new LuunaClient("http://localhost:4242", "t", vi.fn<typeof fetch>().mockResolvedValue(json(200, body))).candidate("r");
    expect(view.decision_reasons?.validate).toBe("no candidate recorded");
    expect(view.usage?.max_repairs).toBe(2);
    const legacy: CandidateView = { evidence: null, active: false, repair_allowed: false, revalidate_allowed: false };
    expect(legacy.validate_allowed ?? null).toBeNull();
  });
});
