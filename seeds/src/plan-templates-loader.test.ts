import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	BUILTIN_BUG_TEMPLATE,
	BUILTIN_FEATURE_TEMPLATE,
	BUILTIN_REFACTOR_TEMPLATE,
	loadPlanTemplates,
} from "./config.ts";

let dir: string;
let seedsDir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "seeds-tpl-"));
	seedsDir = join(dir, ".seeds");
	mkdirSync(seedsDir, { recursive: true });
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

function writeConfig(yaml: string): void {
	writeFileSync(join(seedsDir, "config.yaml"), yaml);
}

describe("loadPlanTemplates — built-in fallback", () => {
	test("returns all built-ins when no plan_templates block exists", async () => {
		writeConfig('project: test\nversion: "1"\n');
		const templates = await loadPlanTemplates(seedsDir);
		expect(Object.keys(templates).sort()).toEqual(["bug", "feature", "refactor"]);
		expect(templates.feature).toEqual(BUILTIN_FEATURE_TEMPLATE);
		expect(templates.bug).toEqual(BUILTIN_BUG_TEMPLATE);
		expect(templates.refactor).toEqual(BUILTIN_REFACTOR_TEMPLATE);
	});

	test("returns built-ins when config.yaml is missing", async () => {
		const templates = await loadPlanTemplates(seedsDir);
		expect(templates.feature).toEqual(BUILTIN_FEATURE_TEMPLATE);
		expect(templates.bug).toEqual(BUILTIN_BUG_TEMPLATE);
		expect(templates.refactor).toEqual(BUILTIN_REFACTOR_TEMPLATE);
	});
});

