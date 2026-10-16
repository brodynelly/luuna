/**
 * Structured logger for mulch's diagnostic / operational channel.
 *
 * IMPORTANT: this is NOT the product-output channel. Mulch's user-facing
 * output (the markdown `ml prime` emits, status tables, `--json` results,
 * hints) intentionally goes straight to stdout via `console.log` /
 * `outputJson`. Routing that through pino would wrap the product output in
 * log envelopes and corrupt machine-readable `--json` consumers.
 *
 * This logger is for *diagnostics* — hook execution, unexpected internal
 * errors, anything an operator (not the end user) wants when debugging.
 * For that reason it writes to **stderr** (fd 2), never stdout, so it can
 * never collide with the CLI result on stdout. It is silent at `info` for
 * routine internals (those log at `debug`, gated behind `MULCH_DEBUG`).
 *
 * Level: `MULCH_LOG_LEVEL` wins; otherwise `debug` when `MULCH_DEBUG` is
 * set, else `info`. In a dev TTY we render with `pino-pretty` (a devDep);
 * in CI / non-TTY / production we emit newline-delimited JSON. `pino-pretty`
 * is intentionally not a runtime dependency — published consumers of
 * `@os-eco/mulch-cli` get JSON logs and never need the pretty transport.
 * Because that promise must hold even in an interactive TTY, the pretty
 * path is gated on `pino-pretty` being resolvable; when it is absent we fall
 * back to JSON-on-stderr instead of letting pino throw on the missing target.
 */

import { createRequire } from "node:module";
import pino, { type Logger } from "pino";

/**
 * Whether the `pino-pretty` transport target can be loaded. It is a
 * devDependency, so published consumers (`npm i -g`, `bun add`, production
 * installs) won't have it — selecting the pretty transport there makes pino
 * throw `unable to determine transport target for "pino-pretty"`. We probe
 * resolvability up front so the pretty path is only taken when the package
 * is actually present; otherwise we fall back to JSON-on-stderr.
 */
export function isPinoPrettyAvailable(): boolean {
	try {
		createRequire(import.meta.url).resolve("pino-pretty");
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve the effective log level from the environment. `MULCH_LOG_LEVEL`
 * is authoritative; `MULCH_DEBUG` is the ergonomic shortcut to `debug`.
 */
export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): string {
	return env.MULCH_LOG_LEVEL ?? (env.MULCH_DEBUG ? "debug" : "info");
}

/**
 * Redaction paths use pino/fast-redact syntax, where `*` is a *full key
 * segment* wildcard (`*.password` = a `password` key one level under any
 * key). We list both the bare key (`password`) and the wildcard form
 * (`*.password`) so a secret is masked whether it appears at the top level
 * or nested. `remove: true` drops the key entirely rather than printing a
 * `[Redacted]` placeholder.
 *
 * Note on `env.*KEY*` / `env.*TOKEN*`: fast-redact wildcards match a whole
 * segment, so these only catch a literally-matching nested key — they do
 * NOT pattern-match arbitrary `*_API_KEY` env names. They are kept because
 * the L5 governance spec lists them and they are harmless, but the real
 * defence for connection strings is `redactDbUrl()` below, applied inline
 * before the value ever reaches a log call.
 */
export const REDACT_PATHS = [
	"password",
	"*.password",
	"token",
	"*.token",
	"apiKey",
	"*.apiKey",
	"secret",
	"*.secret",
	"headers.authorization",
	"headers.cookie",
	"env.*KEY*",
	"env.*TOKEN*",
] as const;

/**
 * Build a pino logger. Exposed (in addition to the default `log` instance)
 * so tests can inject a capturing destination and a fixed env without
 * mutating `process.env` — mirrors mulch's no-mocks, real-stream testing
 * convention.
 */
export function createLogger(
	opts: {
		level?: string;
		destination?: pino.DestinationStream;
		pretty?: boolean;
		prettyAvailable?: boolean;
	} = {},
): Logger {
	const level = opts.level ?? resolveLogLevel();
	const redact = { paths: [...REDACT_PATHS], remove: true };

	// Pretty transport and an explicit destination stream are mutually
	// exclusive in pino — passing both throws. When a test hands us a
	// destination we always take the plain-JSON path so output is captured
	// verbatim.
	if (opts.destination) {
		return pino({ name: "mulch", level, redact }, opts.destination);
	}

	const wantsPretty =
		opts.pretty ?? (process.stderr.isTTY === true && process.env.MULCH_LOG_JSON !== "1");

	// Only take the pretty path when `pino-pretty` is actually resolvable.
	// Published consumers run in an interactive TTY without the devDependency;
	// selecting the transport there throws, so we degrade to JSON-on-stderr.
	const usePretty = wantsPretty && (opts.prettyAvailable ?? isPinoPrettyAvailable());

	if (usePretty) {
		return pino({
			name: "mulch",
			level,
			redact,
			transport: {
				target: "pino-pretty",
				options: { destination: 2, colorize: true, translateTime: "SYS:HH:MM:ss.l" },
			},
		});
	}

	// CI / non-TTY / production: newline-delimited JSON straight to stderr.
	return pino({ name: "mulch", level, redact }, pino.destination(2));
}

/**
 * Strip credentials (`user:password@`) from a URL before logging it.
 * Mirrors warren's helper: non-URL sentinels (`:memory:`, bare sqlite
 * paths) and credential-free URLs pass through unchanged; an unparseable
 * URL collapses to a safe placeholder so a malformed value can never leak.
 */
export function redactDbUrl(url: string): string {
	// Bare sqlite / sentinel values have no userinfo to strip.
	if (url === ":memory:" || url.startsWith("sqlite:") || !url.includes("@")) {
		return url;
	}
	try {
		const u = new URL(url);
		if (u.username !== "" || u.password !== "") {
			u.username = "";
			u.password = "";
			return u.toString();
		}
		return url;
	} catch {
		return "<redacted-url>";
	}
}

/** Default process-wide logger. Diagnostics only — see file header. */
export const log = createLogger();
