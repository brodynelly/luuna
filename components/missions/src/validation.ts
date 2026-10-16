// AJV-based plan validation primitives.
//
// This is the ONLY module that imports `ajv`, keeping the runtime-dep boundary
// tight (CLAUDE.md "Dependencies"). All later `sd plan` commands (submit,
// validate) consume `compileSchema` and `formatErrors` from here.
//
// API choice: `compileSchema` returns a `ValidatorFn` that runs the formatter
// under the hood. `formatErrors` is also exported so callers that already hold
// raw AJV errors can render them without recompiling a schema.
//
// Code-name convention (PLAN_SPEC.md:180–195): AJV `keyword` maps 1:1 onto the
// spec `code`, EXCEPT `minItems` normalizes to `min` to match the spec's
// `sections.steps` example. `minLength` stays as-is.

import Ajv, { type ErrorObject } from "ajv";

export interface ErrorEntry {
	path: string;
	code: string;
	fix: string;
}

export interface PartialStateDiff {
	errors: ErrorEntry[];
	current: unknown;
}

export type ValidatorFn = (
	data: unknown,
) => { valid: true } | { valid: false; diff: PartialStateDiff };

export function compileSchema(schema: object): ValidatorFn {
	const ajv = new Ajv({ allErrors: true, strict: true });
	const validate = ajv.compile(schema);
	return (data) => {
		if (validate(data)) return { valid: true };
		return { valid: false, diff: formatErrors(validate.errors ?? [], data) };
	};
}

export function formatErrors(errs: ErrorObject[], submitted: unknown): PartialStateDiff {
	return {
		errors: errs.map((err) => toEntry(err, submitted)),
		current: submitted,
	};
}

function toEntry(err: ErrorObject, submitted: unknown): ErrorEntry {
	const path = pathFor(err);
	return {
		path,
		code: codeFor(err),
		fix: fixFor(err, path, submitted),
	};
}

function pathFor(err: ErrorObject): string {
	const base = err.instancePath.replace(/^\//, "").replace(/\//g, ".");
	if (err.keyword === "required") {
		const prop = (err.params as { missingProperty?: string }).missingProperty;
		if (prop) return base ? `${base}.${prop}` : prop;
	}
	return base;
}

function codeFor(err: ErrorObject): string {
	if (err.keyword === "minItems") return "min";
	return err.keyword;
}

function fixFor(err: ErrorObject, path: string, submitted: unknown): string {
	const params = err.params as Record<string, unknown>;
	switch (err.keyword) {
		case "required": {
			const prop = params.missingProperty as string | undefined;
			return prop ? `add a '${prop}' field` : "add the missing required field";
		}
		case "minItems": {
			const limit = Number(params.limit ?? 0);
			const arr = valueAt(submitted, err.instancePath);
			const got = Array.isArray(arr) ? arr.length : 0;
			const need = Math.max(limit - got, 1);
			const noun = need === 1 ? "entry" : "entries";
			return `add at least ${need} more ${noun}`;
		}
		case "minLength": {
			const limit = Number(params.limit ?? 0);
			const where = path || "value";
			return `expand '${where}' to at least ${limit} characters`;
		}
		case "type": {
			const expected = params.type as string | string[] | undefined;
			const expectedStr = Array.isArray(expected) ? expected.join(" or ") : expected;
			const where = path || "value";
			return expectedStr ? `'${where}' must be a ${expectedStr}` : `'${where}' has wrong type`;
		}
		default: {
			const detail = Object.entries(params)
				.map(([k, v]) => `${k}=${String(v)}`)
				.join(", ");
			const where = path ? `'${path}': ` : "";
			return detail ? `${where}${err.keyword} (${detail})` : `${where}${err.keyword}`;
		}
	}
}

function valueAt(data: unknown, instancePath: string): unknown {
	if (!instancePath) return data;
	const parts = instancePath.split("/").filter(Boolean);
	let cur: unknown = data;
	for (const p of parts) {
		if (cur && typeof cur === "object") {
			cur = (cur as Record<string, unknown>)[p];
		} else {
			return undefined;
		}
	}
	return cur;
}
