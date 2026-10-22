#!/usr/bin/env node
// M8 release-evidence aggregator: runs the repository's required checks and
// lifecycle harnesses in sequence, records each command's actual exit status,
// duration and parsed counts, and maps every step to the requirement IDs
// (R01–R15) it supports. Nothing here interprets a fixture result as provider
// evidence: synthetic steps are labelled synthetic in the report, and genuine
// steps run only when a provider and model are named.
//
//   node scripts/release-evidence.mjs [--out <dir>] [--only a,b] [--skip a,b] [--provider <p> --model <m>]
//
// Exit code 1 when any step that ran failed. The report (report.json,
// report.md, one log per step) is written under --out, never in Git.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = Object.fromEntries(process.argv.slice(2).map((arg, index, all) => arg.startsWith("--") ? [arg.slice(2), all[index + 1]?.startsWith("--") || all[index + 1] === undefined ? true : all[index + 1]] : []).filter((pair) => pair.length));
const started = new Date();
const out = path.resolve(options.out ?? path.join(tmpdir(), `luuna-release-evidence-${started.toISOString().replace(/[:.]/g, "-")}`));
if (existsSync(out)) { console.error(`Refusing to reuse ${out}; pass a new --out directory.`); process.exit(2); }
mkdirSync(out, { recursive: true });
const only = options.only ? String(options.only).split(",") : null;
const skip = options.skip ? String(options.skip).split(",") : [];
const windows = process.platform === "win32";
const npm = windows ? "npm.cmd" : "npm";
const node = process.execPath;
const genuine = options.provider && options.model ? { provider: String(options.provider), model: String(options.model) } : null;
// The browser smokes need a Chromium executable; playwright-core ships none. Prefer an explicit
// LUUNA_CHROMIUM, else the installed Edge or Chrome the component smoke already accepts.
if (!process.env.LUUNA_CHROMIUM && windows) {
  const browser = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((candidate) => existsSync(candidate));
  if (browser) process.env.LUUNA_CHROMIUM = browser;
}

