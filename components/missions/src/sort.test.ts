import { describe, expect, test } from "bun:test";
import { isSortMode, sortIssues } from "./sort.ts";
import type { Issue } from "./types.ts";

function issue(overrides: Partial<Issue>): Issue {
	return {
		id: "proj-0000",
		title: "t",
		status: "open",
		type: "task",
		priority: 2,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("sortIssues", () => {
	test("priority asc, tie-break by createdAt desc", () => {
		const a = issue({ id: "p-aaaa", priority: 2, createdAt: "2026-01-01T00:00:00.000Z" });
		const b = issue({ id: "p-bbbb", priority: 0, createdAt: "2026-01-02T00:00:00.000Z" });
		const c = issue({ id: "p-cccc", priority: 2, createdAt: "2026-01-03T00:00:00.000Z" });
		const d = issue({ id: "p-dddd", priority: 1, createdAt: "2026-01-04T00:00:00.000Z" });
		const result = sortIssues([a, b, c, d], "priority");
		expect(result.map((i) => i.id)).toEqual(["p-bbbb", "p-dddd", "p-cccc", "p-aaaa"]);
	});

	test("created sorts newest first", () => {
		const a = issue({ id: "p-aaaa", createdAt: "2026-01-01T00:00:00.000Z" });
		const b = issue({ id: "p-bbbb", createdAt: "2026-03-01T00:00:00.000Z" });
		const c = issue({ id: "p-cccc", createdAt: "2026-02-01T00:00:00.000Z" });
		const result = sortIssues([a, b, c], "created");
		expect(result.map((i) => i.id)).toEqual(["p-bbbb", "p-cccc", "p-aaaa"]);
	});

	test("updated sorts newest first", () => {
		const a = issue({ id: "p-aaaa", updatedAt: "2026-01-05T00:00:00.000Z" });
		const b = issue({ id: "p-bbbb", updatedAt: "2026-01-03T00:00:00.000Z" });
		const c = issue({ id: "p-cccc", updatedAt: "2026-01-10T00:00:00.000Z" });
		const result = sortIssues([a, b, c], "updated");
		expect(result.map((i) => i.id)).toEqual(["p-cccc", "p-aaaa", "p-bbbb"]);
	});

	test("id sorts ascending", () => {
		const a = issue({ id: "p-cccc" });
		const b = issue({ id: "p-aaaa" });
		const c = issue({ id: "p-bbbb" });
		const result = sortIssues([a, b, c], "id");
		expect(result.map((i) => i.id)).toEqual(["p-aaaa", "p-bbbb", "p-cccc"]);
	});

	test("does not mutate input", () => {
		const a = issue({ id: "p-aaaa", priority: 3 });
		const b = issue({ id: "p-bbbb", priority: 0 });
		const input = [a, b];
		sortIssues(input, "priority");
		expect(input.map((i) => i.id)).toEqual(["p-aaaa", "p-bbbb"]);
	});

	test("default mode is priority", () => {
		const a = issue({ id: "p-aaaa", priority: 3 });
		const b = issue({ id: "p-bbbb", priority: 0 });
		const result = sortIssues([a, b]);
		expect(result.map((i) => i.id)).toEqual(["p-bbbb", "p-aaaa"]);
	});
});

describe("isSortMode", () => {
	test("accepts valid modes", () => {
		expect(isSortMode("priority")).toBe(true);
		expect(isSortMode("created")).toBe(true);
		expect(isSortMode("updated")).toBe(true);
		expect(isSortMode("id")).toBe(true);
	});

	test("rejects invalid modes", () => {
		expect(isSortMode("foo")).toBe(false);
		expect(isSortMode("")).toBe(false);
		expect(isSortMode("PRIORITY")).toBe(false);
	});
});
