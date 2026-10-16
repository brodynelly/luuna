import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSeedsDir, isInsideWorktree } from "./config";

function git(args: string[], cwd: string): void {
	const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	if ((result.exitCode ?? 0) !== 0) {
		const stderr = new TextDecoder().decode(result.stderr);
		throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
	}
}

function initSeedsDir(root: string): void {
	const seedsDir = join(root, ".seeds");
	mkdirSync(seedsDir, { recursive: true });
	writeFileSync(join(seedsDir, "config.yaml"), 'project: "test"\nversion: "1"\n');
	writeFileSync(join(seedsDir, "issues.jsonl"), "");
}

let tmpDir: string;

beforeEach(async () => {
	tmpDir = realpathSync(await mkdtemp(join(tmpdir(), "seeds-config-test-")));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

describe("findSeedsDir — worktree resolution", () => {
	test("resolves to main root from a worktree", async () => {
		const mainRepo = join(tmpDir, "main");
		mkdirSync(mainRepo);
		git(["init"], mainRepo);
		git(["config", "user.email", "test@test.com"], mainRepo);
		git(["config", "user.name", "Test"], mainRepo);
		initSeedsDir(mainRepo);
		git(["add", "."], mainRepo);
		git(["commit", "-m", "init"], mainRepo);

		const wtDir = join(tmpDir, "wt");
		git(["worktree", "add", wtDir, "-b", "wt-branch"], mainRepo);

		// worktree also gets .seeds/ via the branch content
		const result = await findSeedsDir(wtDir);
		expect(result).toBe(join(mainRepo, ".seeds"));
	});

	test("falls back to worktree .seeds/ when main root has none", async () => {
		const mainRepo = join(tmpDir, "main");
		mkdirSync(mainRepo);
		git(["init"], mainRepo);
		git(["config", "user.email", "test@test.com"], mainRepo);
		git(["config", "user.name", "Test"], mainRepo);
		writeFileSync(join(mainRepo, "README.md"), "hello");
		git(["add", "."], mainRepo);
		git(["commit", "-m", "init"], mainRepo);

		const wtDir = join(tmpDir, "wt");
		git(["worktree", "add", wtDir, "-b", "wt-branch"], mainRepo);

		// Only init .seeds/ in worktree, NOT in main
		initSeedsDir(wtDir);

		const result = await findSeedsDir(wtDir);
		expect(result).toBe(join(wtDir, ".seeds"));
	});

	test("no-op when in main repo (not a worktree)", async () => {
		const mainRepo = join(tmpDir, "main");
		mkdirSync(mainRepo);
		git(["init"], mainRepo);
		initSeedsDir(mainRepo);

		const result = await findSeedsDir(mainRepo);
		expect(result).toBe(join(mainRepo, ".seeds"));
	});

	test("no-op when not in a git repo", async () => {
		const plainDir = join(tmpDir, "plain");
		mkdirSync(plainDir);
		initSeedsDir(plainDir);

		const result = await findSeedsDir(plainDir);
		expect(result).toBe(join(plainDir, ".seeds"));
	});
});

describe("isInsideWorktree", () => {
	test("returns true inside a worktree", () => {
		const mainRepo = join(tmpDir, "main");
		mkdirSync(mainRepo);
		git(["init"], mainRepo);
		git(["config", "user.email", "test@test.com"], mainRepo);
		git(["config", "user.name", "Test"], mainRepo);
		writeFileSync(join(mainRepo, "README.md"), "hello");
		git(["add", "."], mainRepo);
		git(["commit", "-m", "init"], mainRepo);

		const wtDir = join(tmpDir, "wt");
		git(["worktree", "add", wtDir, "-b", "wt-branch"], mainRepo);

		expect(isInsideWorktree(wtDir)).toBe(true);
	});

	test("returns false in main repo", () => {
		const mainRepo = join(tmpDir, "main");
		mkdirSync(mainRepo);
		git(["init"], mainRepo);

		expect(isInsideWorktree(mainRepo)).toBe(false);
	});

	test("returns false outside a git repo", () => {
		const plainDir = join(tmpDir, "plain");
		mkdirSync(plainDir);

		expect(isInsideWorktree(plainDir)).toBe(false);
	});

	test("returns false inside a git submodule (no false positive)", () => {
		// Set up parent repo
		const parentRepo = join(tmpDir, "parent");
		mkdirSync(parentRepo);
		git(["init"], parentRepo);
		git(["config", "user.email", "test@test.com"], parentRepo);
		git(["config", "user.name", "Test"], parentRepo);
		writeFileSync(join(parentRepo, "README.md"), "parent");
		git(["add", "."], parentRepo);
		git(["commit", "-m", "init parent"], parentRepo);

		// Set up sub repo (to be used as submodule)
		const subRepo = join(tmpDir, "sub");
		mkdirSync(subRepo);
		git(["init"], subRepo);
		git(["config", "user.email", "test@test.com"], subRepo);
		git(["config", "user.name", "Test"], subRepo);
		writeFileSync(join(subRepo, "README.md"), "sub");
		git(["add", "."], subRepo);
		git(["commit", "-m", "init sub"], subRepo);

		// Add sub as a submodule inside parent
		git(["-c", "protocol.file.allow=always", "submodule", "add", subRepo, "sub"], parentRepo);
		git(["commit", "-m", "add submodule"], parentRepo);

		const submoduleDir = join(parentRepo, "sub");
		expect(isInsideWorktree(submoduleDir)).toBe(false);
	});
});