/** Each step: id, what it establishes, the command, requirement IDs, and whether it is synthetic. */
const steps = [
  { id: "fmt", title: "Rust formatting", command: ["cargo", ["fmt", "--all", "--", "--check"]], requirements: ["E"], kind: "deterministic" },
  { id: "clippy", title: "Rust lint, warnings denied", command: ["cargo", ["clippy", "--locked", "--workspace", "--all-targets", "--", "-D", "warnings"]], requirements: ["E"], kind: "deterministic" },
  { id: "cargo-test", title: "Rust workspace tests", command: ["cargo", ["test", "--locked", "--workspace"]], requirements: ["R04", "R05", "R06", "R07", "R08", "R09", "R10", "R11", "R12", "R13", "R14", "R15"], kind: "deterministic", parse: cargoCounts },
  { id: "npm-test", title: "Contracts, scope guard, component pins, harness, client, desktop and TUI tests", command: [npm, ["test"]], requirements: ["R02", "R07"], kind: "deterministic", parse: nodeCounts },
  { id: "typecheck", title: "Frontend type check", command: [npm, ["run", "typecheck"]], requirements: ["R02"], kind: "deterministic" },
  { id: "build", title: "Frontend production build", command: [npm, ["run", "build"]], requirements: ["R02"], kind: "deterministic" },
  { id: "hygiene", title: "Repository hygiene", command: [node, ["scripts/check-hygiene.mjs"]], requirements: ["E"], kind: "deterministic" },
  { id: "diff-check", title: "Whitespace check", command: ["git", ["diff", "--check"]], requirements: ["E"], kind: "deterministic" },
  { id: "native-check", title: "Native desktop crate type check", command: ["cargo", ["check", "--locked", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml"]], requirements: ["R01"], kind: "deterministic" },
  { id: "components", title: "Pinned component CLI smoke (real Missions, Atlas, Beacon)", command: [node, ["scripts/components-smoke.mjs"]], requirements: ["R14"], kind: "real-cli" },
  { id: "components-real", title: "Explicit real-component runtime tests", command: ["cargo", ["test", "--locked", "-p", "luuna-runtime", "--lib", "components_real_", "--", "--ignored"]], requirements: ["R14"], kind: "real-cli", parse: cargoCounts },
  { id: "missions-real", title: "Explicit real-Missions runtime tests", command: ["cargo", ["test", "--locked", "-p", "luuna-runtime", "--lib", "missions_real_", "--", "--ignored"]], requirements: ["R14"], kind: "real-cli", parse: cargoCounts },
  { id: "m1-fixture", title: "M1 lifecycle harness", command: [node, ["scripts/m1-smoke.mjs", "--mode", "fixture", "--out", path.join(out, "m1-fixture")]], requirements: ["R03", "R15"], kind: "synthetic", parse: slashCounts },
  { id: "m3-fixture", title: "M3 candidate, review, repair and recovery harness (strict: needs a clean committed revision)", command: [node, ["scripts/m3-smoke.mjs", "--mode", "fixture", "--out", path.join(out, "m3-fixture")]], requirements: ["R07", "R08", "R09", "R10"], kind: "synthetic", parse: slashCounts },
  { id: "backup-drill", title: "Backup, loss, restore and newer-schema drill", command: [node, ["scripts/backup-recovery-drill.mjs", "--out", path.join(out, "backup-drill"), "--skip-migration-tests"]], requirements: ["R15", "E10"], kind: "synthetic", parse: slashCounts },
  { id: "mvp-ui", title: "Browser client walkthrough with recovery, keyboard and accessibility audit", command: [node, ["scripts/mvp-ui-smoke.mjs", "--out", path.join(out, "mvp-ui")]], requirements: ["R02", "R15"], kind: "synthetic", parse: slashCounts },
  { id: "components-ui", title: "Browser client component workflows with real Missions, Atlas and Beacon", command: [node, ["scripts/m6-ui-smoke.mjs", "--out", path.join(out, "components-ui")]], requirements: ["R14", "R02"], kind: "real-cli", parse: slashCounts },
  { id: "tui", title: "Terminal client walkthrough and parity", command: [node, ["scripts/tui-smoke.mjs", "--out", path.join(out, "tui")]], requirements: ["R02", "R15"], kind: "synthetic", parse: slashCounts },
  { id: "m1-genuine", title: "M1 genuine provider run", command: genuine ? [node, ["scripts/m1-smoke.mjs", "--mode", "real", "--provider", genuine.provider, "--model", genuine.model, "--out", path.join(out, "m1-genuine")]] : null, requirements: ["R03"], kind: "genuine", parse: slashCounts },
  { id: "m3-genuine", title: "M3 genuine provider run", command: genuine ? [node, ["scripts/m3-smoke.mjs", "--mode", "real", "--provider", genuine.provider, "--model", genuine.model, "--out", path.join(out, "m3-genuine")]] : null, requirements: ["R03", "R09", "R10"], kind: "genuine", parse: slashCounts },
];

function cargoCounts(text) {
  let passed = 0, failed = 0, ignored = 0, suites = 0;
  for (const match of text.matchAll(/test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored/g)) { suites += 1; passed += Number(match[1]); failed += Number(match[2]); ignored += Number(match[3]); }
  return suites ? `${passed} passed, ${failed} failed, ${ignored} ignored across ${suites} suites` : "";
}
function nodeCounts(text) {
  const parts = [];
  for (const match of text.matchAll(/^# pass (\d+)\s*$/gm)) parts.push(`${match[1]} node:test`);
  for (const match of text.matchAll(/Tests\s+(\d+) passed/g)) parts.push(`${match[1]} vitest`);
  for (const match of text.matchAll(/(\d+) (?:contract|schema) (?:cases|checks)/g)) parts.push(`${match[1]} contract`);
  return parts.join(", ");
}
function slashCounts(text) {
  const matches = [...text.matchAll(/(\d+)\/(\d+) (?:checks|assertions|component app smoke checks)/g)];
  const last = matches.at(-1);
  return last ? `${last[1]}/${last[2]}` : "";
}

const results = [];
let failed = false;
for (const step of steps) {
  if ((only && !only.includes(step.id)) || skip.includes(step.id)) { results.push({ ...step, command: undefined, status: "skipped" }); continue; }
  if (!step.command) { results.push({ ...step, command: undefined, status: "unavailable", detail: "no provider and model named; genuine evidence is not claimed" }); continue; }
  const [program, args] = step.command;
  console.log(`\n==> ${step.id}: ${program} ${args.join(" ")}`);
  const begun = Date.now();
  const run = spawnSync(program, args, { cwd: repository, encoding: "utf8", env: process.env, shell: windows && program.endsWith(".cmd"), maxBuffer: 256 * 1024 * 1024, timeout: 3_600_000 });
  const elapsed = Math.round((Date.now() - begun) / 1000);
  const text = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  writeFileSync(path.join(out, `${step.id}.log`), text);
  const status = run.status === 0 ? "passed" : run.error ? "unavailable" : "failed";
  const detail = step.parse ? step.parse(text) : "";
  if (status !== "passed") failed = true;
  console.log(`${status.toUpperCase()} ${step.id} (${elapsed}s)${detail ? ` — ${detail}` : ""}${run.error ? ` — ${run.error.message}` : ""}`);
  results.push({ id: step.id, title: step.title, requirements: step.requirements, kind: step.kind, command: `${path.basename(program)} ${args.map((a) => a.startsWith(out) ? `<out>/${path.basename(a)}` : a).join(" ")}`, status, exit: run.status, elapsed_seconds: elapsed, detail, error: run.error?.message });
}

const coverage = {};
for (const result of results) for (const id of result.requirements ?? []) (coverage[id] ??= []).push({ step: result.id, status: result.status, kind: result.kind });
const report = {
  started: started.toISOString(), finished: new Date().toISOString(), platform: `${process.platform} ${process.arch}`, node: process.version,
  tools: { cargo: version("cargo", ["--version"]), rustc: version("rustc", ["--version"]), git: version("git", ["--version"]), python: version(windows ? "python" : "python3", ["--version"]), npm: version(npm, ["--version"], true) },
  genuine: genuine ? { provider: genuine.provider, model: genuine.model } : null,
  steps: results, coverage, out,
  verdict: failed ? "At least one step failed; this run is not release evidence for the failed rows." : "Every step that ran passed; genuine, Mac and fresh-host rows are claimed only where a step of that kind ran.",
};
function version(program, args, shell = false) { const run = spawnSync(program, args, { encoding: "utf8", shell }); return (run.stdout || run.stderr || "").trim().split("\n")[0] || "unavailable"; }
writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
writeFileSync(path.join(out, "report.md"), `# Release evidence run\n\n${report.started} on ${report.platform}, Node ${report.node}; ${Object.entries(report.tools).map(([k, v]) => `${k}: ${v}`).join("; ")}.\n\n| Step | Kind | Requirements | Status | Detail | Seconds |\n| --- | --- | --- | --- | --- | --- |\n${results.map((r) => `| ${r.id} | ${r.kind} | ${(r.requirements ?? []).join(" ")} | ${r.status} | ${(r.detail ?? r.error ?? "").replace(/\|/g, "\\|")} | ${r.elapsed_seconds ?? ""} |`).join("\n")}\n\n${report.verdict}\n`);
console.log(`\n${report.verdict}\nReport: ${path.join(out, "report.md")}`);
process.exit(failed ? 1 : 0);
