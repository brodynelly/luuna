import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { createLogger, isPinoPrettyAvailable, redactDbUrl, resolveLogLevel } from "../src/log.ts";

/**
 * Capture one log line emitted by a logger writing to an in-memory stream.
 * No mocks — a real Writable, asserted against real JSON output, per mulch's
 * testing conventions.
 */
function captureLine(
	opts: { level?: string },
	emit: (logger: ReturnType<typeof createLogger>) => void,
): string {
	let out = "";
	const stream = new Writable({
		write(chunk, _enc, cb) {
			out += chunk.toString();
			cb();
		},
	});
	const logger = createLogger({ level: opts.level, destination: stream });
	emit(logger);
	return out;
}

describe("createLogger redaction", () => {
	test("strips a top-level sensitive key", () => {
		const line = captureLine({ level: "info" }, (l) => l.info({ password: "SECRET" }, "t"));
		expect(line).not.toContain("SECRET");
		expect(line).not.toContain("password");
	});

	test("strips a nested sensitive key", () => {
		const line = captureLine({ level: "info" }, (l) => l.info({ cfg: { token: "SECRET" } }, "t"));
		expect(line).not.toContain("SECRET");
	});

	test("strips HTTP-style auth headers", () => {
		const line = captureLine({ level: "info" }, (l) =>
			l.info({ headers: { authorization: "Bearer SECRET", cookie: "sid=SECRET" } }, "t"),
		);
		expect(line).not.toContain("SECRET");
	});

	test("preserves non-sensitive fields", () => {
		const line = captureLine({ level: "info" }, (l) => l.info({ domain: "cli", count: 3 }, "ok"));
		expect(line).toContain("cli");
		expect(line).toContain("ok");
	});
});

describe("resolveLogLevel", () => {
	test("MULCH_LOG_LEVEL wins", () => {
		expect(resolveLogLevel({ MULCH_LOG_LEVEL: "warn" } as NodeJS.ProcessEnv)).toBe("warn");
	});

	test("MULCH_DEBUG implies debug", () => {
		expect(resolveLogLevel({ MULCH_DEBUG: "1" } as NodeJS.ProcessEnv)).toBe("debug");
	});

	test("defaults to info", () => {
		expect(resolveLogLevel({} as NodeJS.ProcessEnv)).toBe("info");
	});

	test("explicit level gates output", () => {
		// At warn level, an info call emits nothing.
		const line = captureLine({ level: "warn" }, (l) => l.info({ a: 1 }, "below threshold"));
		expect(line).toBe("");
		// A warn call at the same level does emit.
		const warned = captureLine({ level: "warn" }, (l) => l.warn({ a: 1 }, "at threshold"));
		expect(warned).toContain("at threshold");
	});
});

describe("pino-pretty transport fallback", () => {
	test("pino-pretty is resolvable in the dev environment", () => {
		// In this repo pino-pretty is a devDependency, so the probe must
		// report it available — guards against the probe silently always
		// returning false.
		expect(isPinoPrettyAvailable()).toBe(true);
	});

	test("falls back to JSON-on-stderr when pino-pretty is unavailable", () => {
		// Simulates a published consumer in an interactive TTY without the
		// dev-only pretty transport: must not throw (acceptance criterion).
		expect(() => createLogger({ pretty: true, prettyAvailable: false })).not.toThrow();
	});

	test("emits structured JSON on the fallback path", () => {
		// With pino-pretty forced unavailable but pretty requested, the logger
		// still produces machine-readable JSON when handed a destination.
		let out = "";
		const stream = new Writable({
			write(chunk, _enc, cb) {
				out += chunk.toString();
				cb();
			},
		});
		const logger = createLogger({
			level: "info",
			destination: stream,
			pretty: true,
			prettyAvailable: false,
		});
		logger.info({ domain: "cli" }, "fallback");
		expect(out).toContain("fallback");
		expect(out).toContain("cli");
		expect(() => JSON.parse(out)).not.toThrow();
	});
});

describe("redactDbUrl", () => {
	test("masks postgres credentials", () => {
		const redacted = redactDbUrl("postgres://alice:hunter2@db.example/mulch");
		expect(redacted).not.toContain("hunter2");
		expect(redacted).not.toContain("alice");
		expect(redacted).toContain("db.example");
	});

	test("passes through sqlite and sentinel values unchanged", () => {
		expect(redactDbUrl("sqlite:///var/data/mulch.db")).toBe("sqlite:///var/data/mulch.db");
		expect(redactDbUrl(":memory:")).toBe(":memory:");
	});

	test("passes through credential-free URLs unchanged", () => {
		expect(redactDbUrl("postgres://db.example/mulch")).toBe("postgres://db.example/mulch");
	});

	test("collapses an unparseable URL to a safe placeholder", () => {
		expect(redactDbUrl("not a url@with at")).toBe("<redacted-url>");
	});
});
