import { describe, expect, test } from "bun:test";
import { BUILTIN_FEATURE_TEMPLATE } from "./config.ts";
import { compilePlanTemplate, generatePlanSchema } from "./plan-schema.ts";
import type { PlanTemplate } from "./types.ts";

const SPIKE_TEMPLATE: PlanTemplate = {
	name: "spike",
	sections: {
		hypothesis: { required: true, kind: "text", prompt: "What are we trying to learn?" },
		timebox: { required: true, kind: "text", prompt: "Hard upper bound." },
		success_signal: {
			required: true,
			kind: "list",
			item: "text",
			prompt: "Observable signals?",
		},
		kill_signal: {
			required: true,
			kind: "list",
			item: "text",
			prompt: "Abandon signals?",
		},
		steps: { required: false, kind: "steps", prompt: "Optional follow-up tasks." },
	},
};

describe("generatePlanSchema — feature template (Phase 1 round-trip)", () => {
	test("produces a schema with the expected required sections", () => {
		const schema = generatePlanSchema(BUILTIN_FEATURE_TEMPLATE) as Record<string, unknown>;
		const sections = (schema.properties as Record<string, unknown>).sections as Record<
			string,
			unknown
		>;
		expect(sections.required).toEqual(["context", "approach", "steps", "acceptance"]);
	});

	test("validates a complete feature plan", () => {
		const validator = compilePlanTemplate(BUILTIN_FEATURE_TEMPLATE);
		const result = validator({
			template: "feature",
			sections: {
				context: "x".repeat(60),
				approach: "Pick the right tool",
				steps: [
					{ title: "step a", blocks: [2] },
					{ title: "step b", blocks: [] },
				],
				acceptance: ["it works"],
			},
		});
		expect(result.valid).toBe(true);
	});

	test("rejects too-short context (Phase 1 min_length: 50)", () => {
		const validator = compilePlanTemplate(BUILTIN_FEATURE_TEMPLATE);
		const result = validator({
			template: "feature",
			sections: {
				context: "tiny",
				approach: "pick",
				steps: [
					{ title: "a", blocks: [] },
					{ title: "b", blocks: [] },
				],
				acceptance: ["x"],
			},
		});
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.diff.errors.some((e) => e.path === "sections.context")).toBe(true);
	});

	test("rejects fewer than 2 steps (Phase 1 min: 2)", () => {
		const validator = compilePlanTemplate(BUILTIN_FEATURE_TEMPLATE);
		const result = validator({
			template: "feature",
			sections: {
				context: "x".repeat(60),
				approach: "pick",
				steps: [{ title: "only one", blocks: [] }],
				acceptance: ["x"],
			},
		});
		expect(result.valid).toBe(false);
		if (result.valid) return;
		const stepErr = result.diff.errors.find((e) => e.path === "sections.steps");
		expect(stepErr?.code).toBe("min");
	});

	test("rejects empty acceptance (Phase 1 min: 1)", () => {
		const validator = compilePlanTemplate(BUILTIN_FEATURE_TEMPLATE);
		const result = validator({
			template: "feature",
			sections: {
				context: "x".repeat(60),
				approach: "pick",
				steps: [
					{ title: "a", blocks: [] },
					{ title: "b", blocks: [] },
				],
				acceptance: [],
			},
		});
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.diff.errors.some((e) => e.path === "sections.acceptance")).toBe(true);
	});

	test("validates alternatives object items", () => {
		const validator = compilePlanTemplate(BUILTIN_FEATURE_TEMPLATE);
		const result = validator({
			template: "feature",
			sections: {
				context: "x".repeat(60),
				approach: "pick",
				alternatives: [
					{ name: "Alpha", rejected_because: "slow" },
					{ name: "Beta", rejected_because: "risky" },
				],
				steps: [
					{ title: "a", blocks: [] },
					{ title: "b", blocks: [] },
				],
				acceptance: ["ok"],
			},
		});
		expect(result.valid).toBe(true);
	});

	test("rejects alternative item missing rejected_because", () => {
		const validator = compilePlanTemplate(BUILTIN_FEATURE_TEMPLATE);
		const result = validator({
			template: "feature",
			sections: {
				context: "x".repeat(60),
				approach: "pick",
				alternatives: [{ name: "Alpha" }],
				steps: [
					{ title: "a", blocks: [] },
					{ title: "b", blocks: [] },
				],
				acceptance: ["ok"],
			},
		});
		expect(result.valid).toBe(false);
	});

	test("flags step.blocks self-reference", () => {
		const validator = compilePlanTemplate(BUILTIN_FEATURE_TEMPLATE);
		const result = validator({
			template: "feature",
			sections: {
				context: "x".repeat(60),
				approach: "pick",
				steps: [
					// step 1 listing 1 in its own blocks is a self-reference
					{ title: "a", blocks: [1] },
					{ title: "b", blocks: [] },
				],
				acceptance: ["ok"],
			},
		});
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.diff.errors.some((e) => e.code === "self-reference")).toBe(true);
	});

	test("rejects blocks: [0] with a 1-based out-of-range error (seeds-185f)", () => {
		const validator = compilePlanTemplate(BUILTIN_FEATURE_TEMPLATE);
		const result = validator({
			template: "feature",
			sections: {
				context: "x".repeat(60),
				approach: "pick",
				steps: [
					{ title: "a", blocks: [0] },
					{ title: "b", blocks: [] },
				],
				acceptance: ["ok"],
			},
		});
		expect(result.valid).toBe(false);
		if (result.valid) return;
		const err = result.diff.errors.find((e) => e.code === "out-of-range");
		expect(err).toBeDefined();
		expect(err?.fix).toContain("1-based");
	});

	test("accepts step with optional existing_seed (seeds-7002 / pl-43ff)", () => {
		const validator = compilePlanTemplate(BUILTIN_FEATURE_TEMPLATE);
		const result = validator({
			template: "feature",
			sections: {
				context: "x".repeat(60),
				approach: "pick",
				steps: [
					{ title: "adopt me", existing_seed: "seeds-1234", blocks: [] },
					{ title: "fresh spawn", blocks: [] },
				],
				acceptance: ["ok"],
			},
		});
		expect(result.valid).toBe(true);
	});

	test("rejects empty-string existing_seed", () => {
		const validator = compilePlanTemplate(BUILTIN_FEATURE_TEMPLATE);
		const result = validator({
			template: "feature",
			sections: {
				context: "x".repeat(60),
				approach: "pick",
				steps: [
					{ title: "a", existing_seed: "", blocks: [] },
					{ title: "b", blocks: [] },
				],
				acceptance: ["ok"],
			},
		});
		expect(result.valid).toBe(false);
	});

	test("rejects non-string existing_seed", () => {
		const validator = compilePlanTemplate(BUILTIN_FEATURE_TEMPLATE);
		const result = validator({
			template: "feature",
			sections: {
				context: "x".repeat(60),
				approach: "pick",
				steps: [
					{ title: "a", existing_seed: 42, blocks: [] },
					{ title: "b", blocks: [] },
				],
				acceptance: ["ok"],
			},
		});
		expect(result.valid).toBe(false);
	});

	test("flags step.blocks out-of-range", () => {
		const validator = compilePlanTemplate(BUILTIN_FEATURE_TEMPLATE);
		const result = validator({
			template: "feature",
			sections: {
				context: "x".repeat(60),
				approach: "pick",
				steps: [
					{ title: "a", blocks: [5] },
					{ title: "b", blocks: [] },
				],
				acceptance: ["ok"],
			},
		});
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.diff.errors.some((e) => e.code === "out-of-range")).toBe(true);
	});
});

