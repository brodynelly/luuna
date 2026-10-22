import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { ApiError } from "@luuna/api-client";
import type { RunRecord } from "@luuna/api-client";
import { authenticationLost, historySelection, sessionStatus, watchRuns } from "./App";

const immediately = () => Promise.resolve();

test("paging and history eviction keep controls and event replay on a displayed run", () => {
  const page = [{ id: "older-1" }, { id: "older-2" }] as RunRecord[];
  expect(historySelection("newest", page)).toBe("older-1");
  expect(historySelection("older-2", page)).toBe("older-2");
  expect(historySelection("older-2", [])).toBeNull();
  expect(historySelection(null, page)).toBe("older-1");
});

test("a rejected token stops background polling and asks for the current token", async () => {
  const listRuns = vi.fn().mockRejectedValue(new ApiError(401, "The service rejected this token. Reconnect using its current token."));
  const on = { listed: vi.fn(), outage: vi.fn(), rejected: vi.fn() };
  await watchRuns({ listRuns }, new AbortController().signal, on, immediately);
  expect(listRuns).toHaveBeenCalledTimes(1);
  expect(on.rejected).toHaveBeenCalledTimes(1);
  expect(on.outage).not.toHaveBeenCalled();
  expect(authenticationLost(new ApiError(403, "denied"))).toBe(false);
  expect(authenticationLost(new TypeError("Failed to fetch"))).toBe(false);
});

test("an outage is retried until the runtime answers, with the most recent runs only", async () => {
  const controller = new AbortController();
  const runs = [{ id: "r" } as RunRecord];
  const listRuns = vi.fn()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockImplementationOnce(async () => { controller.abort(); return runs; });
  const on = { listed: vi.fn(), outage: vi.fn(), rejected: vi.fn() };
  await watchRuns({ listRuns }, controller.signal, on, immediately);
  expect(on.outage).toHaveBeenCalledTimes(1);
  expect(on.rejected).not.toHaveBeenCalled();
  expect(listRuns.mock.calls[0][1]).toEqual({ limit: 200 });
});

test("live regions announce transitions, not every replayed event", () => {
  expect(sessionStatus("Connected", "implementing")).toBe("Connected · session implementing");
  expect(sessionStatus("Connected", "testing_blocked")).toBe("Connected · session testing blocked");
  expect(sessionStatus("Reconnecting · replay will resume from sequence 4", "running")).toContain("Reconnecting");
  const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  expect(source).not.toMatch(/<pre aria-live/);
  expect(source).not.toMatch(/event replay from sequence \$\{cursor\}/);
});
