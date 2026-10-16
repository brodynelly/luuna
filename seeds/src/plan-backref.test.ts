import { describe, expect, test } from "bun:test";
import {
	applyPlanBackref,
	BACKREF_END,
	BACKREF_START,
	buildPlanBackref,
	stripPlanBackref,
} from "./plan-backref.ts";

describe("buildPlanBackref", () => {
	test("includes step index, plan id, parent seed id+title, template, approach excerpt, and link", () => {
		const out = buildPlanBackref({
			stepIndex: 1,
			planId: "pl-9d0f",
			parentSeedId: "seeds-7c84",
			parentSeedTitle: "Add OAuth2 device-flow authentication",
			templateName: "feature",
			approach: "Hardcoded TS template + AJV schema, mirroring mulch's custom_types.",
		});
		expect(out).toContain(BACKREF_START);
		expect(out).toContain(BACKREF_END);
		expect(out).toContain("Step 2 of plan pl-9d0f.");
		expect(out).toContain("Parent seed: seeds-7c84 — Add OAuth2 device-flow authentication");
		expect(out).toContain("Plan template: feature");
		expect(out).toContain("Plan approach: Hardcoded TS template + AJV schema");
		expect(out).toContain("Run `sd plan show pl-9d0f` for the full plan");
	});

	test("step index is 1-based in the rendered text", () => {
		const out = buildPlanBackref({
			stepIndex: 0,
			planId: "pl-aaaa",
			parentSeedId: "p-1",
			parentSeedTitle: "t",
			templateName: "feature",
			approach: "x",
		});
		expect(out).toContain("Step 1 of plan pl-aaaa.");
	});

	test("approach is truncated with an ellipsis when very long", () => {
		const long = "word ".repeat(200).trim();
		const out = buildPlanBackref({
			stepIndex: 0,
			planId: "pl-1",
			parentSeedId: "p-1",
			parentSeedTitle: "t",
			templateName: "feature",
			approach: long,
		});
		const approachLine = out.split("\n").find((l) => l.startsWith("Plan approach: "));
		expect(approachLine).toBeDefined();
		if (!approachLine) return;
		expect(approachLine.endsWith("…")).toBe(true);
		expect(approachLine.length).toBeLessThan(long.length + "Plan approach: ".length);
	});

	test("multi-line approach is collapsed into a single line", () => {
		const out = buildPlanBackref({
			stepIndex: 0,
			planId: "pl-1",
			parentSeedId: "p-1",
			parentSeedTitle: "t",
			templateName: "feature",
			approach: "first line\n\nsecond line\n  third",
		});
		expect(out).toContain("Plan approach: first line second line third");
	});

	test("non-string or empty approach omits the approach line", () => {
		const out = buildPlanBackref({
			stepIndex: 0,
			planId: "pl-1",
			parentSeedId: "p-1",
			parentSeedTitle: "t",
			templateName: "feature",
			approach: undefined,
		});
		expect(out).not.toContain("Plan approach:");
	});
});

describe("applyPlanBackref", () => {
	const args = {
		stepIndex: 0,
		planId: "pl-1",
		parentSeedId: "p-1",
		parentSeedTitle: "t",
		templateName: "feature",
		approach: "approach v1",
	};

	test("returns the backref block when prior description is empty", () => {
		const out = applyPlanBackref(undefined, args);
		expect(out).toContain("Plan approach: approach v1");
		expect(out.startsWith(BACKREF_START)).toBe(true);
		expect(out.endsWith(BACKREF_END)).toBe(true);
	});

	test("replaces existing marker section in place", () => {
		const first = applyPlanBackref(undefined, args);
		const second = applyPlanBackref(first, { ...args, approach: "approach v2" });
		expect(second).toContain("Plan approach: approach v2");
		expect(second).not.toContain("Plan approach: approach v1");
		// Only one marker section after refresh.
		const startCount = second.split(BACKREF_START).length - 1;
		expect(startCount).toBe(1);
	});

	test("prepends a marker section when prior description has none, preserving manual notes", () => {
		const manual = "Hand-written notes from the implementer.";
		const out = applyPlanBackref(manual, args);
		expect(out.startsWith(BACKREF_START)).toBe(true);
		expect(out).toContain(manual);
	});

	test("preserves trailing manual notes across a refresh", () => {
		const manual = "Hand-written notes from the implementer.";
		const first = applyPlanBackref(manual, args);
		const second = applyPlanBackref(first, { ...args, approach: "approach v2" });
		expect(second).toContain("Plan approach: approach v2");
		expect(second).toContain(manual);
	});
});

describe("stripPlanBackref", () => {
	const args = {
		stepIndex: 0,
		planId: "pl-1",
		parentSeedId: "p-1",
		parentSeedTitle: "t",
		templateName: "feature",
		approach: "approach v1",
	};

	test("returns undefined input unchanged", () => {
		expect(stripPlanBackref(undefined)).toBeUndefined();
	});

	test("returns description unchanged when no backref markers are present", () => {
		const manual = "Hand-written notes only.";
		expect(stripPlanBackref(manual)).toBe(manual);
	});

	test("returns undefined when only the backref block was present", () => {
		const only = applyPlanBackref(undefined, args);
		expect(stripPlanBackref(only)).toBeUndefined();
	});

	test("preserves manual notes after the backref block", () => {
		const manual = "Hand-written notes from the implementer.";
		const combined = applyPlanBackref(manual, args);
		const stripped = stripPlanBackref(combined);
		expect(stripped).toBe(manual);
		expect(stripped).not.toContain(BACKREF_START);
		expect(stripped).not.toContain(BACKREF_END);
	});

	test("preserves manual notes before the backref block", () => {
		const manual = "Hand-written notes from the implementer.";
		const block = buildPlanBackref(args);
		const combined = `${manual}\n\n${block}`;
		expect(stripPlanBackref(combined)).toBe(manual);
	});

	test("collapses surrounding whitespace when the block sits between notes", () => {
		const block = buildPlanBackref(args);
		const combined = `Before notes.\n\n${block}\n\nAfter notes.`;
		expect(stripPlanBackref(combined)).toBe("Before notes.\n\nAfter notes.");
	});
});
