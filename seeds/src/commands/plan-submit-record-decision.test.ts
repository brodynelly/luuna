import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../../src/index.ts");

let tmpDir: string;
let binDir: string;
let invocationLog: string;
let originalPath: string | undefined;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "seeds-record-decision-"));
	binDir = join(tmpDir, "bin");
	await mkdir(binDir, { recursive: true });
	invocationLog = join(tmpDir, "ml-invocations.log");
	originalPath = process.env.PATH;
	process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
	await runSd(["init"], tmpDir);
});

afterEach(async () => {
	if (originalPath !== undefined) process.env.PATH = originalPath;
	else delete process.env.PATH;
	await rm(tmpDir, { recursive: true, force: true });
});

async function runSd(
	args: string[],
	cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(["bun", "run", CLI, ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		// Children inherit process.env.PATH which includes our fake-ml bin/.
		env: { ...process.env },
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

async function writeFakeMl(opts: {
	recordExit?: number;
	statusJson?: unknown;
	recordJson?: unknown;
}): Promise<void> {
	const recordExit = opts.recordExit ?? 0;
	// Default ml status response: declares one domain "commands" so domain
	// inference can match a label-bearing seed.
	const statusJson =
		opts.statusJson === undefined
			? {
					success: true,
					command: "status",
					domains: [{ domain: "commands" }, { domain: "docs" }],
				}
			: opts.statusJson;
	const statusJsonStr = JSON.stringify(statusJson);
	// recordJson stub: when set, the fake emits this on `record` so the parent
	// process can parse a mulch id from stdout. Default empty mirrors older
	// mulch CLIs that didn't accept --json on record.
	const recordJsonStr = opts.recordJson === undefined ? "" : JSON.stringify(opts.recordJson);
	const body = `#!/usr/bin/env bun
const fs = require("node:fs");
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify(argv) + "\\n");
const isStatus = argv[0] === "--json" && argv[1] === "status";
if (isStatus) {
	process.stdout.write(${JSON.stringify(statusJsonStr)});
	process.exit(0);
}
if (argv[0] === "record") {
	if (${JSON.stringify(recordJsonStr)}.length > 0) {
		process.stdout.write(${JSON.stringify(recordJsonStr)});
	}
	process.exit(${recordExit});
}
process.exit(0);
`;
	const scriptPath = join(binDir, "ml");
	await writeFile(scriptPath, body);
	await chmod(scriptPath, 0o755);
}

async function readInvocations(): Promise<string[][]> {
	try {
		const raw = await readFile(invocationLog, "utf8");
		return raw
			.split("\n")
			.filter((l) => l.length > 0)
			.map((l) => JSON.parse(l) as string[]);
	} catch {
		return [];
	}
}

async function createSeedWithLabel(cwd: string, title: string, label: string): Promise<string> {
	const create = await runSd(["create", "--title", title, "--type", "task", "--json"], cwd);
	const id = (JSON.parse(create.stdout) as { id: string }).id;
	await runSd(["label", "add", id, label], cwd);
	return id;
}

const VALID_CONTEXT =
	"This work matters because we need to enable structured planning for AI agents using seeds.";

function validPlan(approach: string): unknown {
	return {
		template: "feature",
		sections: {
			context: VALID_CONTEXT,
			approach,
			alternatives: [],
			steps: [
				{ title: "Step A", type: "task", priority: 2, blocks: [] },
				{ title: "Step B", type: "task", priority: 2, blocks: [] },
			],
			risks: [],
			acceptance: ["Done"],
		},
	};
}

async function writePlan(cwd: string, plan: unknown): Promise<string> {
	const path = join(cwd, "plan.json");
	await writeFile(path, JSON.stringify(plan));
	return path;
}

describe("sd plan submit --record-decision", () => {
	test("invokes ml record with documented args when ml + domain available", async () => {
		await writeFakeMl({});
		const seedId = await createSeedWithLabel(tmpDir, "Add OAuth login", "commands");
		const planPath = await writePlan(tmpDir, validPlan("Use OAuth library"));

		const res = await runSd(
			["plan", "submit", seedId, "--plan", planPath, "--record-decision", "--json"],
			tmpDir,
		);
		expect(res.exitCode).toBe(0);
		const out = JSON.parse(res.stdout) as { success: boolean; plan_id: string };
		expect(out.success).toBe(true);

		const calls = await readInvocations();
		const recordCalls = calls.filter((c) => c[0] === "record");
		expect(recordCalls.length).toBe(1);
		const args = recordCalls[0];
		if (!args) throw new Error("missing record invocation");
		expect(args[0]).toBe("record");
		expect(args[1]).toBe("commands"); // inferred from label
		// flag/value pairs should include the documented set
		const idx = (flag: string): number => args.indexOf(flag);
		expect(args[idx("--type") + 1]).toBe("decision");
		expect(args[idx("--rationale") + 1]).toBe("Use OAuth library");
		expect(args[idx("--evidence-seeds") + 1]).toBe(out.plan_id);
		// --title must be present (mulch requires it for decision records).
		expect(idx("--title")).toBeGreaterThanOrEqual(0);
		// --json is appended so we can parse the recorded mulch id from stdout.
		expect(idx("--json")).toBeGreaterThanOrEqual(0);
	});

	test("success with parseable mulch id surfaces the id on stdout (human mode)", async () => {
		await writeFakeMl({
			recordJson: { success: true, command: "record", record: { id: "mx-abc123" } },
		});
		const seedId = await createSeedWithLabel(tmpDir, "Add SSO", "commands");
		const planPath = await writePlan(tmpDir, validPlan("SSO via SAML"));

		const res = await runSd(
			["plan", "submit", seedId, "--plan", planPath, "--record-decision"],
			tmpDir,
		);
		expect(res.exitCode).toBe(0);
		expect(res.stdout).toContain("recorded mulch decision");
		expect(res.stdout).toContain("mx-abc123");
		// No warning on the success path.
		expect(res.stderr).not.toContain("⚠ --record-decision");
	});

	test("--json suppresses the human mulch confirmation line on stdout", async () => {
		await writeFakeMl({
			recordJson: { success: true, command: "record", record: { id: "mx-deadbe" } },
		});
		const seedId = await createSeedWithLabel(tmpDir, "JSON SSO", "commands");
		const planPath = await writePlan(tmpDir, validPlan("SSO via SAML"));

		const res = await runSd(
			["plan", "submit", seedId, "--plan", planPath, "--record-decision", "--json"],
			tmpDir,
		);
		expect(res.exitCode).toBe(0);
		// JSON consumers must get parseable JSON only — no human lines.
		const parsed = JSON.parse(res.stdout) as { success: boolean };
		expect(parsed.success).toBe(true);
		expect(res.stdout).not.toContain("recorded mulch decision");
	});

	test("ml record exits non-zero -> submit succeeds, plan written, stderr warns", async () => {
		await writeFakeMl({ recordExit: 7 });
		const seedId = await createSeedWithLabel(tmpDir, "Bad-record case", "commands");
		const planPath = await writePlan(tmpDir, validPlan("OAuth approach"));

		const res = await runSd(
			["plan", "submit", seedId, "--plan", planPath, "--record-decision", "--json"],
			tmpDir,
		);
		expect(res.exitCode).toBe(0);
		expect(res.stderr).toContain("--record-decision");
		expect(res.stderr.toLowerCase()).toContain("ml record failed");

		// Plan row was still persisted atomically.
		const plansFile = join(tmpDir, ".seeds", "plans.jsonl");
		const raw = await readFile(plansFile, "utf8");
		const lines = raw.split("\n").filter((l) => l.length > 0);
		expect(lines.length).toBe(1);
		const plan = JSON.parse(lines[0] ?? "{}") as { id: string; status: string; seed: string };
		expect(plan.seed).toBe(seedId);
		expect(plan.status).toBe("approved");
	});

	test("ml absent -> submit succeeds with stderr warning", async () => {
		const seedId = await createSeedWithLabel(tmpDir, "No ml available", "commands");
		const planPath = await writePlan(tmpDir, validPlan("Some approach"));

		// Invoke bun by absolute path so we can set PATH to an empty dir — the
		// child process's Bun.which("ml") then has no chance of finding ml on
		// the developer's host machine.
		const proc = Bun.spawn(
			[
				process.execPath,
				"run",
				CLI,
				"plan",
				"submit",
				seedId,
				"--plan",
				planPath,
				"--record-decision",
				"--json",
			],
			{
				cwd: tmpDir,
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, PATH: binDir }, // binDir has no `ml` written
			},
		);
		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;

		expect(exitCode).toBe(0);
		expect(stderr).toContain("--record-decision");
		expect(stderr).toContain("ml not found");

		const out = JSON.parse(stdout) as { success: boolean };
		expect(out.success).toBe(true);
	});
});
