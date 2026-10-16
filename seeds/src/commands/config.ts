// `sd config` — schema-driven read/write surface for `.seeds/config.yaml`.
//
// Designed as warren V2's wire contract (warren ROADMAP R-10):
//   - `sd config schema --json` emits the JSON Schema (warren auto-renders a form)
//   - `sd config show [--path <p>]` reads the current value
//   - `sd config set <path> <value>` validates + writes atomically (YAML-parsed)
//   - `sd config unset <path>` removes a value
//
// Writes hold the config.yaml advisory lock; mutations validate the entire
// post-write file against configSchema() before persisting, so a partial set
// that would leave the file inconsistent is rejected.

import { randomBytes } from "node:crypto";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { findSeedsDir } from "../config.ts";
import { configSchema } from "../config-schema.ts";
import { accent, muted, outputJson, printSuccess, writeStdout } from "../output.ts";
import { withLock } from "../store.ts";
import { CONFIG_FILE } from "../types.ts";
import { compileSchema } from "../validation.ts";
import { parseScalarOrFlow, parseYaml, stringifyYaml, type YamlValue } from "../yaml.ts";

function configPath(seedsDir: string): string {
	return join(seedsDir, CONFIG_FILE);
}

function pathParts(path: string): string[] {
	const parts = path.split(".").filter((p) => p.length > 0);
	if (parts.length === 0) throw new Error("Config path must be non-empty");
	return parts;
}

function describeType(v: unknown): string {
	if (v === null) return "null";
	if (Array.isArray(v)) return "array";
	return typeof v;
}

function getAtPath(data: YamlValue, parts: string[]): YamlValue | undefined {
	let cur: YamlValue = data;
	for (const p of parts) {
		if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
		cur = (cur as Record<string, YamlValue>)[p] as YamlValue;
		if (cur === undefined) return undefined;
	}
	return cur;
}

function setAtPath(data: Record<string, YamlValue>, parts: string[], value: YamlValue): void {
	let cur: Record<string, YamlValue> = data;
	for (let i = 0; i < parts.length - 1; i++) {
		const p = parts[i];
		if (p === undefined) continue;
		const nxt = cur[p];
		if (nxt === undefined || nxt === null) {
			const empty: Record<string, YamlValue> = {};
			cur[p] = empty;
			cur = empty;
		} else if (typeof nxt === "object" && !Array.isArray(nxt)) {
			cur = nxt as Record<string, YamlValue>;
		} else {
			const soFar = parts.slice(0, i + 1).join(".");
			throw new Error(`Cannot set: '${soFar}' is not an object (got: ${describeType(nxt)})`);
		}
	}
	const last = parts[parts.length - 1];
	if (last !== undefined) cur[last] = value;
}

function unsetAtPath(data: Record<string, YamlValue>, parts: string[]): boolean {
	let cur: Record<string, YamlValue> = data;
	for (let i = 0; i < parts.length - 1; i++) {
		const p = parts[i];
		if (p === undefined) continue;
		const nxt = cur[p];
		if (nxt === null || typeof nxt !== "object" || Array.isArray(nxt)) return false;
		cur = nxt as Record<string, YamlValue>;
	}
	const last = parts[parts.length - 1];
	if (last === undefined) return false;
	if (!(last in cur)) return false;
	delete cur[last];
	return true;
}

function validateConfig(data: unknown): void {
	// Strip the meta-schema URI: configSchema() advertises draft 2020-12 for
	// downstream consumers (warren's UI), but our shared compileSchema runs
	// AJV in default (draft-07) mode and rejects unknown $schema URIs.
	const { $schema: _meta, ...schema } = configSchema();
	const validator = compileSchema(schema);
	const result = validator(data);
	if (!result.valid) {
		const lines = result.diff.errors.map((e) => `  ${e.path || "(root)"}: ${e.fix}`);
		throw new Error(`Config validation failed:\n${lines.join("\n")}`);
	}
}

async function readRawConfig(seedsDir: string): Promise<Record<string, YamlValue>> {
	const file = Bun.file(configPath(seedsDir));
	if (!(await file.exists())) {
		throw new Error(`Config not found at ${configPath(seedsDir)}`);
	}
	const content = await file.text();
	return parseYaml(content);
}