describe("generatePlanSchema — custom spike template", () => {
	test("validates a spike plan", () => {
		const validator = compilePlanTemplate(SPIKE_TEMPLATE);
		const result = validator({
			template: "spike",
			sections: {
				hypothesis: "x",
				timebox: "1d",
				success_signal: ["faster"],
				kill_signal: ["slower"],
			},
		});
		expect(result.valid).toBe(true);
	});

	test("rejects spike plan missing required kill_signal", () => {
		const validator = compilePlanTemplate(SPIKE_TEMPLATE);
		const result = validator({
			template: "spike",
			sections: {
				hypothesis: "x",
				timebox: "1d",
				success_signal: ["faster"],
			},
		});
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.diff.errors.some((e) => e.path === "sections.kill_signal")).toBe(true);
	});

	test("rejects wrong template name", () => {
		const validator = compilePlanTemplate(SPIKE_TEMPLATE);
		const result = validator({ template: "feature", sections: {} });
		expect(result.valid).toBe(false);
	});
});

describe("generatePlanSchema — kind variations", () => {
	test("text section uses min_length default of 1 when unset", () => {
		const tpl: PlanTemplate = {
			name: "x",
			sections: { note: { required: true, kind: "text", prompt: "p" } },
		};
		const schema = generatePlanSchema(tpl) as Record<string, unknown>;
		const props = (
			(schema.properties as Record<string, unknown>).sections as Record<string, unknown>
		).properties as Record<string, unknown>;
		expect((props.note as Record<string, unknown>).minLength).toBe(1);
	});

	test("list section uses min default of 0 when unset", () => {
		const tpl: PlanTemplate = {
			name: "x",
			sections: { items: { required: false, kind: "list", item: "text", prompt: "p" } },
		};
		const schema = generatePlanSchema(tpl) as Record<string, unknown>;
		const props = (
			(schema.properties as Record<string, unknown>).sections as Record<string, unknown>
		).properties as Record<string, unknown>;
		expect((props.items as Record<string, unknown>).minItems).toBe(0);
	});

	test("nested object kind compiles into recursive object schema", () => {
		const tpl: PlanTemplate = {
			name: "x",
			sections: {
				meta: {
					required: true,
					kind: {
						owner: { required: true, kind: "text", prompt: "" },
						deadline: { required: false, kind: "text", prompt: "" },
					},
					prompt: "p",
				},
			},
		};
		const validator = compilePlanTemplate(tpl);
		expect(validator({ template: "x", sections: { meta: { owner: "alice" } } }).valid).toBe(true);
		expect(validator({ template: "x", sections: { meta: {} } }).valid).toBe(false);
	});

	test("template with no required sections produces no top-level required", () => {
		const tpl: PlanTemplate = {
			name: "x",
			sections: { note: { required: false, kind: "text", prompt: "p" } },
		};
		const schema = generatePlanSchema(tpl) as Record<string, unknown>;
		const sections = (schema.properties as Record<string, unknown>).sections as Record<
			string,
			unknown
		>;
		expect(sections.required).toBeUndefined();
	});
});
