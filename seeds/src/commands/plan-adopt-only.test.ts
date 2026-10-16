import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../test-harness.ts";
import type { Issue, Plan } from "../types.ts";

async function run(
	args: string[],
	cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return runCli(args, cwd);
}

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "seeds-adopt-only-"));
	await run(["init"], tmpDir);
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

async function createSeed(cwd: string, title: string, type = "task"): Promise<string> {
	const { stdout } = await run(["create", "--title", title, "--type", type, "--json"], cwd);
	const parsed = JSON.parse(stdout) as { id: string };
	if (!parsed.id) throw new Error(`Could not parse created seed id from: ${stdout}`);
	return parsed.id;
}

async function readJsonl<T>(path: string): Promise<T[]> {
	const text = await Bun.file(path).text();
	return text
		.split("\n")
		.filter((l) => l.trim())
		.map((l) => JSON.parse(l) as T);
}

async function readPlans(cwd: string): Promise<Plan[]> {
	return readJsonl<Plan>(join(cwd, ".seeds", "plans.jsonl"));
}

async function readIssues(cwd: string): Promise<Issue[]> {
	return readJsonl<Issue>(join(cwd, ".seeds", "issues.jsonl"));
}

async function createPlan(cwd: string, seedId: string, extra: string[] = []): Promise<string> {
	const { stdout, exitCode } = await run(["plan", "create", seedId, "--json", ...extra], cwd);
	expect(exitCode).toBe(0);
	const parsed = JSON.parse(stdout) as { plan_id: string };
	return parsed.plan_id;
}

describe("sd plan create", () => {
	test("creates an adopt-only plan with zero children", async () => {
		const parent = await createSeed(tmpDir, "Release train");
		const { stdout, exitCode } = await run(["plan", "create", parent, "--json"], tmpDir);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout) as { plan_id: string; children: string[]; template: string };
		expect(out.plan_id.startsWith("pl-")).toBe(true);
		expect(out.children).toEqual([]);
		expect(out.template).toBe("feature");

		const plans = await readPlans(tmpDir);
		const plan = plans.find((p) => p.id === out.plan_id);
		expect(plan?.status).toBe("approved");
		expect(plan?.children).toEqual([]);
		expect(plan?.sections).toEqual({ steps: [] });
		expect(plan?.revision).toBe(1);

		const issues = await readIssues(tmpDir);
		const seed = issues.find((i) => i.id === parent);
		expect(seed?.plan_id).toBe(out.plan_id);
		expect(seed?.blockedBy ?? []).toEqual([]);
	});

	test("defaults plan name to the seed title; --name overrides", async () => {
		const a = await createSeed(tmpDir, "Default named");
		const planA = await createPlan(tmpDir, a);
		expect((await readPlans(tmpDir)).find((p) => p.id === planA)?.name).toBe("Default named");

		const b = await createSeed(tmpDir, "Custom seed");
		const planB = await createPlan(tmpDir, b, ["--name", "My Release"]);
		expect((await readPlans(tmpDir)).find((p) => p.id === planB)?.name).toBe("My Release");
	});

	test("honors --template and rejects an unknown one", async () => {
		const parent = await createSeed(tmpDir, "Templated", "bug");
		const planId = await createPlan(tmpDir, parent, ["--template", "refactor"]);
		expect((await readPlans(tmpDir)).find((p) => p.id === planId)?.template).toBe("refactor");

		const other = await createSeed(tmpDir, "Bad template");
		const { exitCode, stderr } = await run(["plan", "create", other, "--template", "nope"], tmpDir);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("Unknown template");
	});

	test("rejects when a non-draft plan already exists for the seed", async () => {
		const parent = await createSeed(tmpDir, "Dup plan");
		await createPlan(tmpDir, parent);
		const { exitCode, stderr } = await run(["plan", "create", parent], tmpDir);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("already exists");
	});

	test("errors on a missing seed", async () => {
		const { exitCode, stderr } = await run(["plan", "create", "test-9999"], tmpDir);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("Seed not found");
	});
});

describe("sd plan create → adopt → reorder (release train)", () => {
	test("assembles existing seeds in a controlled order with no junk seeds", async () => {
		const parent = await createSeed(tmpDir, "Release v2");
		const a = await createSeed(tmpDir, "Feature A");
		const b = await createSeed(tmpDir, "Feature B");
		const release = await createSeed(tmpDir, "Cut release");

		const planId = await createPlan(tmpDir, parent);
		await run(["plan", "adopt", planId, a, b, release], tmpDir);

		// release was adopted last but we want it pinned last explicitly.
		const { exitCode } = await run(["plan", "reorder", planId, a, b, release], tmpDir);
		expect(exitCode).toBe(0);

		const plan = (await readPlans(tmpDir)).find((p) => p.id === planId);
		expect(plan?.children).toEqual([a, b, release]);
		// No spawned/placeholder children: every child is an adoption.
		expect(plan?.adoptedChildren?.sort()).toEqual([a, b, release].sort());

		const issues = await readIssues(tmpDir);
		const seed = issues.find((i) => i.id === parent);
		expect((seed?.blockedBy ?? []).sort()).toEqual([a, b, release].sort());
		// All three adopted seeds stay open (link-only).
		for (const id of [a, b, release]) {
			expect(issues.find((i) => i.id === id)?.status).toBe("open");
		}
	});
});

