import { describe, expect, test } from "bun:test";
import { runCli } from "../test-harness.ts";

describe("Luuna Missions unpublished distribution", () => {
	for (const check of [[], ["--check"]]) {
		test(`refuses registry upgrade ${check.join(" ")}`, async () => {
			const { exitCode, stdout } = await runCli(["upgrade", ...check, "--json"], process.cwd());
			expect(exitCode).toBe(1);
			const payload = JSON.parse(stdout);
			expect(payload.success).toBe(false);
			expect(payload.updated).toBe(false);
			expect(payload.error).toContain("not published");
		});
	}
});
