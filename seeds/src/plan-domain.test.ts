import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inferDomain } from "./plan-domain.ts";
import type { Issue } from "./types.ts";

// Each test gets a fresh tmpdir + bin/ on PATH containing a fake `ml` script
// whose behavior is controlled per-test. This isolates the helper from any
// real mulch install on the developer's machine.

let tmpDir: string;
let binDir: string;
let originalPath: string | undefined;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "seeds-plan-domain-"));
	binDir = join(tmpDir, "bin");
	await mkdir(binDir, { recursive: true });
	originalPath = process.env.PATH;
	process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
});

afterEach(async () => {
	if (originalPath !== undefined) process.env.PATH = originalPath;
	else delete process.env.PATH;
	await rm(tmpDir, { recursive: true, force: true });
});

async function writeFakeMl(opts: { statusJson?: unknown; statusExit?: number }): Promise<void> {
	const json = opts.statusJson === undefined ? "" : JSON.stringify(opts.statusJson);
	const exit = opts.statusExit ?? 0;
	// The fake handles `--json status` (the only call inferDomain makes).
	const body = `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  "--json status")
    cat <<'EOF'
${json}
EOF
    exit ${exit}
    ;;
esac
echo "fake ml: unsupported args: $*" >&2
exit 99
`;
	const scriptPath = join(binDir, "ml");
	await writeFile(scriptPath, body);
	await chmod(scriptPath, 0o755);
}

function makeSeed(overrides: Partial<Issue> = {}): Issue {
	return {
		id: "seeds-test",
		title: "Test seed",
		status: "open",
		type: "task",
		priority: 2,
		createdAt: "2026-05-06T00:00:00Z",
		updatedAt: "2026-05-06T00:00:00Z",
		...overrides,
	};
}

describe("inferDomain", () => {
	test("returns explicit domain without spawning ml", async () => {
		// No fake ml on PATH — confirms no shell-out happens.
		process.env.PATH = "/nonexistent-bin-only";
		const result = inferDomain({
			seed: makeSeed(),
			explicitDomain: "commands",
			cwd: tmpDir,
		});
		expect(result.domain).toBe("commands");
		expect(result.source).toBe("explicit");
	});

	test("returns null when ml is not on PATH", () => {
		process.env.PATH = "/nonexistent-bin-only";
		const result = inferDomain({ seed: makeSeed({ labels: ["commands"] }), cwd: tmpDir });
		expect(result.domain).toBeNull();
		expect(result.source).toBe("none");
	});

	test("returns null when ml status exits non-zero", async () => {
		await writeFakeMl({ statusJson: {}, statusExit: 1 });
		const result = inferDomain({ seed: makeSeed({ labels: ["commands"] }), cwd: tmpDir });
		expect(result.domain).toBeNull();
		expect(result.source).toBe("none");
	});

	test("returns null when ml status emits unparseable output", async () => {
		await writeFakeMl({ statusJson: undefined });
		const result = inferDomain({ seed: makeSeed({ labels: ["commands"] }), cwd: tmpDir });
		expect(result.domain).toBeNull();
		expect(result.source).toBe("none");
	});

	test("returns matching domain from seed labels", async () => {
		await writeFakeMl({
			statusJson: {
				success: true,
				command: "status",
				domains: [{ domain: "docs" }, { domain: "commands" }, { domain: "agents" }],
			},
		});
		const seed = makeSeed({ labels: ["unrelated", "commands"] });
		const result = inferDomain({ seed, cwd: tmpDir });
		expect(result.domain).toBe("commands");
		expect(result.source).toBe("labels");
	});

	test("ignores labels that do not match any domain", async () => {
		await writeFakeMl({
			statusJson: {
				domains: [{ domain: "commands" }, { domain: "docs" }],
			},
		});
		const seed = makeSeed({ labels: ["plan", "phase-3"] });
		const result = inferDomain({ seed, cwd: tmpDir });
		expect(result.domain).toBeNull();
		expect(result.source).toBe("none");
	});

	test("falls back to file anchors from description path-tokens", async () => {
		await writeFakeMl({
			statusJson: {
				domains: [{ domain: "commands" }, { domain: "docs" }],
			},
		});
		const seed = makeSeed({
			description: "Touches src/commands/plan.ts and PLAN_SPEC.md.",
		});
		const result = inferDomain({ seed, cwd: tmpDir });
		expect(result.domain).toBe("commands");
		expect(result.source).toBe("files");
	});

	test("returns null when description has no domain-matching path", async () => {
		await writeFakeMl({
			statusJson: { domains: [{ domain: "docs" }] },
		});
		const seed = makeSeed({ description: "Touches src/types.ts only." });
		const result = inferDomain({ seed, cwd: tmpDir });
		expect(result.domain).toBeNull();
		expect(result.source).toBe("none");
	});

	test("explicit domain wins over labels and description", async () => {
		await writeFakeMl({
			statusJson: {
				domains: [{ domain: "commands" }, { domain: "docs" }],
			},
		});
		const seed = makeSeed({
			labels: ["commands"],
			description: "src/commands/plan.ts",
		});
		const result = inferDomain({ seed, explicitDomain: "explicit-only", cwd: tmpDir });
		expect(result.domain).toBe("explicit-only");
		expect(result.source).toBe("explicit");
	});

	test("labels win over description when both match", async () => {
		await writeFakeMl({
			statusJson: {
				domains: [{ domain: "commands" }, { domain: "docs" }],
			},
		});
		const seed = makeSeed({
			labels: ["docs"],
			description: "src/commands/plan.ts",
		});
		const result = inferDomain({ seed, cwd: tmpDir });
		expect(result.domain).toBe("docs");
		expect(result.source).toBe("labels");
	});

	test("handles empty domains array gracefully", async () => {
		await writeFakeMl({
			statusJson: { success: true, command: "status", domains: [] },
		});
		const seed = makeSeed({ labels: ["commands"] });
		const result = inferDomain({ seed, cwd: tmpDir });
		expect(result.domain).toBeNull();
		expect(result.source).toBe("none");
	});

	test("malformed domains entries are skipped, not throwing", async () => {
		await writeFakeMl({
			statusJson: {
				domains: ["bare-string", { name: "wrong-key" }, { domain: 42 }, { domain: "commands" }],
			},
		});
		const seed = makeSeed({ labels: ["commands"] });
		const result = inferDomain({ seed, cwd: tmpDir });
		expect(result.domain).toBe("commands");
		expect(result.source).toBe("labels");
	});
});