describe("sd plan adopt --at/--before/--after", () => {
	async function setup(): Promise<{ planId: string; c1: string; c2: string }> {
		const parent = await createSeed(tmpDir, "Parent");
		const c1 = await createSeed(tmpDir, "Child 1");
		const c2 = await createSeed(tmpDir, "Child 2");
		const planId = await createPlan(tmpDir, parent);
		await run(["plan", "adopt", planId, c1, c2], tmpDir);
		return { planId, c1, c2 };
	}

	test("--at inserts at a 1-based position", async () => {
		const { planId, c1, c2 } = await setup();
		const mid = await createSeed(tmpDir, "Inserted");
		const { exitCode } = await run(["plan", "adopt", planId, mid, "--at", "2"], tmpDir);
		expect(exitCode).toBe(0);
		expect((await readPlans(tmpDir)).find((p) => p.id === planId)?.children).toEqual([c1, mid, c2]);
	});

	test("--before inserts before the anchor child", async () => {
		const { planId, c1, c2 } = await setup();
		const x = await createSeed(tmpDir, "Before c2");
		await run(["plan", "adopt", planId, x, "--before", c2], tmpDir);
		expect((await readPlans(tmpDir)).find((p) => p.id === planId)?.children).toEqual([c1, x, c2]);
	});

	test("--after inserts after the anchor child", async () => {
		const { planId, c1, c2 } = await setup();
		const x = await createSeed(tmpDir, "After c1");
		await run(["plan", "adopt", planId, x, "--after", c1], tmpDir);
		expect((await readPlans(tmpDir)).find((p) => p.id === planId)?.children).toEqual([c1, x, c2]);
	});

	test("preserves command-line order for a batch insert", async () => {
		const { planId, c1, c2 } = await setup();
		const x = await createSeed(tmpDir, "X");
		const y = await createSeed(tmpDir, "Y");
		await run(["plan", "adopt", planId, x, y, "--at", "1"], tmpDir);
		expect((await readPlans(tmpDir)).find((p) => p.id === planId)?.children).toEqual([
			x,
			y,
			c1,
			c2,
		]);
	});

	test("rejects combining --at, --before, --after", async () => {
		const { planId, c1 } = await setup();
		const x = await createSeed(tmpDir, "X");
		const { exitCode, stderr } = await run(
			["plan", "adopt", planId, x, "--at", "1", "--before", c1],
			tmpDir,
		);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("mutually exclusive");
	});

	test("rejects --at out of range", async () => {
		const { planId } = await setup();
		const x = await createSeed(tmpDir, "X");
		const { exitCode, stderr } = await run(["plan", "adopt", planId, x, "--at", "9"], tmpDir);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("out of range");
	});

	test("rejects --before with an anchor that is not a child", async () => {
		const { planId } = await setup();
		const x = await createSeed(tmpDir, "X");
		const stranger = await createSeed(tmpDir, "Stranger");
		const { exitCode, stderr } = await run(
			["plan", "adopt", planId, x, "--before", stranger],
			tmpDir,
		);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("not a child");
	});
});

describe("sd plan reorder", () => {
	async function setup(): Promise<{ planId: string; c1: string; c2: string; c3: string }> {
		const parent = await createSeed(tmpDir, "Parent");
		const c1 = await createSeed(tmpDir, "C1");
		const c2 = await createSeed(tmpDir, "C2");
		const c3 = await createSeed(tmpDir, "C3");
		const planId = await createPlan(tmpDir, parent);
		await run(["plan", "adopt", planId, c1, c2, c3], tmpDir);
		return { planId, c1, c2, c3 };
	}

	test("sets the exact order and bumps revision", async () => {
		const { planId, c1, c2, c3 } = await setup();
		const before = (await readPlans(tmpDir)).find((p) => p.id === planId)?.revision ?? 0;
		const { exitCode, stdout } = await run(
			["plan", "reorder", planId, c3, c1, c2, "--json"],
			tmpDir,
		);
		expect(exitCode).toBe(0);
		const out = JSON.parse(stdout) as { children: string[]; revision: number };
		expect(out.children).toEqual([c3, c1, c2]);
		expect(out.revision).toBe(before + 1);
		expect((await readPlans(tmpDir)).find((p) => p.id === planId)?.children).toEqual([c3, c1, c2]);
	});

	test("accepts a seed id and resolves to its plan", async () => {
		const { planId, c1, c2, c3 } = await setup();
		const parent = (await readPlans(tmpDir)).find((p) => p.id === planId)?.seed;
		expect(parent).toBeDefined();
		const { exitCode } = await run(["plan", "reorder", parent as string, c2, c3, c1], tmpDir);
		expect(exitCode).toBe(0);
		expect((await readPlans(tmpDir)).find((p) => p.id === planId)?.children).toEqual([c2, c3, c1]);
	});

	test("rejects an id that is not a child", async () => {
		const { planId, c1, c2, c3 } = await setup();
		const stranger = await createSeed(tmpDir, "Stranger");
		const { exitCode, stderr } = await run(
			["plan", "reorder", planId, c1, c2, c3, stranger],
			tmpDir,
		);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("not");
	});

	test("rejects a permutation that drops a child", async () => {
		const { planId, c1, c2 } = await setup();
		const { exitCode, stderr } = await run(["plan", "reorder", planId, c1, c2], tmpDir);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("missing");
	});

	test("rejects duplicate ids", async () => {
		const { planId, c1, c2 } = await setup();
		const { exitCode, stderr } = await run(["plan", "reorder", planId, c1, c1, c2], tmpDir);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("Duplicate");
	});

	test("errors on an unknown plan", async () => {
		const { exitCode, stderr } = await run(["plan", "reorder", "pl-9999", "test-0001"], tmpDir);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("Plan not found");
	});
});