async function writeRawConfig(seedsDir: string, data: Record<string, YamlValue>): Promise<void> {
	const path = configPath(seedsDir);
	const tmpPath = `${path}.tmp.${randomBytes(4).toString("hex")}`;
	await Bun.write(tmpPath, stringifyYaml(data));
	renameSync(tmpPath, path);
}

function displayValue(v: YamlValue): string {
	if (typeof v === "string") return v;
	return JSON.stringify(v);
}

async function runSchema(jsonMode: boolean): Promise<void> {
	const schema = configSchema();
	if (jsonMode) {
		await writeStdout(`${JSON.stringify(schema)}\n`);
		return;
	}
	await writeStdout(`${JSON.stringify(schema, null, 2)}\n`);
}

async function runShow(pathArg: string | undefined, jsonMode: boolean): Promise<void> {
	const dir = await findSeedsDir();
	const raw = await readRawConfig(dir);

	if (pathArg) {
		const parts = pathParts(pathArg);
		const value = getAtPath(raw, parts);
		if (value === undefined) {
			throw new Error(`Path not found: ${pathArg}`);
		}
		if (jsonMode) {
			await outputJson({ success: true, command: "config show", path: pathArg, value });
		} else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			process.stdout.write(stringifyYaml(value as Record<string, YamlValue>));
		} else if (typeof value === "string") {
			console.log(value);
		} else {
			await writeStdout(`${JSON.stringify(value)}\n`);
		}
		return;
	}

	if (jsonMode) {
		await outputJson({ success: true, command: "config show", config: raw });
	} else {
		process.stdout.write(stringifyYaml(raw));
	}
}

async function runSet(pathArg: string, valueArg: string, jsonMode: boolean): Promise<void> {
	const dir = await findSeedsDir();
	const parts = pathParts(pathArg);
	const value = parseScalarOrFlow(valueArg);

	await withLock(configPath(dir), async () => {
		const raw = await readRawConfig(dir);
		setAtPath(raw, parts, value);
		validateConfig(raw);
		await writeRawConfig(dir, raw);
	});

	if (jsonMode) {
		await outputJson({ success: true, command: "config set", path: pathArg, value });
	} else {
		printSuccess(`Set ${accent(pathArg)} ${muted("=")} ${displayValue(value)}`);
	}
}

async function runUnset(pathArg: string, jsonMode: boolean): Promise<void> {
	const dir = await findSeedsDir();
	const parts = pathParts(pathArg);

	let removed = false;
	await withLock(configPath(dir), async () => {
		const raw = await readRawConfig(dir);
		removed = unsetAtPath(raw, parts);
		if (!removed) return;
		validateConfig(raw);
		await writeRawConfig(dir, raw);
	});

	if (jsonMode) {
		await outputJson({ success: true, command: "config unset", path: pathArg, removed });
	} else if (removed) {
		printSuccess(`Unset ${accent(pathArg)}`);
	} else {
		console.log(muted(`No such path: ${pathArg}`));
	}
}

export function register(program: Command): void {
	const config = new Command("config").description("Read, write, and inspect .seeds/config.yaml");

	config
		.command("schema")
		.description("Emit the JSON Schema for .seeds/config.yaml")
		.option("--json", "Compact single-line JSON (default is pretty-printed)")
		.action(async (opts: { json?: boolean }) => {
			await runSchema(opts.json === true);
		});

	config
		.command("show")
		.description("Print the current config (or a value at --path)")
		.option("--path <path>", "Dot-path to read (e.g. plan_templates.feature.sections.context)")
		.option("--json", "Output as JSON")
		.action(async (opts: { path?: string; json?: boolean }) => {
			await runShow(opts.path, opts.json === true);
		});

	config
		.command("set <path> <value>")
		.description("Set a config value at <path>; <value> is YAML-parsed")
		.option("--json", "Output as JSON")
		.action(async (path: string, value: string, opts: { json?: boolean }) => {
			await runSet(path, value, opts.json === true);
		});

	config
		.command("unset <path>")
		.description("Remove the config value at <path>")
		.option("--json", "Output as JSON")
		.action(async (path: string, opts: { json?: boolean }) => {
			await runUnset(path, opts.json === true);
		});

	program.addCommand(config);
}