describe("loadPlanTemplates — user templates", () => {
	test("user-declared bug template overrides the built-in", async () => {
		writeConfig(
			[
				"plan_templates:",
				"  bug:",
				"    sections:",
				"      title:",
				"        required: true",
				"        kind: text",
				'        prompt: "One-liner"',
				"      steps:",
				"        required: true",
				"        kind: steps",
				"        min: 1",
				'        prompt: "Steps."',
			].join("\n"),
		);
		const templates = await loadPlanTemplates(seedsDir);
		const bug = templates.bug;
		expect(bug?.sections.title).toBeDefined();
		// Built-in bug-specific sections are gone — full override semantics.
		expect(bug?.sections.reproduction).toBeUndefined();
		expect(bug?.sections.root_cause).toBeUndefined();
	});

	test("user-declared refactor template overrides the built-in", async () => {
		writeConfig(
			[
				"plan_templates:",
				"  refactor:",
				"    sections:",
				"      goal:",
				"        required: true",
				"        kind: text",
				'        prompt: "Goal"',
				"      steps:",
				"        required: true",
				"        kind: steps",
				"        min: 1",
				'        prompt: "Steps."',
			].join("\n"),
		);
		const templates = await loadPlanTemplates(seedsDir);
		expect(templates.refactor?.sections.goal).toBeDefined();
		expect(templates.refactor?.sections.behavior_invariant).toBeUndefined();
	});

	test("loads a custom spike template alongside built-in feature", async () => {
		writeConfig(
			[
				"project: test",
				'version: "1"',
				"",
				"plan_templates:",
				"  spike:",
				"    sections:",
				"      hypothesis:",
				"        required: true",
				"        kind: text",
				'        prompt: "What are we trying to learn?"',
				"      timebox:",
				"        required: true",
				"        kind: text",
				'        prompt: "Hard upper bound."',
				"      success_signal:",
				"        required: true",
				"        kind: list",
				"        item: text",
				'        prompt: "Observable signals of success?"',
				"      kill_signal:",
				"        required: true",
				"        kind: list",
				"        item: text",
				'        prompt: "Signals to abandon?"',
				"      steps:",
				"        required: false",
				"        kind: steps",
				'        prompt: "Optional follow-up tasks."',
			].join("\n"),
		);
		const templates = await loadPlanTemplates(seedsDir);
		expect(Object.keys(templates).sort()).toEqual(["bug", "feature", "refactor", "spike"]);
		const spike = templates.spike;
		expect(spike?.name).toBe("spike");
		expect(spike?.sections.hypothesis).toEqual({
			required: true,
			kind: "text",
			prompt: "What are we trying to learn?",
		});
		expect(spike?.sections.success_signal).toEqual({
			required: true,
			kind: "list",
			item: "text",
			prompt: "Observable signals of success?",
		});
		expect(spike?.sections.steps).toEqual({
			required: false,
			kind: "steps",
			prompt: "Optional follow-up tasks.",
		});
	});

	test("user-declared feature template overrides the built-in", async () => {
		writeConfig(
			[
				"plan_templates:",
				"  feature:",
				"    sections:",
				"      tldr:",
				"        required: true",
				"        kind: text",
				"        min_length: 10",
				'        prompt: "One-liner."',
				"      steps:",
				"        required: true",
				"        kind: steps",
				"        min: 1",
				'        prompt: "Steps."',
			].join("\n"),
		);
		const templates = await loadPlanTemplates(seedsDir);
		const feature = templates.feature;
		expect(feature?.sections.tldr).toEqual({
			required: true,
			kind: "text",
			min_length: 10,
			prompt: "One-liner.",
		});
		// Built-in sections are gone — full override semantics.
		expect(feature?.sections.context).toBeUndefined();
		expect(feature?.sections.acceptance).toBeUndefined();
	});

	test("loads object-spec list items (alternatives shape)", async () => {
		writeConfig(
			[
				"plan_templates:",
				"  feature:",
				"    sections:",
				"      alternatives:",
				"        required: false",
				"        kind: list",
				"        item:",
				"          name:",
				"            required: true",
				"            kind: text",
				'            prompt: ""',
				"          rejected_because:",
				"            required: true",
				"            kind: text",
				'            prompt: ""',
				'        prompt: "Alternatives considered."',
			].join("\n"),
		);
		const templates = await loadPlanTemplates(seedsDir);
		const item = templates.feature?.sections.alternatives?.item;
		expect(item).toEqual({
			name: { required: true, kind: "text", prompt: "" },
			rejected_because: { required: true, kind: "text", prompt: "" },
		});
	});
});

describe("loadPlanTemplates — validation errors", () => {
	test("rejects unknown kind values", async () => {
		writeConfig(
			[
				"plan_templates:",
				"  bad:",
				"    sections:",
				"      something:",
				"        required: true",
				"        kind: paragraph",
				'        prompt: "x"',
			].join("\n"),
		);
		await expect(loadPlanTemplates(seedsDir)).rejects.toThrow(
			/plan_templates\.bad\.sections\.something\.kind: unknown kind 'paragraph'/,
		);
	});

	test("rejects missing required field", async () => {
		writeConfig(
			[
				"plan_templates:",
				"  bad:",
				"    sections:",
				"      a:",
				"        kind: text",
				'        prompt: "x"',
			].join("\n"),
		);
		await expect(loadPlanTemplates(seedsDir)).rejects.toThrow(/required: must be a boolean/);
	});

	test("rejects missing prompt", async () => {
		writeConfig(
			[
				"plan_templates:",
				"  bad:",
				"    sections:",
				"      a:",
				"        required: true",
				"        kind: text",
			].join("\n"),
		);
		await expect(loadPlanTemplates(seedsDir)).rejects.toThrow(/prompt: must be a string/);
	});

	test("rejects malformed item", async () => {
		writeConfig(
			[
				"plan_templates:",
				"  bad:",
				"    sections:",
				"      a:",
				"        required: true",
				"        kind: list",
				"        item: number",
				'        prompt: "x"',
			].join("\n"),
		);
		await expect(loadPlanTemplates(seedsDir)).rejects.toThrow(/must be 'text' or an object spec/);
	});
});
