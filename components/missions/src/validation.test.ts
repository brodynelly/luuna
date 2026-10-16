import { describe, expect, test } from "bun:test";
import { compileSchema, formatErrors } from "./validation";

const planSchema = {
	type: "object",
	required: ["template", "sections"],
	properties: {
		template: { type: "string", minLength: 1 },
		sections: {
			type: "object",
			required: ["context", "steps"],
			properties: {
				context: { type: "string", minLength: 50 },
				risks: { type: "array", items: { type: "string" } },
				steps: { type: "array", items: { type: "object" }, minItems: 2 },
			},
		},
	},
} as const;

describe("compileSchema", () => {
	test("returns valid: true for a passing object", () => {
		const validate = compileSchema(planSchema);
		const result = validate({
			template: "feature",
			sections: {
				context: "x".repeat(60),
				steps: [{ title: "a" }, { title: "b" }],
			},
		});
		expect(result.valid).toBe(true);
	});

	test("missing required field surfaces with code=required and path includes the missing prop", () => {
		const validate = compileSchema(planSchema);
		const submitted = {
			template: "feature",
			sections: {
				context: "x".repeat(60),
				// steps omitted
			},
		};
		const result = validate(submitted);
		if (result.valid) throw new Error("expected invalid");
		const stepsErr = result.diff.errors.find((e) => e.path === "sections.steps");
		expect(stepsErr).toBeDefined();
		expect(stepsErr?.code).toBe("required");
		expect(stepsErr?.fix.length).toBeGreaterThan(0);
	});

	test("minLength failure surfaces with code=minLength", () => {
		const validate = compileSchema(planSchema);
		const result = validate({
			template: "feature",
			sections: {
				context: "too short",
				steps: [{ title: "a" }, { title: "b" }],
			},
		});
		if (result.valid) throw new Error("expected invalid");
		const ctxErr = result.diff.errors.find((e) => e.path === "sections.context");
		expect(ctxErr).toBeDefined();
		expect(ctxErr?.code).toBe("minLength");
		expect(ctxErr?.fix).toContain("50");
	});

	test("minItems normalizes to code=min and computes how many more entries are needed", () => {
		const validate = compileSchema(planSchema);
		const result = validate({
			template: "feature",
			sections: {
				context: "x".repeat(60),
				steps: [{ title: "a" }],
			},
		});
		if (result.valid) throw new Error("expected invalid");
		const stepsErr = result.diff.errors.find((e) => e.path === "sections.steps");
		expect(stepsErr).toBeDefined();
		expect(stepsErr?.code).toBe("min");
		expect(stepsErr?.fix).toBe("add at least 1 more entry");
	});

	test("submitted object round-trips into diff.current verbatim", () => {
		const validate = compileSchema(planSchema);
		const submitted = {
			template: "feature",
			sections: { context: "nope", steps: [] },
			extra: { nested: [1, 2, 3] },
		};
		const result = validate(submitted);
		if (result.valid) throw new Error("expected invalid");
		expect(result.diff.current).toEqual(submitted);
		// Reference identity is fine — we don't promise a clone, just a passthrough.
		expect(result.diff.current).toBe(submitted);
	});

	test("allErrors: true — multiple simultaneous errors all surface", () => {
		const validate = compileSchema(planSchema);
		const result = validate({
			template: "feature",
			sections: {
				context: "short",
				steps: [{ title: "a" }],
			},
		});
		if (result.valid) throw new Error("expected invalid");
		const codes = result.diff.errors.map((e) => e.code).sort();
		expect(codes).toContain("minLength");
		expect(codes).toContain("min");
	});

	test("every error has a non-empty fix string", () => {
		const validate = compileSchema(planSchema);
		const result = validate({});
		if (result.valid) throw new Error("expected invalid");
		expect(result.diff.errors.length).toBeGreaterThan(0);
		for (const e of result.diff.errors) {
			expect(typeof e.fix).toBe("string");
			expect(e.fix.length).toBeGreaterThan(0);
		}
	});

	test("type mismatch fix names the expected type", () => {
		const validate = compileSchema({
			type: "object",
			properties: { count: { type: "integer" } },
		});
		const result = validate({ count: "nope" });
		if (result.valid) throw new Error("expected invalid");
		const err = result.diff.errors.find((e) => e.path === "count");
		expect(err?.code).toBe("type");
		expect(err?.fix).toContain("integer");
	});
});

describe("formatErrors", () => {
	test("empty errors returns empty diff with current passthrough", () => {
		const submitted = { ok: true };
		const diff = formatErrors([], submitted);
		expect(diff.errors).toEqual([]);
		expect(diff.current).toBe(submitted);
	});

	test("required error path joins parent path and missingProperty", () => {
		const validate = compileSchema(planSchema);
		const result = validate({ template: "feature", sections: {} });
		if (result.valid) throw new Error("expected invalid");
		const paths = result.diff.errors.map((e) => e.path).sort();
		expect(paths).toContain("sections.context");
		expect(paths).toContain("sections.steps");
	});

	test("required at root puts the bare property name in path", () => {
		const validate = compileSchema(planSchema);
		const result = validate({});
		if (result.valid) throw new Error("expected invalid");
		const paths = result.diff.errors.map((e) => e.path);
		expect(paths).toContain("template");
		expect(paths).toContain("sections");
	});
});
