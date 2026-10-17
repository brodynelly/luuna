#!/usr/bin/env node
// Luuna M3 smoke harness: drives a real `luuna-runtime` binary through the
// approved writer → candidate checks → independent review → bounded repair
// pipeline on a disposable fixture repository and records sanitized evidence.
//
//   node scripts/m3-smoke.mjs --mode fixture      # synthetic Pi fixture; never provider evidence
//   node scripts/m3-smoke.mjs --mode real --provider openrouter --model openai/gpt-4o-mini
//
// Scenarios: approved feature → checks → fresh reviewer; seeded failing check →
// manual repair r2 → fresh checks/review; blocking review findings under bounded
// automatic repair; cancellation while the reviewer is in flight; hard-kill
// restart during review with conservative spend reservation; orderly shutdown.
//
// Real mode needs the pinned Pi executable (LUUNA_PI_COMMAND or --pi) and the
// provider credential in this process environment; the runtime forwards only the
// supported names (or their LUUNA_PI_ aliases) to the isolated Pi children. The
// report records credential names only and is scanned for leaked values.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, writeSync, rmdirSync, readdirSync, readFileSync, opendirSync, statSync, lstatSync, readlinkSync, realpathSync, existsSync, openSync, readSync, closeSync, unlinkSync, fstatSync, fchmodSync, ftruncateSync, constants as fsConstants } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { tmpdir, platform, release, arch, devNull } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

// Linux: the harness runs under a child subreaper, so every process of the run that outlives its
// parent (a check that detaches a child with closed stdio, a Pi orphaned by a hard kill) is
// reparented to that reaper instead of init and can be found and killed before the leak scan
// (see `reapStrays`). The reaper exports its pid; the harness re-executes itself beneath it.
const REAPER_SCRIPT = String.raw`
import ctypes, os, signal, sys
if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
    sys.stderr.write("m3-smoke: cannot become a child subreaper\n")
    sys.exit(2)
os.environ["LUUNA_M3_REAPER"] = str(os.getpid())
harness = os.fork()
if harness == 0:
    try:
        os.execv(sys.argv[1], sys.argv[1:])
    finally:
        os._exit(127)
def forward(signum, frame):
    try:
        os.kill(harness, signum)
    except ProcessLookupError:
        pass
for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
    signal.signal(signum, forward)
def children():
    found = []
    for task in os.listdir("/proc/self/task"):
        try:
            with open("/proc/self/task/%s/children" % task) as listing:
                found += [int(pid) for pid in listing.read().split()]
        except OSError:
            pass
    return found
status = None
while True:
    if status is not None:
        # The harness has exited: nothing of the run may outlive it.
        for pid in children():
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    try:
        pid, code = os.waitpid(-1, 0)
    except ChildProcessError:
        break
    if pid == harness:
        status = code
sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status))
`;
if (process.platform === "linux" && process.env.LUUNA_M3_REAPER !== String(process.ppid)) {
  const reaped = spawnSync("python3", ["-I", "-c", REAPER_SCRIPT, process.execPath, ...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: "inherit" });
  if (reaped.error) {
    console.error(`m3-smoke: cannot start the python3 child subreaper (${reaped.error.code ?? reaped.error.message})`);
    process.exit(2);
  }
  process.exit(reaped.status ?? 1);
}

const options = parseArguments(process.argv.slice(2));
const mode = options.mode ?? "real";
if (!["fixture", "real"].includes(mode)) fail("--mode must be fixture or real");
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const started = new Date();
const out = path.resolve(options.out ?? path.join(tmpdir(), `luuna-m3-smoke-${started.toISOString().replace(/[:.]/g, "-")}`));
mkdirSync(out, { recursive: true, mode: 0o700 });
// The output root's identity, pinned before anything runs: destructive cleanup is refused if
// the directory is later replaced, renamed or reached through a different real path.
const outIdentity = (() => { const stat = lstatSync(out); return { dev: stat.dev, ino: stat.ino, real: realpathSync(out) }; })();
// Held directory handles (Linux): the scan and quarantine resolve every name relative to an open,
// non-following directory descriptor through /proc/self/fd, so renaming the output root or
// replacing any component with a link after it was opened cannot redirect a read or a removal.
// Elsewhere the harness falls back to path checks, records that, and refuses recursive removal.
const HELD_HANDLES = process.platform === "linux" && fsConstants.O_DIRECTORY !== undefined && fsConstants.O_NOFOLLOW !== undefined && existsSync("/proc/self/fd");
const heldPath = (fd, name) => (name === undefined ? `/proc/self/fd/${fd}` : `/proc/self/fd/${fd}/${name}`);
const openHeldDir = (target) => openSync(target, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
// Removal is bounded like the scan: a shared entry budget and a nesting limit, so a huge or deeply
// nested tree fails the cleanup (reported as not removed) instead of exhausting memory or the stack.
const REMOVE_ENTRY_LIMIT = 200_000;
const REMOVE_DEPTH_LIMIT = 128;
const removalBudget = () => ({ left: REMOVE_ENTRY_LIMIT });
/** Reads at most `limit` names from a held directory without materializing the whole listing. */
const listHeld = (fd, limit, skip = null) => {
  const names = [];
  const listing = opendirSync(heldPath(fd));
  try { for (let entry = listing.readSync(); entry !== null && names.length < limit; entry = listing.readSync()) if (!skip?.has(entry.name)) names.push(entry.name); } finally { listing.closeSync(); }
  return names;
};
// Removes an entry relative to a held parent, descending only through non-following handles and
// listing each directory in bounded batches.
const removeHeld = (parentFd, name, budget, depth = 0) => {
  budget.left -= 1;
  if (budget.left < 0) throw new Error(`removal stopped after ${REMOVE_ENTRY_LIMIT} entries`);
  const target = heldPath(parentFd, name);
  if (!lstatSync(target).isDirectory()) { unlinkSync(target); return; }
  if (depth >= REMOVE_DEPTH_LIMIT) throw new Error(`nesting deeper than ${REMOVE_DEPTH_LIMIT} directories`);
  const fd = openHeldDir(target);
  try {
    for (let batch = listHeld(fd, 1000); batch.length > 0; batch = listHeld(fd, 1000)) {
      for (const child of batch) removeHeld(fd, child, budget, depth + 1);
    }
  } finally { closeSync(fd); }
  rmdirSync(target);
};
const outFd = HELD_HANDLES ? openHeldDir(out) : null;
const dataDir = path.join(out, "data");
const fixtureRepo = path.join(out, "fixture-repo");
// Refuse any non-empty output directory before anything is spawned: the run
// scans, redacts and may delete files under it, so it must own every file there.
if (readdirSync(out).length > 0) fail(`output directory is not empty; use a fresh or empty --out: ${out}`);
const port = Number(options.port ?? 4248);
const runtimeBinary = path.resolve(options.runtime ?? path.join(repository, "target", "debug", process.platform === "win32" ? "luuna-runtime.exe" : "luuna-runtime"));
const token = randomBytes(36).toString("base64url");
const runTimeoutSeconds = Number(options["run-timeout"] ?? process.env.LUUNA_RUN_TIMEOUT_SECONDS ?? 600);
const python = process.platform === "win32" ? "python" : "python3";
const PROJECT = "m3-smoke";
/** Every request is bounded so a runtime that accepts a connection but never answers cannot hang the evidence run. */
const REQUEST_TIMEOUT_MS = 30_000;
// Largest file the leak scan will read; anything bigger is an unscannable target that fails the run.
const SCAN_FILE_LIMIT = 512 * 1024 * 1024;
// Aggregate scan budget: bytes read and files opened across the whole output tree. Anything
// left unscanned when a budget is spent is a scan failure and is quarantined.
const SCAN_TOTAL_LIMIT = 2 * 1024 * 1024 * 1024;
const SCAN_FILE_COUNT_LIMIT = 20_000;
// Runtime stderr kept in memory (a diagnostic tail) and written to each runtime log at most.
const RUNTIME_STDERR_TAIL = 64 * 1024;
const RUNTIME_LOG_LIMIT = 16 * 1024 * 1024;
// Deepest directory nesting the scan descends into (one call frame and one descriptor per level).
const SCAN_DEPTH_LIMIT = 128;
const CREDENTIAL_NAMES = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY", "XAI_API_KEY", "OPENROUTER_API_KEY"];

// Fixture mode: the synthetic writer/reviewer read their scenario from
// `fixture:<name>` markers in the acceptance criteria. The required check is a
// real host command that fails on the seeded regression the synthetic repair
// writer produces first. Real mode: a Python unittest suite is the required
// check; the farewell ticket deliberately disagrees with the authoritative
// test so the first candidate fails and repair must produce a fresh revision.
// The failure marker is assembled at run time so it appears only in the check
// output, never in the recorded command the repair feedback already quotes.
const FIXTURE_CHECK = "import pathlib,sys; t=pathlib.Path('src/main.py').read_text(); f='seeded regression' in t; print('running 1 tests'); print('test result: ' + ('FAILED. 0 passed; 1 failed; 0 ignored; 0 measured' if f else 'ok. 1 passed; 0 failed; 0 ignored; 0 measured')); sys.exit(1 if f else 0)";
const REAL_TESTS = `import unittest
from src.greeting import greeting
from src.farewell import farewell


class MessageTest(unittest.TestCase):
    def test_greeting_format(self):
        value = greeting("Ada")
        self.assertIsInstance(value, str)
        if value != "TODO":
            self.assertEqual(value, "Hello, Ada!")

    def test_farewell_format(self):
        value = farewell("Ada")
        self.assertIsInstance(value, str)
        if value != "TODO":
            self.assertEqual(value, "Goodbye, Ada!")


if __name__ == "__main__":
    unittest.main()
`;
// A second required check that the ticket never mentions: it passes while
// farewell is unimplemented (so the baseline passes) and fails the first real
// implementation until the writer adds the header line it demands. Only the
// check output says so, which is exactly what repair feedback must carry.
const REAL_POLICY = `import pathlib
import sys

source = pathlib.Path("src/farewell.py").read_text(encoding="utf-8")
if 'return "TODO"' in source:
    print("policy: src/farewell.py is not implemented yet; nothing to check")
    sys.exit(0)
if source.splitlines()[:1] != ["# format: goodbye-v2"]:
    print("policy violation: src/farewell.py must start with the exact line '# format: goodbye-v2' once farewell is implemented")
    sys.exit(1)
print("policy: src/farewell.py declares format goodbye-v2")
`;
const profile = mode === "fixture"
  ? {
    pi: python,
    piArgs: [path.join(repository, "fixtures", "pi-rpc", "mock_pi.py")],
    provider: "test",
    model: "synthetic",
    files: { "README.md": "fixture\n", "pyproject.toml": "[project]\nname = \"fixture\"\n", "src/main.py": "print('fixture')\n" },
    checks: [{ id: "unit", executable: python, args: ["-c", FIXTURE_CHECK], required: true, timeout_seconds: 60, capabilities: ["python"], cwd: "." }],
    scenarios: {
      feature: ticket("Implement the greeting", "Make src/main.py print the greeting.", ["fixture:write_in_scope", "main prints the greeting"], ["src/main.py"], 1),
      repair: ticket("Repair the seeded regression", "Make src/main.py print the greeting.", ["fixture:repair_in_scope", "main prints the greeting"], ["src/main.py"], 2),
      blocking: ticket("Blocking review probe", "Make src/main.py print the greeting.", ["fixture:write_in_scope", "fixture:review_blocking", "main prints the greeting"], ["src/main.py"], 2),
      cancel: ticket("Cancellation probe", "Make src/main.py print the greeting.", ["fixture:review_hold", "main prints the greeting"], ["src/main.py"], 1),
      restart: ticket("Restart probe", "Make src/main.py print the greeting.", ["fixture:review_hold", "main prints the greeting"], ["src/main.py"], 1),
    },
  }
  : {
    pi: options.pi ?? process.env.LUUNA_PI_COMMAND ?? "pi",
    piArgs: JSON.parse(options["pi-args-json"] ?? process.env.LUUNA_PI_ARGS_JSON ?? "[]"),
    provider: options.provider ?? process.env.LUUNA_PI_PROVIDER,
    model: options.model ?? process.env.LUUNA_PI_MODEL,
    files: {
      "README.md": "# Messages fixture\n\nA tiny Python package used by the Luuna M3 smoke harness.\n",
      "src/__init__.py": "",
      "src/greeting.py": "def greeting(name):\n    return \"TODO\"\n",
      "src/farewell.py": "def farewell(name):\n    return \"TODO\"\n",
      "test_messages.py": REAL_TESTS,
      "checks/policy.py": REAL_POLICY,
    },
    checks: [
      { id: "unit", executable: python, args: ["-m", "unittest", "-v"], required: true, timeout_seconds: 120, capabilities: ["python"], cwd: "." },
      { id: "policy", executable: python, args: ["checks/policy.py"], required: true, timeout_seconds: 60, capabilities: ["python"], cwd: "." },
    ],
    scenarios: {
      feature: ticket("Implement greeting", "Change src/greeting.py so that greeting(name) returns the string 'Hello, <name>!' (for example greeting('Ada') == 'Hello, Ada!'). Do not change any other file.", [`${python} -m unittest -v passes`, "only src/greeting.py changes"], ["src/greeting.py"], 1),
      repair: ticket("Implement farewell", "Change src/farewell.py so that farewell(name) returns the string 'Goodbye, <name>!' (for example farewell('Ada') == 'Goodbye, Ada!'). Do not change any other file; the project's required checks run after you stop and any repair feedback quotes their output.", ["every required project check passes", "only src/farewell.py changes"], ["src/farewell.py"], 2),
      blocking: ticket("Document the greeting", "Change src/greeting.py so that greeting(name) returns the string 'Hello, <name>!' and add a '## Usage' section to README.md that shows how to call it. Both changes are required.", ["README.md gains a Usage section", "src/greeting.py returns 'Hello, <name>!'", `${python} -m unittest -v passes`], ["src/greeting.py"], 2),
      cancel: ticket("Implement greeting (cancellation probe)", "Change src/greeting.py so that greeting(name) returns the string 'Hello, <name>!' (for example greeting('Ada') == 'Hello, Ada!'). Do not change any other file.", [`${python} -m unittest -v passes`, "only src/greeting.py changes"], ["src/greeting.py"], 1),
      restart: ticket("Implement greeting (restart probe)", "Change src/greeting.py so that greeting(name) returns the string 'Hello, <name>!' (for example greeting('Ada') == 'Hello, Ada!'). Do not change any other file.", [`${python} -m unittest -v passes`, "only src/greeting.py changes"], ["src/greeting.py"], 1),
    },
  };
if (!profile.provider || !profile.model) fail("real mode requires --provider and --model (or LUUNA_PI_PROVIDER / LUUNA_PI_MODEL)");

const checks = [];
const notes = [];
const evidence = { mode, started_at: started.toISOString(), out, runtime_binary: runtimeBinary, port, project: PROJECT, scenarios: {} };
const base = `http://127.0.0.1:${port}`;
let runtime = null;
let developerHead = null;
let untrackedAfterBaseline = null;
let finalStop = { exited: false };
// A runtime that is starting is tracked here until it is healthy, so a start that fails while the
// child is still alive leaves the final cleanup a handle to stop and await.
let startingRuntime = null;
// Scenarios after which the verified Pi tree or launcher no longer matched (real mode).
const piTreeChangedAfter = [];

try {
  evidence.environment = environment();
  const pi = evidence.environment.pi_provenance;
  record("the Pi tree is byte-identical to a fresh install of tools/pi/package-lock.json (every tarball integrity-checked by npm)", mode === "fixture" ? true : pi?.verified === true, mode === "fixture" ? "synthetic fixture tracked in the clean checkout; not provider evidence" : pi?.verified ? `@earendil-works/pi-coding-agent ${pi.package.version}, ${pi.package.tree_entries} entries, tree ${pi.package.tree_digest.slice(0, 16)}…, launcher sha256 ${pi.launcher.sha256.slice(0, 16)}…` : `not verified: ${pi?.error ?? "no provenance recorded"}`);
  // The runtime forwards the provider credential to every Pi it starts, so an unverified Pi
  // (a modified tree, launcher or entrypoint) never receives it: the run stops before any start.
  if (mode === "real" && pi?.verified !== true) throw new Error("Pi provenance not verified; the runtime and every provider session were not started");
  runtime = await startRuntime("initial");
  const identity = evidence.environment.runtime_build_identity;
  // The harness and every other tracked file that defines the evidence must equal the recorded
  // revision too, or a locally weakened probe could pass under that revision's name.
  record("the Luuna checkout (harness included) matched the recorded revision: no modified or untracked file", evidence.environment.git_dirty === false, `revision ${evidence.environment.git_revision}, ${evidence.environment.git_dirty === false ? "clean" : evidence.environment.git_dirty === null ? "status unknown" : `modified: ${evidence.environment.git_dirty_paths}`}`);
  record("the runtime binary was built from the recorded revision's build inputs (embedded content digest)", identity === evidence.environment.expected_build_identity && evidence.environment.runtime_sources_dirty === false, `revision ${evidence.environment.git_revision}, build inputs ${evidence.environment.runtime_sources_dirty === false ? "clean" : "modified or unknown"}, binary reports ${String(identity).slice(0, 23)}…, checkout ${String(evidence.environment.expected_build_identity).slice(0, 23)}…`);
  const pinned = pinnedToolchain();
  // A wrapper (RUSTC_WRAPPER / RUSTC_WORKSPACE_WRAPPER) can change compilation while the compiler
  // still reports the pinned release, so evidence builds must use none.
  const toolchainRustc = pinnedRustcSha256(pinned);
  evidence.environment.pinned_rustc_sha256 = toolchainRustc;
  record("the runtime binary was compiled with the toolchain pinned in rust-toolchain.toml (the compiler executable's bytes, not its self-report), no compiler wrapper, no RUSTFLAGS, no profile overrides and no Cargo config overrides", pinned !== null && String(evidence.environment.runtime_build_rustc).split(" ")[0] === pinned && /^[0-9a-f]{64}$/.test(toolchainRustc) && evidence.environment.runtime_build_rustc_sha256 === toolchainRustc && evidence.environment.runtime_build_rustc_wrapper === "none" && / rustflags=none overrides=none config-overrides=none$/.test(String(evidence.environment.runtime_build_flags)) && evidence.environment.cargo_dependency_overrides.length === 0, `pinned ${pinned ?? "unreadable"}, binary built by rustc ${evidence.environment.runtime_build_rustc} (sha256 ${String(evidence.environment.runtime_build_rustc_sha256).slice(0, 16)}…, pinned toolchain rustc ${String(toolchainRustc).slice(0, 16)}…), wrapper ${evidence.environment.runtime_build_rustc_wrapper}, ${evidence.environment.runtime_build_flags}, Cargo config overrides now: ${evidence.environment.cargo_dependency_overrides.join(", ") || "none"}`);
  await registerProjectAndBaseline();
  await scenario("feature", approvedFeatureIsCheckedAndIndependentlyReviewed);
  await scenario("repair", failingCheckRequiresManualRepairAndFreshEvidence);
  await scenario("blocking", blockingFindingsAreBoundedByAutomaticRepair);
  await scenario("cancel", cancellationDuringReviewPreservesChecks);
  await scenario("restart", hardKillDuringReviewReservesSpend);
  record("the verified Pi tree and launcher were unchanged after every scenario", piTreeChangedAfter.length === 0, mode === "fixture" ? "synthetic fixture; not provider evidence" : piTreeChangedAfter.length === 0 ? "re-hashed after each of the five scenarios" : `changed after: ${piTreeChangedAfter.join(", ")}`);
  await developerCheckoutUntouched();
  await gracefulShutdown();
} catch (error) {
  record("harness", false, `unexpected harness failure: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
  finalStop = await stopRuntime(runtime);
  if (startingRuntime !== null && startingRuntime !== runtime) {
    const starting = await stopRuntime(startingRuntime);
    finalStop = { exited: finalStop.exited && starting.exited };
  }
}

evidence.finished_at = new Date().toISOString();
evidence.checks = checks;
evidence.notes = notes;
// The scan only means something once nothing else can write under the output tree:
// a runtime whose exit was not observed fails the run and the scan is not trusted.
record("the runtime exited before the leak scan", finalStop.exited, finalStop.exited ? "exit observed" : "the runtime did not exit after SIGTERM and SIGKILL; the leak scan below cannot establish what remains on disk");
// No process of the run may still be able to write when the scan runs: every survivor (a detached
// check descendant, an orphaned Pi) is killed and its exit observed first.
const strays = await reapStrays();
evidence.stray_processes = strays;
// Checks run writer-controlled code with host permissions, so the Luuna checkout that defines the
// evidence is compared again once nothing of the run can still write to it.
const checkoutAfter = checkoutState();
try { checkoutAfter.build_identity = buildIdentity(); } catch (error) { checkoutAfter.build_identity = `unavailable: ${error.message}`; }
evidence.checkout_after_run = checkoutAfter;
record("the Luuna checkout was still the recorded revision, clean, with the same build inputs once every process of the run had stopped", checkoutAfter.git_revision === evidence.environment?.git_revision && checkoutAfter.git_dirty === false && checkoutAfter.build_identity === evidence.environment?.expected_build_identity, `revision ${checkoutAfter.git_revision}, ${checkoutAfter.git_dirty === false ? "clean" : checkoutAfter.git_dirty === null ? "status unknown" : `modified: ${checkoutAfter.git_dirty_paths}`}, build inputs ${checkoutAfter.build_identity === evidence.environment?.expected_build_identity ? "unchanged" : "changed"}`);
record("no process of the run outlived it before the leak scan (Linux child subreaper; survivors killed)", strays.contained || process.platform !== "linux", strays.contained ? `${strays.killed} surviving process(es) killed and reaped` : process.platform === "linux" ? `not contained: ${strays.reason}` : `unavailable on ${process.platform}: descendants that detach from the runtime are not tracked`);
evidence.leak_scan = scanForCredentialValues();
// Held handles are required where they exist (Linux); elsewhere the weaker fallback is recorded, not hidden.
record("the leak scan and quarantine resolved paths through held directory handles where the platform provides them", evidence.leak_scan.held_handles || process.platform !== "linux", evidence.leak_scan.held_handles ? "/proc/self/fd handles" : `unavailable on ${process.platform}: pinned-root path checks only, recursive cleanup refused`);
if (!finalStop.exited) { evidence.leak_scan.leaks += 1; evidence.leak_scan.untrusted = "runtime still running during the scan"; }
else if (!strays.contained && process.platform === "linux") { evidence.leak_scan.leaks += 1; evidence.leak_scan.untrusted = "a process of the run may still have been running during the scan"; }
record("no credential value appears in the report, runtime logs or durable state", evidence.leak_scan.leaks === 0, `${evidence.leak_scan.files_scanned} files scanned against ${evidence.leak_scan.values_checked} configured values`);
// A file that carries a configured value, or that could not be scanned, must not
// outlive the run: remove it (and the durable state, whose contents it may have
// come from) so a failed evidence run leaves no credential on disk.
const quarantine = quarantineLeaks(evidence.leak_scan);
evidence.leak_scan.removed = quarantine.removed;
evidence.leak_scan.not_removed = quarantine.failed;
if (quarantine.removed.length + quarantine.failed.length > 0) record("every file the leak scan flagged was removed before exit", quarantine.failed.length === 0, quarantine.failed.length === 0 ? `removed ${quarantine.removed.join(", ")}` : `still present: ${quarantine.failed.join(", ")}`);
const passed = checks.every((check) => check.ok);
evidence.verdict = mode === "fixture"
  ? `SYNTHETIC fixture run ${passed ? "passed" : "FAILED"}: harness/protocol evidence only, never provider or M3 success`
  : `Real provider run ${passed ? "passed every M3 smoke check" : "did NOT pass every M3 smoke check"} (see notes for best-effort observations)`;
// The report is redacted before it is written or printed: a leak the scan found
// fails the run and is reported by file name, never by value.
const reportJson = redactConfiguredValues(JSON.stringify(evidence, null, 2) + "\n");
const reportMarkdown = redactConfiguredValues(markdown(evidence));
console.log(reportMarkdown);
const unwritten = [["report.json", reportJson], ["report.md", reportMarkdown]].flatMap(([name, text]) => writeReport(name, text));
if (unwritten.length > 0) {
  console.error(`Report NOT written: ${unwritten.join("; ")}`);
  process.exit(1);
}
console.log(`Report written to ${path.join(out, "report.md")} and report.json`);
process.exit(passed ? 0 : 1);

// ---------------------------------------------------------------------------

/**
 * Creates a report file relative to the held output root (or, without held handles, only while
 * the pinned root is intact), never following a link and never replacing an existing entry, so a
 * root renamed or swapped for a link after the scan cannot redirect the write. Returns the
 * reasons it was refused, if any.
 */
function writeReport(name, text) {
  const fd = openOwnedFile(name);
  if (typeof fd !== "number") return [`${name}: ${fd}`];
  try { writeFileSync(fd, text); } finally { closeSync(fd); }
  return [];
}

/** Creates a new file directly under the output root (exclusive, non-following, 0600); returns the descriptor or the reason it was refused. */
function openOwnedFile(name, extraFlags = 0) {
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0) | extraFlags;
  let target = path.join(out, name);
  if (outFd !== null) target = heldPath(outFd, name);
  else { const refused = unpinnedReason(target); if (refused) return refused; }
  try { return openSync(target, flags, 0o600); } catch (error) { return String(error.code ?? error.message); }
}

function ticket(title, intent, acceptance_criteria, paths, maxAttempts) {
  return { title, intent, acceptance_criteria, paths, budgets: { max_attempts: maxAttempts, timeout_seconds: runTimeoutSeconds, cost_usd_micros: 300_000 } };
}

/**
 * Orderly shutdown first (so the runtime can stop its own process groups),
 * then an awaited hard kill; the scan below must not race a dying child.
 */
/** Stops the runtime and reports whether its exit was observed. */
async function stopRuntime(child) {
  if (!child || settled(child)) return { exited: true };
  if (child.exitCode === null && child.signalCode === null) child.kill(process.platform === "win32" ? undefined : "SIGTERM");
  const orderly = await waitForExit(child, 15_000);
  if (orderly.exited) return { exited: true };
  child.kill("SIGKILL");
  return { exited: (await waitForExit(child, 10_000)).exited };
}

async function startRuntime(label) {
  const env = { ...process.env };
  delete env.LUUNA_PI_PROVIDER;
  delete env.LUUNA_PI_MODEL;
  Object.assign(env, {
    LUUNA_API_TOKEN: token,
    LUUNA_DATA_DIR: dataDir,
    LUUNA_PORT: String(port),
    LUUNA_PI_COMMAND: profile.pi,
    LUUNA_PI_ARGS_JSON: JSON.stringify(profile.piArgs),
    LUUNA_RUN_TIMEOUT_SECONDS: String(runTimeoutSeconds),
  });
  // The log is opened once, relative to the held output root, exclusively and without following a
  // link; every chunk is written through that descriptor, so a later swap of the file or the root
  // cannot redirect a write.
  const logFd = openOwnedFile(`runtime-${label}.log`, fsConstants.O_APPEND);
  // Hash the binary immediately before each spawn: a rebuild or replacement during the run must
  // not let a different binary execute a later scenario under the initially recorded identity.
  let binarySha;
  try { binarySha = createHash("sha256").update(readFileSync(runtimeBinary)).digest("hex"); } catch { binarySha = "unreadable"; }
  const child = spawn(runtimeBinary, [], { env, stdio: ["ignore", "ignore", "pipe"] });
  startingRuntime = child;
  // stderr is drained for the child's whole life but retained only as a fixed-size tail in memory
  // and up to RUNTIME_LOG_LIMIT bytes on disk, so a noisy runtime cannot exhaust the heap or fill
  // the output volume before the leak scan and report.
  let stderr = "";
  let logged = 0;
  let spawnError = null;
  child.on("error", (error) => { spawnError = error; });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-RUNTIME_STDERR_TAIL);
    if (typeof logFd !== "number" || logged >= RUNTIME_LOG_LIMIT) return;
    const part = chunk.subarray(0, RUNTIME_LOG_LIMIT - logged);
    try {
      writeSync(logFd, part);
      logged += part.length;
      if (logged >= RUNTIME_LOG_LIMIT) writeSync(logFd, `\n[log truncated at ${RUNTIME_LOG_LIMIT} bytes; later output was drained, not kept]\n`);
    } catch { /* kept as the in-memory tail only */ }
  });
  child.stdioClosed = false;
  child.on("close", () => {
    child.stdioClosed = true;
    if (typeof logFd === "number") { try { closeSync(logFd); } catch { /* already closed */ } }
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    // A child that never spawned or already exited leaves nothing to stop.
    if (spawnError) { startingRuntime = null; throw new Error(`runtime could not be spawned (${spawnError.code ?? spawnError.message}): ${runtimeBinary}`); }
    if (child.exitCode !== null || child.signalCode !== null) { startingRuntime = null; throw new Error(`runtime exited early (${child.exitCode ?? child.signalCode}): ${stderr.trim()}`); }
    try {
      const response = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) {
        const health = await response.json();
        if (label === "initial") {
          evidence.environment.runtime_build_identity = health.build_identity ?? "not reported";
          evidence.environment.runtime_build_rustc = health.build_rustc ?? "not reported";
          evidence.environment.runtime_build_rustc_wrapper = health.build_rustc_wrapper ?? "not reported";
          evidence.environment.runtime_build_rustc_sha256 = health.build_rustc_sha256 ?? "not reported";
          evidence.environment.runtime_build_flags = health.build_flags ?? "not reported";
        }
        record(`runtime ${label} start`, health.status === "ok", `health ${JSON.stringify(health)}`);
        // Hash the image the running process actually executes (Linux: /proc/<pid>/exe, which a
        // replacement of the path cannot redirect and which cannot be written while it runs).
        let runningSha = null;
        try { runningSha = createHash("sha256").update(readFileSync(`/proc/${child.pid}/exe`)).digest("hex"); } catch { /* not available on this platform */ }
        if (label === "initial") {
          evidence.environment.runtime_running_sha256 = runningSha ?? "unavailable on this platform";
          record("runtime initial process executes the hashed binary (running process image)", runningSha === null ? process.platform !== "linux" : runningSha === binarySha && binarySha === evidence.environment.runtime_binary_sha256, runningSha === null ? `process image not readable on ${process.platform}; pre-spawn hash ${binarySha.slice(0, 16)}…` : `running ${runningSha.slice(0, 16)}…, hashed ${binarySha.slice(0, 16)}…`);
        }
        if (label !== "initial") {
          const env0 = evidence.environment;
          const executed = runningSha ?? binarySha;
          record(`runtime ${label} is the same revision-bound binary as the initial start`, executed === env0.runtime_binary_sha256 && (runningSha === null || runningSha === env0.runtime_running_sha256) && health.build_identity === env0.expected_build_identity && health.build_rustc === env0.runtime_build_rustc && health.build_rustc_sha256 === env0.runtime_build_rustc_sha256 && health.build_rustc_wrapper === env0.runtime_build_rustc_wrapper && health.build_flags === env0.runtime_build_flags, `${runningSha === null ? "pre-spawn" : "running"} sha256 ${executed.slice(0, 16)}… (initial ${String(env0.runtime_binary_sha256).slice(0, 16)}…), identity ${health.build_identity === env0.expected_build_identity ? "matches" : "differs"}, rustc ${health.build_rustc}`);
        }
        if (typeof logFd !== "number") record(`runtime ${label} log was created inside the output root`, false, logFd);
        startingRuntime = null;
        return child;
      }
    } catch { /* not yet listening */ }
    await sleep(100);
  }
  // A child that never became healthy is still ours: reap it before failing so
  // no credential-bearing runtime outlives the harness holding the port and data directory.
  child.kill("SIGKILL");
  // If its exit is not observed it stays in startingRuntime, and the final cleanup stops it again
  // and records whether it exited before the leak scan.
  const reaped = await waitForExit(child, 10_000);
  throw new Error(`runtime did not become healthy (${reaped.exited ? "child terminated" : "child exit NOT observed"}): ${stderr.trim()}`);
}

/**
 * Every Git command the harness runs is isolated: no user/system configuration,
 * no inherited hooks, templates or file-system monitor, no inherited GIT_*
 * variables and no provider credentials in the environment of anything Git
 * could execute. Identity is fixed for the fixture commits.
 */
function git(cwd, ...args) {
  const noHooks = path.join(out, "no-hooks");
  mkdirSync(noHooks, { recursive: true });
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("GIT_") || CREDENTIAL_NAMES.includes(name) || name.startsWith("LUUNA_PI_")) continue;
    env[name] = value;
  }
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull, GIT_TEMPLATE_DIR: noHooks, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" });
  const config = ["-c", `core.hooksPath=${noHooks}`, "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false"];
  return execFileSync("git", ["-C", cwd, ...config, ...args], { encoding: "utf8", env }).trim();
}

function createFixtureRepository() {
  // Never adopt an existing directory: a rerun into the same --out, or any
  // pre-existing path, would otherwise commit unrelated files into the fixture.
  mkdirSync(path.dirname(fixtureRepo), { recursive: true });
  // Throwing (not exiting) lets the top-level finally terminate the runtime.
  mkdirSync(fixtureRepo);
  const noHooks = path.join(out, "no-hooks");
  const repo = (...args) => git(fixtureRepo, ...args);
  repo("init", "-q", "-b", "main");
  repo("config", "commit.gpgsign", "false");
  repo("config", "core.hooksPath", noHooks);
  for (const [relative, content] of Object.entries(profile.files)) {
    const target = path.join(fixtureRepo, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  repo("add", ".");
  repo("commit", "-q", "-m", "fixture");
  repo("remote", "add", "origin", "https://example.invalid/m3-smoke.git");
  return repo("rev-parse", "HEAD");
}

async function registerProjectAndBaseline() {
  developerHead = createFixtureRepository();
  const registered = await api("POST", "/projects", { id: PROJECT, name: "M3 smoke", repositories: [{ id: "app", path: fixtureRepo }] });
  record("fixture repository registers as a project", registered.status === 201 || registered.status === 200, `status ${registered.status}`);
  const manifest = {
    schema_version: "0.1", id: PROJECT, name: "M3 smoke", revision: 1,
    repositories: [{ id: "app", remote: "https://example.invalid/m3-smoke.git", default_branch: "main", profiles: ["python"], execution: "native", checks: profile.checks }],
    relationships: [],
    policy: { approval: "plan", testing_prerequisite: true, publish: "automatic_pr", merge: "human", max_explorers: 1, max_implementers: 1, max_task_repairs: 2 },
  };
  const confirmed = await api("PUT", `/projects/${PROJECT}/manifest`, { expected_revision: 0, manifest });
  record("manifest with one required host check is confirmed", confirmed.status === 200, `status ${confirmed.status} ${confirmed.status === 200 ? "" : JSON.stringify(confirmed.body)}`);
  const baseline = await api("POST", `/projects/${PROJECT}/baselines`, { repository_id: "app" });
  if (baseline.status !== 202) throw new Error(`baseline not accepted (${baseline.status}): ${JSON.stringify(baseline.body)}`);
  await waitForRunState(baseline.body.id, ["completed", "failed", "cancelled", "interrupted"], 300_000);
  const baselines = (await api("GET", `/projects/${PROJECT}/baselines`)).body;
  const latest = Array.isArray(baselines) ? baselines[0] : null;
  evidence.baseline = latest ? { id: latest.id, status: latest.status, reason: latest.reason ?? null, results: summarizeResults(latest.results) } : baselines;
  record("baseline ran every configured required check on the fixture repository (real host commands) and passed", latest?.status === "passed" && allRequiredPassed(latest?.results), `status=${latest?.status} results=${JSON.stringify(summarizeResults(latest?.results))}`);
  // Baselines run in the developer checkout by design (M2b) and may leave build
  // output such as __pycache__; everything after this point must add nothing.
  untrackedAfterBaseline = git(fixtureRepo, "status", "--porcelain").split("\n").filter((line) => line.startsWith("??")).sort();
}

async function scenario(name, body) {
  console.log(`\n== ${name}`);
  // The provider credential is handed only to the verified Pi: once the tree or launcher has
  // changed, no further scenario starts a provider session.
  if (piTreeChangedAfter.length > 0) {
    record(`${name}: not started`, false, `the verified Pi tree or launcher changed after ${piTreeChangedAfter.join(", ")}; no further provider session is started`);
    return;
  }
  try {
    await body(name);
  } catch (error) {
    record(`${name}: scenario completed without harness error`, false, error instanceof Error ? error.stack ?? error.message : String(error));
  }
  // Every writer and reviewer the scenario launched ran from the verified Pi tree only if it is
  // still byte-identical afterwards.
  if (!piTreeUnchanged()) piTreeChangedAfter.push(name);
}

/** Ticket → plan → exact-hash approval → implement; returns the settled workflow and its first candidate. */
async function approvedCandidate(name) {
  const spec = profile.scenarios[name];
  const summary = { ticket: null, plan: null, run_id: null };
  evidence.scenarios[name] = summary;
  const created = await api("POST", `/projects/${PROJECT}/tickets`, { idempotency_key: `${name}-${randomBytes(6).toString("hex")}`, title: spec.title, intent: spec.intent, acceptance_criteria: spec.acceptance_criteria, repository_ids: ["app"] });
  if (created.status !== 201) throw new Error(`ticket not created (${created.status}): ${JSON.stringify(created.body)}`);
  summary.ticket = { id: created.body.id, title: spec.title, intent: spec.intent, acceptance_criteria: spec.acceptance_criteria, paths: spec.paths };
  const opened = await api("POST", `/tickets/${created.body.id}/plans`, { task: { repository_id: "app", paths: spec.paths, operations: ["read", "write"] }, budgets: spec.budgets });
  if (opened.status !== 201) throw new Error(`plan not created (${opened.status}): ${JSON.stringify(opened.body)}`);
  const plan = opened.body.plan;
  summary.plan = { id: plan.id, revision: plan.revision, hash: plan.hash, base_commit: plan.base_commits?.app, budgets: plan.budgets };
  summary.run_id = opened.body.run.id;
  const approved = await api("POST", `/plans/${plan.id}/approvals`, { plan_revision: plan.revision, plan_hash: plan.hash, approved_by: "m3-smoke" });
  if (approved.status !== 201 && approved.status !== 200) throw new Error(`approval refused (${approved.status}): ${JSON.stringify(approved.body)}`);
  const implement = await api("POST", `/runs/${summary.run_id}/implement`, { provider: profile.provider, model: profile.model });
  record(`${name}: exact-hash approval admits one scoped writer`, implement.status === 202 && implement.body.state === "implementing", `approve=${approved.status} implement=${implement.status} state=${implement.body?.state ?? JSON.stringify(implement.body)}`);
  if (implement.status !== 202) throw new Error(`implementation refused (${implement.status}): ${JSON.stringify(implement.body)}`);
  const settled = await waitForRunState(summary.run_id, ["validating", "failed", "cancelled", "interrupted", "completed", "paused", "testing_blocked"], (runTimeoutSeconds + 60) * 1000);
  const events = await eventsOf(summary.run_id);
  const spawned = events.find((event) => event.type === "pi.spawned")?.payload;
  summary.writer = {
    settled_state: settled.state,
    pi_version: spawned?.pi_version ?? null,
    tools: spawned?.tools ?? null,
    scope: spawned?.scope ?? null,
    provider_credentials: spawned?.provider_credentials ?? null,
    tool_calls: events.filter((event) => event.type === "pi.tool_execution_start").map((event) => `${event.payload?.toolName}:${event.payload?.args?.path ?? ""}`),
    blocked_tool_calls: events.filter((event) => event.type === "pi.tool_execution_end" && event.payload?.isError).map((event) => truncate(JSON.stringify(event.payload?.result?.content ?? event.payload?.result), 160)),
    summary_text: truncate(assistantText(events), 300),
    failure_reason: settled.state === "validating" ? undefined : events.findLast((event) => event.type.startsWith("run."))?.payload?.reason,
  };
  const view = await api("GET", `/runs/${summary.run_id}/candidate`);
  const candidate = view.body?.evidence?.candidate ?? null;
  summary.candidate_r1 = candidate ? { revision: candidate.revision, hash: candidate.hash, commits: candidate.commits ?? candidate.commit ?? null, plan_hash: candidate.plan_hash } : null;
  record(`${name}: writer settled in validating with a frozen candidate bound to the approved plan`, settled.state === "validating" && candidate?.revision === 1 && candidate?.plan_hash === plan.hash && view.body?.evidence?.status === "pending", `state=${settled.state} revision=${candidate?.revision} status=${view.body?.evidence?.status}${summary.writer.failure_reason ? ` reason=${truncate(summary.writer.failure_reason, 160)}` : ""}`);
  if (settled.state !== "validating" || !candidate) throw new Error(`no candidate to validate: state ${settled.state}`);
  return { summary, plan, view: view.body };
}

async function validate(runId, hash, extra = {}) {
  return api("POST", `/runs/${runId}/validate`, { candidate_hash: hash, provider: profile.provider, model: profile.model, ...extra });
}

async function approvedFeatureIsCheckedAndIndependentlyReviewed(name) {
  const { summary, view } = await approvedCandidate(name);
  const runId = summary.run_id;
  const hash = view.evidence.candidate.hash;
  const diff = await api("GET", `/runs/${runId}/diff`);
  const changed = diffPaths(diff.body?.diff ?? "");
  const approved = profile.scenarios[name].paths;
  summary.diff = { status: diff.status, candidate_hash: diff.body?.candidate_hash, base_commit: diff.body?.base_commit, commit: diff.body?.commit, bytes: diff.body?.diff?.length ?? 0, changed_paths: changed, approved_paths: approved };
  record(`${name}: candidate diff is bound to the exact candidate hash and changes exactly the approved paths`, diff.status === 200 && diff.body.candidate_hash === hash && changed.length > 0 && changed.every((p) => approved.includes(p)) && approved.every((p) => changed.includes(p)), `status=${diff.status} bytes=${summary.diff.bytes} changed=${JSON.stringify(changed)}`);
  const stale = await validate(runId, "sha256:" + "0".repeat(64));
  record(`${name}: validation names the exact candidate; a stale hash is refused`, stale.status === 409 || stale.status === 422, `status ${stale.status} ${truncate(JSON.stringify(stale.body), 120)}`);
  const accepted = await validate(runId, hash);
  record(`${name}: validation of the exact candidate is accepted`, accepted.status === 202, `status ${accepted.status} ${accepted.status === 202 ? "" : JSON.stringify(accepted.body)}`);
  const reviewStarted = await waitForEvent(runId, (event) => event.type === "review.started", (runTimeoutSeconds + 60) * 1000);
  const settled = await candidateSettled(runId);
  const events = await eventsOf(runId);
  const ev = settled.evidence;
  summary.validation = describeEvidence(settled, events, reviewStarted);
  const requiredIds = profile.checks.filter((check) => check.required).map((check) => check.id).sort();
  const observedIds = (ev.results ?? []).map((result) => result.recipe_id).sort();
  record(`${name}: every configured required check ran in the owned worktree and passed before any review`, JSON.stringify(observedIds) === JSON.stringify(requiredIds) && ev.results.every((result) => result.status === "passed") && Boolean(reviewStarted) && events.filter((e) => e.type === "candidate.check_finished").length === requiredIds.length && events.findLastIndex((e) => e.type === "candidate.check_finished") < events.findIndex((e) => e.type === "review.started"), `required=${JSON.stringify(requiredIds)} ${JSON.stringify(summarizeResults(ev.results))}`);
  record(`${name}: a fresh independent reviewer session reviewed the exact candidate`, Boolean(ev.review) && ev.review.candidate_hash === hash && typeof ev.review.reviewer_session === "string" && ev.review.reviewer_session.startsWith("review-") && reviewStarted?.payload?.reviewer_session === ev.review.reviewer_session && ev.review.reviewer_session !== ev.implementer_session, `reviewer=${ev.review?.reviewer_session} implementer=${ev.implementer_session} verdict=${ev.review?.verdict}`);
  record(`${name}: candidate reached reviewed with evidence generation 1 and durable usage`, ev.status === "reviewed" && (await api("GET", `/runs/${runId}`)).body.state === "reviewed" && ev.validation_generation === 1 && ev.cost_usd_micros >= 0 && settled.active === false, `status=${ev.status} generation=${ev.validation_generation} cost_usd_micros=${ev.cost_usd_micros} elapsed_seconds=${ev.elapsed_seconds} reason=${truncate(ev.reason ?? "", 160)}`);
  const again = await validate(runId, hash);
  record(`${name}: a reviewed candidate is not re-validated in place`, again.status !== 202, `status ${again.status}`);
  if (mode === "real") note(name, `real reviewer verdict=${ev.review?.verdict} findings=${JSON.stringify(summarizeFindings(ev.review?.findings))}`);
}

async function failingCheckRequiresManualRepairAndFreshEvidence(name) {
  const { summary, view } = await approvedCandidate(name);
  const runId = summary.run_id;
  const hash1 = view.evidence.candidate.hash;
  const accepted = await validate(runId, hash1);
  record(`${name}: validation of the first candidate is accepted`, accepted.status === 202, `status ${accepted.status}`);
  const first = await candidateSettled(runId);
  const firstEvents = await eventsOf(runId);
  summary.validation_r1 = describeEvidence(first, firstEvents, null);
  const failedCheck = first.evidence.results?.some((result) => result.status === "failed" && typeof result.exit_code === "number" && result.exit_code !== 0);
  if (first.evidence.status === "reviewed") {
    // The seeded failure must happen: a run that skipped repair cannot claim the repair exit.
    record(`${name}: the seeded required-check failure was reproduced`, false, `status=${first.evidence.status}: the writer pre-empted the seeded failure, so failed command, repair admission, revision 2 and fresh evidence were not exercised in this run`);
    return;
  }
  record(`${name}: a failing required check fails the candidate before any review and keeps the run repairable`, first.evidence.status === "failed" && failedCheck && first.evidence.review == null && !firstEvents.some((event) => event.type === "review.started") && first.repair_allowed === true, `status=${first.evidence.status} results=${JSON.stringify(summarizeResults(first.evidence.results))} repair_allowed=${first.repair_allowed}`);
  const refused = await validate(runId, hash1);
  record(`${name}: a failed candidate cannot be re-validated; a new revision is required`, refused.status !== 202, `status ${refused.status}`);
  const repair = await api("POST", `/runs/${runId}/repair`, { candidate_hash: hash1, provider: profile.provider, model: profile.model });
  record(`${name}: manual repair of the exact failed candidate is admitted through the approval gate`, repair.status === 202, `status ${repair.status} ${repair.status === 202 ? "" : JSON.stringify(repair.body)}`);
  if (repair.status !== 202) return;
  const settledRun = await waitForRunState(runId, ["validating", "failed", "cancelled", "interrupted", "paused", "testing_blocked"], (runTimeoutSeconds + 60) * 1000);
  const second = await api("GET", `/runs/${runId}/candidate`);
  const hash2 = second.body?.evidence?.candidate?.hash;
  const repairEvents = await eventsOf(runId);
  summary.repair = {
    run_state: settledRun.state,
    revision: second.body?.evidence?.candidate?.revision,
    hash: hash2,
    repair_started: repairEvents.find((event) => event.type === "candidate.repair_started")?.payload ?? null,
    writer_tool_calls: repairEvents.filter((event) => event.type === "pi.tool_execution_start").slice(summary.writer.tool_calls.length).map((event) => `${event.payload?.toolName}:${event.payload?.args?.path ?? ""}`),
  };
  record(`${name}: repair produced candidate revision 2 with a new hash and pending evidence`, settledRun.state === "validating" && second.body?.evidence?.candidate?.revision === 2 && typeof hash2 === "string" && hash2 !== hash1 && second.body.evidence.status === "pending" && second.body.evidence.validation_generation === 0, `state=${settledRun.state} revision=${second.body?.evidence?.candidate?.revision} status=${second.body?.evidence?.status}`);
  const oldHash = await validate(runId, hash1);
  record(`${name}: the superseded revision's hash no longer validates`, oldHash.status === 409 || oldHash.status === 422, `status ${oldHash.status}`);
  const accepted2 = await validate(runId, hash2);
  record(`${name}: validation of revision 2 is accepted`, accepted2.status === 202, `status ${accepted2.status}`);
  const reviewStarted = await waitForEvent(runId, (event) => event.type === "review.started", (runTimeoutSeconds + 60) * 1000);
  const final = await candidateSettled(runId);
  const finalEvents = await eventsOf(runId);
  summary.validation_r2 = describeEvidence(final, finalEvents, reviewStarted);
  const ev = final.evidence;
  const requiredCount = profile.checks.filter((check) => check.required).length;
  const r2Checks = finalEvents.filter((event) => event.type === "candidate.check_finished" && event.payload?.candidate_hash === hash2).length;
  record(`${name}: revision 2 earned fresh evidence for every required check plus a fresh review and reached reviewed`, ev.candidate.hash === hash2 && allRequiredPassed(ev.results) && r2Checks === requiredCount && ev.validation_generation === 1 && Boolean(ev.review) && ev.review.candidate_hash === hash2 && ev.status === "reviewed" && ev.results.every((result) => !first.evidence.results.some((old) => old.id === result.id)), `status=${ev.status} verdict=${ev.review?.verdict} results=${JSON.stringify(summarizeResults(ev.results))} reason=${truncate(ev.reason ?? "", 120)}`);
  const attempts = (await api("GET", `/runs/${runId}/attempts`)).body;
  summary.attempts = Array.isArray(attempts) ? attempts.map((attempt) => ({ number: attempt.number, state: attempt.state })) : attempts;
  record(`${name}: two writer attempts are durably recorded against the shared budget`, Array.isArray(attempts) && attempts.length === 2, `attempts=${JSON.stringify(summary.attempts)}`);
  if (mode === "real") note(name, `real repair reviewer verdict=${ev.review?.verdict} findings=${JSON.stringify(summarizeFindings(ev.review?.findings))}`);
}

async function blockingFindingsAreBoundedByAutomaticRepair(name) {
  const { summary, view } = await approvedCandidate(name);
  const runId = summary.run_id;
  const hash1 = view.evidence.candidate.hash;
  const accepted = await validate(runId, hash1, { auto_repair: true });
  record(`${name}: validation with bounded automatic repair is accepted`, accepted.status === 202, `status ${accepted.status}`);
  const final = await candidateSettled(runId, (runTimeoutSeconds * 4 + 120) * 1000);
  const events = await eventsOf(runId);
  const ev = final.evidence;
  const reviews = events.filter((event) => event.type === "candidate.review_finished");
  const repairs = events.filter((event) => event.type === "candidate.repair_started");
  summary.outcome = describeEvidence(final, events, events.find((event) => event.type === "review.started"));
  summary.outcome.reviews_finished = reviews.length;
  summary.outcome.automatic_repairs = repairs.length;
  summary.outcome.run_state = (await api("GET", `/runs/${runId}`)).body.state;
  const blocking = ev.review?.findings?.some((finding) => finding.severity === "blocking");
  if (mode === "fixture") {
    record(`${name}: blocking findings never pass; automatic repair stops at the attempt budget and pauses with evidence`, ev.status === "paused" && summary.outcome.run_state === "paused" && ev.candidate.revision === 2 && ev.review?.verdict === "changes_required" && blocking && final.repair_allowed === false && /attempt/.test(ev.reason ?? "") && repairs.length === 1 && reviews.length === 2, `status=${ev.status} revision=${ev.candidate.revision} verdict=${ev.review?.verdict} repairs=${repairs.length} reviews=${reviews.length} reason=${truncate(ev.reason ?? "", 160)}`);
    return;
  }
  // Automatic repair only follows `changes_required` and stops when the repair
  // writer produces no fresh candidate; a `blocked` verdict pauses at once.
  // A reviewer that passes the unmet requirement observed nothing; only a non-passing verdict with bounded repair counts.
  // The gate must be closed, with the reason that matches the observed revision: a
  // second revision means the attempt budget was spent, a first revision means the
  // repair writer produced no fresh candidate.
  const reason = ev.reason ?? "";
  const gateClosed = final.repair_allowed === false && ev.status === "paused";
  const consistent = allRequiredPassed(ev.results) && gateClosed && (
    (ev.review?.verdict === "changes_required" && repairs.length === 1 && (
      (ev.candidate.revision === 2 && /attempt 3 exceeds max_attempts 2/.test(reason))
      || (ev.candidate.revision === 1 && /no fresh candidate/.test(reason))))
    || (blocking && ev.review?.verdict === "blocked" && ev.candidate.revision === 1 && repairs.length === 0)
  );
  record(`${name}: the real reviewer did not pass the unmet requirement and bounded automatic repair stopped within max_attempts=2`, consistent, `status=${ev.status} revision=${ev.candidate.revision} verdict=${ev.review?.verdict} blocking=${blocking} repair_allowed=${final.repair_allowed} repairs=${repairs.length} reviews=${reviews.length} reason=${truncate(ev.reason ?? "", 160)}`);
  note(name, ev.review?.verdict && ev.review.verdict !== "passed"
    ? `the real reviewer did not pass the out-of-scope README requirement (verdict=${ev.review.verdict}, blocking finding=${blocking}): ${JSON.stringify(summarizeFindings(ev.review?.findings))}`
    : `the real reviewer passed the candidate despite the unmet README requirement (verdict=${ev.review?.verdict}); the scenario failed because no non-passing verdict was observed`);
}

async function cancellationDuringReviewPreservesChecks(name) {
  const { summary, view } = await approvedCandidate(name);
  const runId = summary.run_id;
  const hash = view.evidence.candidate.hash;
  const accepted = await validate(runId, hash);
  record(`${name}: validation is accepted`, accepted.status === 202, `status ${accepted.status}`);
  const reviewStarted = await waitForEvent(runId, (event) => event.type === "review.started", (runTimeoutSeconds + 60) * 1000);
  const pid = reviewStarted?.payload?.pid;
  const aliveBefore = typeof pid === "number" && processAlive(pid);
  const before = await api("GET", `/runs/${runId}/candidate`);
  const cancel = await api("POST", `/runs/${runId}/cancel`);
  const settled = await candidateSettled(runId);
  const events = await eventsOf(runId);
  const aliveAfter = typeof pid === "number" && processAlive(pid);
  const ev = settled.evidence;
  summary.cancellation = { ...describeEvidence(settled, events, reviewStarted), reviewer_pid: pid, status_when_cancelled: before.body?.evidence?.status, active_when_cancelled: before.body?.active, cancel_status: cancel.status, reviewer_alive_before: aliveBefore, reviewer_alive_after: aliveAfter };
  record(`${name}: cancel reached an in-flight independent review`, Boolean(reviewStarted) && before.body?.active === true && cancel.status === 202, `status_when_cancelled=${before.body?.evidence?.status} active=${before.body?.active} cancel=${cancel.status}`);
  record(`${name}: cancelled candidate keeps its identity and every passed required check, has no review and is not repairable`, ev.status === "cancelled" && ev.candidate.hash === hash && allRequiredPassed(ev.results) && ev.review == null && /cancelled/.test(ev.reason ?? "") && settled.repair_allowed === false && (await api("GET", `/runs/${runId}`)).body.state === "cancelled", `status=${ev.status} reason=${truncate(ev.reason ?? "", 120)} repair_allowed=${settled.repair_allowed}`);
  record(`${name}: owned reviewer child was alive before cancel and reaped before the candidate settled`, aliveBefore && !aliveAfter, `pid=${pid} alive_before=${aliveBefore} alive_after=${aliveAfter}`);
  const again = await validate(runId, hash);
  record(`${name}: a cancelled candidate is not re-validated`, again.status !== 202, `status ${again.status}`);
}

async function hardKillDuringReviewReservesSpend(name) {
  const earlier = {};
  for (const [label, item] of Object.entries(evidence.scenarios)) if (item.run_id && label !== name) earlier[item.run_id] = JSON.stringify((await api("GET", `/runs/${item.run_id}/candidate`)).body);
  const { summary, view, plan } = await approvedCandidate(name);
  const runId = summary.run_id;
  const hash = view.evidence.candidate.hash;
  const accepted = await validate(runId, hash);
  record(`${name}: validation is accepted`, accepted.status === 202, `status ${accepted.status}`);
  const reviewStarted = await waitForEvent(runId, (event) => event.type === "review.started", (runTimeoutSeconds + 60) * 1000);
  const pid = reviewStarted?.payload?.pid;
  const before = await api("GET", `/runs/${runId}/candidate`);
  const costBefore = before.body?.evidence?.cost_usd_micros ?? 0;
  runtime.kill("SIGKILL");
  const killed = await waitForExit(runtime, 10_000);
  // A runtime whose exit is not observed may still own the port and the output tree: the scenario
  // fails here and `runtime` keeps the old handle, so the final cleanup stops it again.
  record(`${name}: the hard-killed runtime exited before the restart`, killed.exited, killed.exited ? "exit observed" : "exit NOT observed within 10s");
  if (!killed.exited) throw new Error("the hard-killed runtime did not exit; restart not attempted");
  // The synthetic reviewer holds for 60s without reading stdin, so only a real Pi child can notice the closed pipe promptly.
  const childExit = await waitUntil(() => typeof pid !== "number" || !processAlive(pid), mode === "fixture" ? 75_000 : 20_000);
  // A PID alone cannot prove ownership once the runtime is gone, so an orphan is
  // reported (and fails the check below) rather than killed by a possibly recycled PID.
  const orphaned = typeof pid === "number" && processAlive(pid);
  runtime = await startRuntime("restarted");
  const after = await candidateSettled(runId);
  const events = await eventsOf(runId);
  const ev = after.evidence;
  let preserved = true;
  for (const [id, snapshot] of Object.entries(earlier)) preserved &&= JSON.stringify((await api("GET", `/runs/${id}/candidate`)).body) === snapshot;
  summary.restart = { ...describeEvidence(after, events, reviewStarted), reviewer_pid: pid, status_before_kill: before.body?.evidence?.status, cost_usd_micros_before_kill: costBefore, reviewer_exited_after_ms: childExit.elapsed, reviewer_orphaned: orphaned, earlier_candidates_compared: Object.keys(earlier).length, approved_cost_budget: plan.budgets?.cost_usd_micros };
  record(`${name}: restart marks the in-flight review interrupted and preserves the frozen candidate and every passed required check`, before.body?.evidence?.status === "reviewing" && ev.status === "interrupted" && (await api("GET", `/runs/${runId}`)).body.state === "interrupted" && ev.candidate.hash === hash && allRequiredPassed(ev.results) && ev.review == null && ev.validation_generation === 1, `before=${before.body?.evidence?.status} after=${ev.status} generation=${ev.validation_generation}`);
  record(`${name}: unknown provider spend is reserved against the approved cost budget and re-validation is refused`, /unreported provider spend/.test(ev.reason ?? "") && ev.cost_usd_micros > costBefore && (await validate(runId, hash)).status !== 202 && /budget/.test((await validate(runId, hash)).body?.error ?? ""), `cost_before=${costBefore} cost_after=${ev.cost_usd_micros} budget=${plan.budgets?.cost_usd_micros} reason=${truncate(ev.reason ?? "", 160)}`);
  record(`${name}: reviewer child exits after the runtime is hard-killed (stdin closed)`, typeof pid === "number" && childExit.satisfied && !orphaned, `pid=${pid} exited_after_ms=${childExit.elapsed} observed_exit=${childExit.satisfied} orphaned=${orphaned}`);
  record(`${name}: earlier candidate evidence survives the restart byte-for-byte`, preserved && Object.keys(earlier).length >= 3, `earlier_candidates_compared=${Object.keys(earlier).length}`);
}

async function developerCheckoutUntouched() {
  const head = git(fixtureRepo, "rev-parse", "HEAD");
  const tracked = git(fixtureRepo, "status", "--porcelain", "--untracked-files=no");
  const untracked = git(fixtureRepo, "status", "--porcelain").split("\n").filter((line) => line.startsWith("??")).sort();
  const worktrees = Object.values(evidence.scenarios).map((item) => item.run_id).filter(Boolean);
  const untrackedUnchanged = JSON.stringify(untracked) === JSON.stringify(untrackedAfterBaseline ?? []);
  evidence.developer_checkout = { head_before: developerHead, head_after: head, tracked_changes: tracked, untracked_after_baseline: untrackedAfterBaseline, untracked_after_runs: untracked, runs: worktrees.length };
  record("developer checkout HEAD, tracked content and untracked files are untouched by every writer, check, repair and review", head === developerHead && tracked === "" && untrackedUnchanged, `head=${head.slice(0, 12)} tracked_changes=${JSON.stringify(tracked)} untracked_after_baseline=${JSON.stringify(untrackedAfterBaseline)} untracked_after_runs=${JSON.stringify(untracked)}`);
}

async function gracefulShutdown() {
  if (process.platform === "win32") {
    // Node's kill() terminates unconditionally on Windows, so this harness cannot
    // deliver a console control event and does not claim an orderly Windows shutdown.
    note("shutdown", "orderly shutdown is not established on Windows by this harness; the runtime was terminated");
    runtime.kill();
    await waitForExit(runtime, 15_000);
    return;
  }
  const signal = "SIGTERM";
  runtime.kill(signal);
  const exit = await waitForExit(runtime, 15_000);
  record(`${signal} performs an orderly shutdown`, exit.exited && runtime.exitCode === 0, `exited=${exit.exited} code=${runtime.exitCode} after ${exit.elapsed}ms`);
  if (!exit.exited) runtime.kill("SIGKILL");
}

// ---------------------------------------------------------------------------

async function api(method, route, body) {
  const response = await fetch(`${base}/api/v1${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed };
}

async function eventsOf(id) {
  const { body } = await api("GET", `/runs/${id}/events?after=0`);
  return Array.isArray(body) ? body : [];
}

async function waitForRunState(id, states, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await api("GET", `/runs/${id}`);
    if (states.includes(body.state)) return body;
    await sleep(200);
  }
  throw new Error(`run ${id} did not reach ${states.join("/")} within ${timeoutMs}ms`);
}

async function candidateSettled(id, timeoutMs = (runTimeoutSeconds * 2 + 120) * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await api("GET", `/runs/${id}/candidate`);
    if (body?.active === false && body.evidence && !["pending", "validating", "reviewing"].includes(body.evidence.status)) return body;
    await sleep(200);
  }
  throw new Error(`candidate of ${id} did not settle within ${timeoutMs}ms: ${JSON.stringify((await api("GET", `/runs/${id}/candidate`)).body)}`);
}

async function waitForEvent(id, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await eventsOf(id);
    const found = events.find(predicate);
    if (found) return found;
    const { body } = await api("GET", `/runs/${id}/candidate`);
    if (body?.active === false && body.evidence && !["pending", "validating", "reviewing"].includes(body.evidence.status)) return null;
    await sleep(100);
  }
  return null;
}

function describeEvidence(view, events, reviewStarted) {
  const ev = view.evidence ?? {};
  return {
    status: ev.status,
    active: view.active,
    repair_allowed: view.repair_allowed,
    candidate: ev.candidate ? { revision: ev.candidate.revision, hash: ev.candidate.hash } : null,
    implementer_session: ev.implementer_session,
    validation_generation: ev.validation_generation,
    elapsed_seconds: ev.elapsed_seconds,
    cost_usd_micros: ev.cost_usd_micros,
    reason: ev.reason ?? null,
    results: summarizeResults(ev.results),
    review: ev.review ? { id: ev.review.id, reviewer_session: ev.review.reviewer_session, candidate_hash: ev.review.candidate_hash, verdict: ev.review.verdict, findings: summarizeFindings(ev.review.findings), evidence: (ev.review.evidence ?? []).map((item) => truncate(item, 200)) } : null,
    review_started: reviewStarted ? { reviewer_session: reviewStarted.payload?.reviewer_session, candidate_hash: reviewStarted.payload?.candidate_hash } : null,
    // The reviewer's own transcript is not persisted in the run stream; only its verdict, findings and evidence are.
    event_types: events.map((event) => event.type),
  };
}

/** True only when one passed result exists for each configured required recipe and nothing else. */
function allRequiredPassed(results) {
  const required = profile.checks.filter((check) => check.required).map((check) => check.id).sort();
  const observed = (Array.isArray(results) ? results : []).map((result) => result.recipe_id).sort();
  return JSON.stringify(observed) === JSON.stringify(required) && results.every((result) => result.status === "passed");
}

/** Every path a unified diff touches, from its `diff --git` headers; /dev/null never counts. */
function diffPaths(text) {
  const paths = new Set();
  for (const line of String(text).split("\n")) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) { paths.add(header[1]); paths.add(header[2]); continue; }
    const side = /^(?:---|\+\+\+) (?:a|b)\/(.+)$/.exec(line);
    if (side) paths.add(side[1]);
  }
  return [...paths].filter((p) => p !== "dev/null").sort();
}

function summarizeResults(results) {
  return (Array.isArray(results) ? results : []).map((result) => ({ id: result.id, recipe_id: result.recipe_id, status: result.status, exit_code: result.exit_code ?? null, tests_detected: result.tests_detected ?? null, reason: result.reason ?? null, artifacts: result.artifact_refs?.length ?? 0 }));
}

function summarizeFindings(findings) {
  return (Array.isArray(findings) ? findings : []).map((finding) => ({ severity: finding.severity, path: finding.path, line: finding.line, explanation: truncate(finding.explanation, 240) }));
}

function assistantText(events) {
  let finalText = "";
  for (const event of events) {
    const message = event.payload?.message;
    if (event.type === "pi.message_end" && message?.role === "assistant" && Array.isArray(message.content)) {
      finalText = message.content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
    }
  }
  return finalText;
}

/** The live children of `pid` as /proc lists them (every thread's list). */
function childrenOf(pid) {
  const found = [];
  for (const task of readdirSync(`/proc/${pid}/task`)) {
    try { found.push(...readFileSync(`/proc/${pid}/task/${task}/children`, "utf8").split(/\s+/).filter(Boolean).map(Number)); } catch { /* thread gone */ }
  }
  return found;
}

/**
 * Kills every process of the run still alive once the runtime has stopped: the harness's own
 * children and everything reparented to the child subreaper the harness runs under. A killed
 * process's children are reparented to the reaper in turn, so this repeats until neither has a
 * child left. Every PID found here is a descendant of the run, so none can be a recycled stranger.
 */
async function reapStrays() {
  if (process.platform !== "linux") return { contained: false, killed: 0, reason: "no child subreaper on this platform" };
  const reaper = Number(process.env.LUUNA_M3_REAPER);
  if (!Number.isInteger(reaper) || reaper !== process.ppid) return { contained: false, killed: 0, reason: "the harness is not running under its child subreaper" };
  const killed = new Set();
  const deadline = Date.now() + 15_000;
  for (;;) {
    let survivors;
    try { survivors = [...childrenOf(reaper), ...childrenOf(process.pid)].filter((pid) => pid !== process.pid); } catch (error) { return { contained: false, killed: killed.size, reason: `cannot list processes: ${error.code ?? error.message}` }; }
    if (survivors.length === 0) return { contained: true, killed: killed.size };
    if (Date.now() > deadline) return { contained: false, killed: killed.size, reason: `${survivors.length} process(es) still present after 15s` };
    for (const pid of survivors) {
      try { process.kill(pid, "SIGKILL"); killed.add(pid); } catch { /* already gone */ }
    }
    await sleep(50);
  }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

/**
 * A runtime is settled only once it has exited and its stdio has closed: Node may still deliver
 * queued stderr after 'exit', and only 'close' guarantees the log writer has seen the last chunk.
 */
function settled(child) {
  return (child.exitCode !== null || child.signalCode !== null) && child.stdioClosed !== false;
}

async function waitForExit(child, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (settled(child)) return { exited: true, elapsed: Date.now() - startedAt };
    await sleep(50);
  }
  return { exited: false, elapsed: Date.now() - startedAt };
}

async function waitUntil(predicate, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return { satisfied: true, elapsed: Date.now() - startedAt };
    await sleep(50);
  }
  return { satisfied: false, elapsed: Date.now() - startedAt };
}


/**
 * The Luuna checkout's revision and whether any tracked, untracked or index-flagged path differs
 * from it; taken before the run and again after every native process has stopped.
 */
function checkoutState() {
  const state = {};
  try { state.git_revision = git(repository, "rev-parse", "HEAD"); } catch { state.git_revision = "unknown"; }
  try {
    const status = git(repository, "status", "--porcelain", "--untracked-files=all");
    // `git status` hides changes to paths marked assume-unchanged (lower-case tag) or skip-worktree
    // (tag S), so any such flag counts as a possible modification.
    const hidden = git(repository, "ls-files", "-v").split("\n").filter((line) => /^[a-zS] /.test(line)).map((line) => `${line.slice(2)} (index flag ${line[0]})`);
    state.git_dirty = status.length > 0 || hidden.length > 0;
    if (state.git_dirty) state.git_dirty_paths = [...status.split("\n").filter(Boolean).map((line) => line.replace(/^\s*\S{1,2}\s+/, "")), ...hidden].slice(0, 10).join(", ");
  } catch { state.git_dirty = null; }
  return state;
}

function environment() {
  const info = { platform: `${platform()} ${release()} ${arch()}`, node: process.version, pi_launcher: profile.pi, pi_launcher_args: profile.piArgs, provider: profile.provider, model: profile.model, required_check: profile.checks.map((check) => [check.executable, ...check.args.map((arg) => truncate(arg, 40))].join(" ")) };
  Object.assign(info, checkoutState());
  try { info.python_version = execFileSync(python, ["--version"], { encoding: "utf8" }).trim(); } catch (error) { info.python_version = `unavailable: ${error.message}`; }
  if (mode === "real") {
    try { info.pi_version = execFileSync(profile.pi, [...profile.piArgs, "--version"], { encoding: "utf8" }).trim(); } catch (error) { info.pi_version = `unavailable: ${error.message}`; }
    info.pi_provenance = piProvenance();
  } else {
    info.pi_version = "synthetic fixture reporting 1.3.0";
  }
  info.provider_credentials_present = CREDENTIAL_NAMES.filter((name) => process.env[name] !== undefined || process.env[`LUUNA_PI_${name}`] !== undefined).map((name) => process.env[`LUUNA_PI_${name}`] !== undefined ? `LUUNA_PI_${name} (alias)` : name);
  try { info.runtime_binary_sha256 = createHash("sha256").update(readFileSync(runtimeBinary)).digest("hex"); } catch { info.runtime_binary_sha256 = "unknown"; }
  // The Cargo config files Cargo reads for this workspace, checked now as well as by build.rs at
  // build time: `paths`, `[patch]` and source `replace-with` substitute dependencies, `[profile]`
  // changes compiled behavior, and `include` pulls in config that is not read here.
  info.cargo_dependency_overrides = (() => {
    const candidates = [];
    for (let dir = repository; ; dir = path.dirname(dir)) {
      candidates.push(path.join(dir, ".cargo", "config"), path.join(dir, ".cargo", "config.toml"));
      if (path.dirname(dir) === dir) break;
    }
    const home = process.env.CARGO_HOME ?? (process.env.HOME ? path.join(process.env.HOME, ".cargo") : null);
    if (home) candidates.push(path.join(home, "config"), path.join(home, "config.toml"));
    return candidates.filter((file) => {
      let text;
      try { text = readFileSync(file, "utf8"); } catch { return false; }
      // The same lexical, fail-closed rule as build.rs: any of these names as a whole key token
      // anywhere (table header, dotted, inline or quoted key, or a mere mention), or any
      // backslash, since an escape in a quoted key can spell any name.
      return text.includes("\\") || /(?<![A-Za-z0-9_-])(paths|include|replace-with|patch|profile|rustc|linker)(?![A-Za-z0-9_-])/.test(text);
    });
  })();
  // Bind the binary to the recorded revision by content: the runtime reports the digest its
  // build script computed over every build input, which must equal the digest of the inputs in
  // this checkout, and those inputs must equal the recorded revision (no modified or untracked
  // build input). Timestamps play no part.
  try { info.expected_build_identity = buildIdentity(); } catch (error) { info.expected_build_identity = `unavailable: ${error.message}`; }
  try { info.runtime_sources_dirty = git(repository, "status", "--porcelain", "--", "crates/*/src/*", "crates/*/assets/*", "crates/*/Cargo.toml", "crates/*/build.rs", "Cargo.toml", "Cargo.lock").length > 0; } catch { info.runtime_sources_dirty = null; }
  return info;
}

/**
 * SHA-256 over every entry of a tree (relative path with the file's SHA-256 or the link target),
 * sorted; returns { digest, entries }. Bounded so a malformed tree fails closed: files are hashed
 * in streamed chunks and the walk stops with an error past the entry, byte or depth limit.
 */
function treeDigest(root) {
  const LIMITS = { entries: 100_000, bytes: 1024 * 1024 * 1024, depth: 64 };
  const entries = [];
  // Every directory entry counts against the limit, directories included, so a tree of empty
  // directories is bounded as well.
  let visited = 0;
  let bytes = 0;
  const chunk = Buffer.alloc(1024 * 1024);
  const hashFile = (file) => {
    const hash = createHash("sha256");
    const fd = openSync(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
    try {
      if (!fstatSync(fd).isFile()) throw new Error(`${file} is not a regular file`);
      for (let read = readSync(fd, chunk, 0, chunk.length, null); read > 0; read = readSync(fd, chunk, 0, chunk.length, null)) {
        bytes += read;
        if (bytes > LIMITS.bytes) throw new Error(`tree exceeds ${LIMITS.bytes} bytes`);
        hash.update(chunk.subarray(0, read));
      }
    } finally { closeSync(fd); }
    return hash.digest("hex");
  };
  const walkTree = (rel, depth) => {
    if (depth > LIMITS.depth) throw new Error(`tree nests deeper than ${LIMITS.depth} levels`);
    const listing = opendirSync(path.join(root, rel));
    try {
      for (let entry = listing.readSync(); entry !== null; entry = listing.readSync()) {
        const child = rel ? `${rel}/${entry.name}` : entry.name;
        if (++visited > LIMITS.entries) throw new Error(`tree has more than ${LIMITS.entries} entries`);
        if (entry.isDirectory()) walkTree(child, depth + 1);
        else if (entry.isSymbolicLink()) entries.push(`${child}\0link\0${readlinkSync(path.join(root, child))}`);
        else entries.push(`${child}\0${hashFile(path.join(root, child))}`);
      }
    } finally { listing.closeSync(); }
  };
  walkTree("", 0);
  entries.sort();
  return { digest: createHash("sha256").update(entries.join("\n")).digest("hex"), entries };
}

/**
 * Binds the real Pi to published bytes instead of its self-reported version: the launcher and the
 * entrypoint are hashed, the entrypoint's package must be the version pinned in the tracked
 * tools/pi/package-lock.json, and the whole installed node_modules tree (Pi and every dependency)
 * must be byte-identical to a fresh `npm ci` of that lockfile, which verifies each tarball's
 * integrity. The tree is re-hashed after every scenario (see `piTreeUnchanged`).
 */
function piProvenance() {
  const result = { verified: false };
  const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
  try {
    const launcher = existsSync(profile.pi) ? profile.pi : execFileSync("sh", ["-c", 'command -v "$1"', "sh", profile.pi], { encoding: "utf8" }).trim();
    result.launcher = { path: realpathSync(launcher), sha256: sha(realpathSync(launcher)) };
    const entry = profile.piArgs.find((arg) => existsSync(arg) && statSync(arg).isFile()) ?? launcher;
    result.entrypoint = { path: realpathSync(entry), sha256: sha(realpathSync(entry)) };
    const lock = JSON.parse(readFileSync(path.join(repository, "tools", "pi", "package-lock.json"), "utf8"));
    const pinned = lock.packages?.["node_modules/@earendil-works/pi-coding-agent"];
    let root = path.dirname(result.entrypoint.path);
    while (!(existsSync(path.join(root, "package.json")) && JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).name === "@earendil-works/pi-coding-agent")) {
      if (path.dirname(root) === root) throw new Error("the entrypoint is not inside the @earendil-works/pi-coding-agent package");
      root = path.dirname(root);
    }
    const installed = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    const marker = `${path.sep}node_modules${path.sep}`;
    result.package = { root, version: installed.version, pinned_version: pinned?.version, pinned_integrity: pinned?.integrity, node_modules: path.join(root.slice(0, root.lastIndexOf(marker)), "node_modules") };
    if (!pinned || installed.version !== pinned.version) throw new Error(`installed ${installed.version} is not the pinned ${pinned?.version}`);
    // A fresh install of the tracked lockfile, outside the output tree; npm verifies every
    // tarball against the lockfile's integrity, and the installed tree must match it byte for byte.
    // The fresh install is the trust root, so npm is not looked up on PATH (where a shim could
    // install the same altered bytes): it is the npm bundled with the Node installation running
    // this harness, run by that same Node executable. No other tool is resolved through PATH here.
    const npmCli = process.platform === "win32"
      ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
      : path.join(path.dirname(path.dirname(process.execPath)), "lib", "node_modules", "npm", "bin", "npm-cli.js");
    if (!existsSync(npmCli)) throw new Error(`no npm bundled with ${process.execPath} (expected ${npmCli})`);
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !CREDENTIAL_NAMES.includes(name) && !name.startsWith("LUUNA_PI_")));
    result.npm = { node: process.execPath, cli: realpathSync(npmCli), version: execFileSync(process.execPath, [npmCli, "--version"], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() };
    const work = realpathSync(mkdtempSync(path.join(tmpdir(), "luuna-pi-provenance-")));
    try {
      for (const file of ["package.json", "package-lock.json"]) writeFileSync(path.join(work, file), readFileSync(path.join(repository, "tools", "pi", file)));
      execFileSync(process.execPath, [npmCli, "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: work, env, stdio: ["ignore", "ignore", "pipe"] });
      const expected = treeDigest(path.join(work, "node_modules"));
      const actual = treeDigest(result.package.node_modules);
      result.package.tree_entries = actual.entries.length;
      result.package.tree_digest = actual.digest;
      if (actual.digest !== expected.digest) {
        const want = new Set(expected.entries);
        const have = new Set(actual.entries);
        const differing = [...new Set([...expected.entries.filter((x) => !have.has(x)), ...actual.entries.filter((x) => !want.has(x))].map((x) => x.split("\0")[0]))];
        throw new Error(`installed Pi tree differs from a fresh install of tools/pi/package-lock.json: ${differing.slice(0, 5).join(", ")}`);
      }
      result.verified = true;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  } catch (error) {
    result.error = String(error?.message ?? error).split("\n")[0];
  }
  return result;
}

/** Re-hashes the verified Pi tree and launcher; false when either changed since verification. */
function piTreeUnchanged() {
  const pi = evidence.environment?.pi_provenance;
  if (mode !== "real" || !pi?.verified) return true;
  try {
    return treeDigest(pi.package.node_modules).digest === pi.package.tree_digest && createHash("sha256").update(readFileSync(pi.launcher.path)).digest("hex") === pi.launcher.sha256;
  } catch { return false; }
}

/** The exact release `rust-toolchain.toml` pins, or null when it pins none (a channel name is not a release). */
function pinnedToolchain() {
  try {
    const channel = /^\s*channel\s*=\s*"([^"]+)"/m.exec(readFileSync(path.join(repository, "rust-toolchain.toml"), "utf8"))?.[1];
    return channel && /^\d+\.\d+\.\d+$/.test(channel) ? channel : null;
  } catch { return null; }
}

/**
 * SHA-256 of the pinned toolchain's own `rustc` executable, located by rustup independently of any
 * Cargo configuration, or a reason it is unavailable.
 */
function pinnedRustcSha256(pinned) {
  if (pinned === null) return "unavailable: no pinned release";
  try {
    const located = execFileSync("rustup", ["which", "rustc", "--toolchain", pinned], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 }).trim();
    return createHash("sha256").update(readFileSync(located)).digest("hex");
  } catch (error) { return `unavailable: ${error.code ?? "rustup could not locate the pinned rustc"}`; }
}

/** The digest `crates/luuna-runtime/build.rs` embeds: SHA-256 over `path\0sha256(content)\n` for every build input, sorted by path. */
function buildIdentity() {
  const files = ["Cargo.toml", "Cargo.lock"];
  const collect = (rel) => {
    let entries;
    try { entries = readdirSync(path.join(repository, rel), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) collect(child); else if (entry.isFile()) files.push(child);
    }
  };
  for (const member of readdirSync(path.join(repository, "crates"), { withFileTypes: true })) {
    if (!member.isDirectory()) continue;
    for (const file of ["Cargo.toml", "build.rs"]) {
      try { if (lstatSync(path.join(repository, "crates", member.name, file)).isFile()) files.push(`crates/${member.name}/${file}`); } catch { /* absent */ }
    }
    collect(`crates/${member.name}/src`);
    collect(`crates/${member.name}/assets`);
  }
  files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const digest = createHash("sha256");
  for (const file of files) digest.update(`${file}\0${createHash("sha256").update(readFileSync(path.join(repository, file))).digest("hex")}\n`);
  return `sha256:${digest.digest("hex")}`;
}

/** Configured values, deduplicated and longest first: redacting a shorter value that is part of a
 *  longer one first would leave the longer one's remainder in the clear. */
function configuredValues() {
  const raw = [token, ...CREDENTIAL_NAMES.flatMap((name) => [process.env[name], process.env[`LUUNA_PI_${name}`]])].filter((value) => typeof value === "string" && value.length > 0);
  // A value with quotes, backslashes or control characters appears JSON-escaped in reports and
  // logs, so the escaped form is scanned for and redacted as well.
  const values = raw.flatMap((value) => [value, JSON.stringify(value).slice(1, -1)]).filter((value) => value.length > 0);
  return [...new Set(values)].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

function redactConfiguredValues(text) {
  const values = configuredValues();
  let output = String(text);
  for (const value of values) output = output.split(value).join("[redacted credential]");
  // The marker itself, or a marker boundary, can reproduce a value (`redacted`, `]k`): delete any
  // value still present until none is. Each deletion shortens the text, so this terminates.
  for (let hit = values.find((value) => output.includes(value)); hit !== undefined; hit = values.find((value) => output.includes(value))) {
    output = output.split(hit).join("");
  }
  return output;
}

/** Scan everything the harness wrote (report, runtime logs, durable state including managed worktrees and artifacts) for configured credential values; the values themselves are never recorded. */
function scanForCredentialValues() {
  const values = configuredValues();
  const unreadable = [];
  const leaking = [];
  let leaks = 0;
  let scannedBytes = 0;
  let scannedFiles = 0;
  let visited = 0;
  let incomplete = false;
  const nameHit = (text) => values.some((value) => text.includes(value));
  // A directory is { fd } (held handle) or { path } (fallback); `rel` is relative to the output root.
  const childPath = (dir, name) => (dir.fd !== undefined ? heldPath(dir.fd, name) : path.join(dir.path, name));
  // Recursion holds one call frame and one directory descriptor per level: nesting deeper than
  // SCAN_DEPTH_LIMIT is not descended into and marks the walk incomplete, which fails the run
  // and clears the output root, instead of overflowing the stack before quarantine can run.
  const walk = (dir, rel, depth = 0) => {
    let listing;
    try { listing = opendirSync(dir.fd !== undefined ? heldPath(dir.fd) : dir.path); } catch { unreadable.push(rel || "."); return; }
    try {
      for (let entry = listing.readSync(); entry !== null; entry = listing.readSync()) {
        const relative = rel ? path.join(rel, entry.name) : entry.name;
        // Every visited entry counts against the budget while walking, so a tree of millions of
        // files stops the walk instead of exhausting memory; the unvisited remainder fails the scan.
        visited += 1;
        if (visited > SCAN_FILE_COUNT_LIMIT || scannedBytes >= SCAN_TOTAL_LIMIT) { incomplete = true; if (rel) unreadable.push(rel); return; }
        // Every file under the owned output tree is scanned, the fixture checkout and Git metadata
        // included; entry names and symbolic-link targets are metadata that can carry a value too.
        if (nameHit(relative)) { leaks += 1; leaking.push(relative); }
        const target = childPath(dir, entry.name);
        if (entry.isSymbolicLink()) {
          let link;
          try { link = readlinkSync(target); } catch { unreadable.push(relative); continue; }
          if (nameHit(link)) { leaks += 1; leaking.push(relative); }
        } else if (entry.isDirectory()) {
          if (dir.fd !== undefined) {
            // Descend through a handle opened without following: an entry swapped for a link is
            // refused by the open itself and reported, never traversed.
            if (depth + 1 > SCAN_DEPTH_LIMIT) { incomplete = true; unreadable.push(relative); return; }
            let fd;
            try { fd = openHeldDir(target); } catch { unreadable.push(relative); continue; }
            try { walk({ fd }, relative, depth + 1); } finally { closeSync(fd); }
          } else {
            let current;
            try { current = lstatSync(target); } catch { unreadable.push(relative); continue; }
            if (depth + 1 > SCAN_DEPTH_LIMIT) { incomplete = true; unreadable.push(relative); return; }
            if (current.isDirectory()) walk({ path: target }, relative, depth + 1); else unreadable.push(relative);
          }
          if (incomplete) return;
        } else if (entry.isFile()) {
          try {
            const result = fileContainsAny(target, values, SCAN_TOTAL_LIMIT - scannedBytes);
            scannedBytes += result.bytes;
            scannedFiles += 1;
            if (result.hit) { leaks += 1; leaking.push(relative); }
          } catch (error) {
            // Bytes read before a failure (a file that grew, a read error) still count.
            scannedBytes += error?.bytesRead ?? 0;
            unreadable.push(relative);
          }
        } else {
          unreadable.push(relative);
        }
      }
    } finally {
      listing.closeSync();
    }
  };
  walk(outFd !== null ? { fd: outFd } : { path: out }, "");
  // The in-memory report is checked before it is written; its hit is recorded as a flag,
  // never as a path, so a filesystem entry that happens to be named "report" is still a
  // path to quarantine.
  const reportText = JSON.stringify(evidence) + markdown({ ...evidence, verdict: "" });
  const reportLeaks = values.some((value) => reportText.includes(value));
  if (reportLeaks) leaks += 1;
  if (incomplete) leaks += 1;
  // A file that could not be scanned is not evidence of anything; it fails the scan.
  return { values_checked: values.length, held_handles: outFd !== null, entries_visited: visited, traversal_incomplete: incomplete, files_scanned: scannedFiles, scanned_bytes: scannedBytes, unreadable_files: unreadable, leaks: leaks + unreadable.length, report_leaks: reportLeaks, leaking_files: [...new Set(leaking)] };
}

/** Why a quarantine target cannot safely be touched, or null: the output root must still be the
 *  pinned directory (same device, inode and real path, not a link) and every component between it
 *  and the target must be a real directory, so no removal can be redirected outside the tree. */
function unpinnedReason(target) {
  let root;
  try { root = lstatSync(out); } catch { return "the output directory is gone"; }
  if (root.isSymbolicLink() || !root.isDirectory() || root.dev !== outIdentity.dev || root.ino !== outIdentity.ino) return "the output directory was replaced";
  try { if (realpathSync(out) !== outIdentity.real) return "the output directory's real path changed"; } catch { return "the output directory's real path cannot be resolved"; }
  let current = out;
  for (const part of path.relative(out, path.dirname(target)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = lstatSync(current); } catch { return `${path.relative(out, current)} vanished`; }
    if (stat.isSymbolicLink() || !stat.isDirectory()) return `${path.relative(out, current)} is no longer a real directory`;
  }
  return null;
}

/** Deletes every flagged or unscannable file plus the durable state and verifies each is gone; returns what was removed and what was not. */
function quarantineLeaks(scan) {
  // An incomplete walk leaves unvisited entries at every level up to the root, which cannot be
  // listed without walking again: everything under the output root is removed instead.
  if (scan.traversal_incomplete) return clearOutputRoot();
  const targets = [...scan.leaking_files, ...scan.unreadable_files];
  if (targets.length === 0) return { removed: [], failed: [] };
  // Without directory-relative, non-following handles a path-based unlink can be redirected by a
  // root renamed and replaced with a link between check and use: nothing is deleted, and every
  // target is reported as still present, which fails the run.
  if (outFd === null) return { removed: [], failed: [...new Set([...targets, "data"])].map((entry) => `${entry} (not touched: destructive cleanup needs held directory handles on this platform)`) };
  const removed = [];
  const failed = [];
  // Presence is judged without following links: a dangling symlink is still an entry to
  // remove, and only ENOENT means absent; any other lookup error means "possibly still there".
  const present = (target) => { try { lstatSync(target); return true; } catch (error) { return error?.code !== "ENOENT"; } };
  const budget = removalBudget();
  for (const entry of new Set([...targets, "data"])) {
    const parts = entry.split(path.sep).filter(Boolean);
    if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) { failed.push(`${entry} (not a path inside the output directory)`); continue; }
    // Every parent component is opened without following, relative to the held root, so neither
    // a renamed root nor a component replaced by a link can redirect the removal.
    const opened = [];
    let parentFd = outFd;
    let refused = null;
    let gone = false;
    for (const part of parts.slice(0, -1)) {
      try { parentFd = openHeldDir(heldPath(parentFd, part)); opened.push(parentFd); }
      catch (error) { if (error?.code === "ENOENT") gone = true; else refused = `${part} is not a real directory`; break; }
    }
    try {
      if (gone) { removed.push(entry); continue; }
      const target = heldPath(parentFd, parts.at(-1));
      let error = null;
      for (let attempt = 0; !refused && attempt < 5 && present(target); attempt += 1) {
        try {
          const stat = lstatSync(target);
          if (attempt > 0) {
            // A file a lingering process still holds, or one with stripped permissions: make it
            // writable and blank its contents so the value is gone even if unlinking fails, then
            // retry. Nothing here follows a link: a symlink is unlinked as a link, a hard-linked
            // file is never blanked, and every open is non-following and judged on its handle.
            if (stat.isSymbolicLink()) {
              unlinkSync(target);
            } else if (stat.isDirectory()) {
              const fd = openHeldDir(target);
              try { fchmodSync(fd, 0o700); } finally { closeSync(fd); }
            } else if (stat.isFile() && fsConstants.O_NOFOLLOW !== undefined) {
              const fd = openSync(target, fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW);
              try {
                const handle = fstatSync(fd);
                if (handle.isFile() && handle.nlink === 1) { fchmodSync(fd, 0o600); ftruncateSync(fd, 0); }
              } finally { closeSync(fd); }
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * attempt);
          }
          removeHeld(parentFd, parts.at(-1), budget);
          error = null;
        } catch (caught) { error = caught; }
      }
      if (refused) failed.push(`${entry} (not touched: ${refused})`);
      else if (present(target)) failed.push(`${entry}${error ? ` (${error.message})` : ""}`);
      else removed.push(entry);
    } finally {
      for (const fd of opened) closeSync(fd);
    }
  }
  return { removed, failed };
}

/** Removes every entry under the output root through the held root handle, listing in bounded batches. */
function clearOutputRoot() {
  if (outFd === null) return { removed: [], failed: ["output root (traversal incomplete; clearing it needs held directory handles on this platform)"] };
  let removed = 0;
  const failed = new Set();
  const budget = removalBudget();
  // Stop once the shared budget is spent; failed names are skipped, so each pass makes progress.
  for (let batch = listHeld(outFd, 1000, failed); batch.length > 0 && budget.left > 0; batch = listHeld(outFd, 1000, failed)) {
    for (const name of batch) {
      try { removeHeld(outFd, name, budget); removed += 1; } catch { failed.add(name); }
    }
  }
  const remaining = listHeld(outFd, 1001).length;
  return { removed: [`${removed} entries under the output root (traversal incomplete)`], failed: remaining === 0 ? [] : [`${remaining > 1000 ? "more than 1000" : remaining} entries under the output root${failed.size ? ` (first: ${[...failed].slice(0, 5).join(", ")})` : ""}`] };
}

/** Streams a file through a sliding window so a value spanning two chunks is still found; bounded by size, growth and the remaining aggregate budget. Returns `{ hit, bytes }`. */
function fileContainsAny(file, values, remainingBudget) {
  // A non-following open cannot be guaranteed without O_NOFOLLOW (Windows): such a file is
  // unscannable rather than opened through a possible replacement link.
  if (fsConstants.O_NOFOLLOW === undefined) throw new Error("no non-following open on this platform");
  if (values.length === 0) return { hit: false, bytes: 0 };
  // Compare UTF-8 bytes, not decoded text, so a value with non-ASCII characters is found.
  const needles = values.map((value) => Buffer.from(value, "utf8"));
  const overlap = Math.max(...needles.map((needle) => needle.length)) - 1;
  // Open without following a link and without blocking, then judge the opened
  // handle: a FIFO or device swapped into the path is a scan failure, not a hang.
  const fd = openSync(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | (fsConstants.O_NONBLOCK ?? 0));
  let total = 0;
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) throw new Error("not a regular file");
    if (opened.size > SCAN_FILE_LIMIT) throw new Error(`exceeds the ${SCAN_FILE_LIMIT} byte scan limit`);
    if (opened.size > remainingBudget) throw new Error("exceeds the remaining aggregate scan budget");
    const chunk = Buffer.alloc(1024 * 1024);
    let carry = Buffer.alloc(0);
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) return { hit: false, bytes: total };
      total += read;
      // A file that keeps growing past its opened size is unscannable, not a hang.
      if (total > opened.size + chunk.length) throw new Error("grew while being scanned");
      if (total > remainingBudget) throw new Error("exceeds the remaining aggregate scan budget");
      const window = Buffer.concat([carry, chunk.subarray(0, read)]);
      if (needles.some((needle) => window.indexOf(needle) !== -1)) return { hit: true, bytes: total };
      carry = overlap > 0 ? Buffer.from(window.subarray(Math.max(0, window.length - overlap))) : Buffer.alloc(0);
    }
  } catch (error) {
    // The caller charges what was read against the aggregate budget even when the scan fails.
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { bytesRead: total });
  } finally {
    closeSync(fd);
  }
}

// Live output passes through the same redactor as the report: a provider or
// runtime message that echoes a configured value never reaches the terminal.
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(redactConfiguredValues(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`));
}

function note(scenarioName, text) {
  notes.push({ scenario: scenarioName, note: text });
  console.log(redactConfiguredValues(`NOTE  ${scenarioName}: ${text}`));
}

/** Redacts before cutting so a configured value straddling the cut never survives as a fragment. */
function truncate(value, length = 200) {
  const text = redactConfiguredValues(String(value ?? ""));
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function markdown(report) {
  const lines = [
    `# Luuna M3 smoke report (${report.mode} mode)`,
    "",
    `Verdict: **${report.verdict}**`,
    "",
    `Started ${report.started_at}, finished ${report.finished_at}. Runtime binary \`${report.runtime_binary}\`, port ${report.port}.`,
    "",
    "## Environment",
    "",
    ...Object.entries(report.environment ?? {}).map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`),
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "| --- | --- | --- |",
    ...report.checks.map((check) => `| ${check.ok ? "pass" : "FAIL"} | ${escape(check.name)} | ${escape(check.detail ?? "")} |`),
    "",
    "## Notes (best-effort observations that do not decide the verdict)",
    "",
    ...(report.notes?.length ? report.notes.map((item) => `- ${item.scenario}: ${escape(item.note)}`) : ["- none"]),
    "",
    "## Baseline",
    "",
    "```json", JSON.stringify(report.baseline ?? null, null, 2), "```",
    "",
    "## Scenarios",
    "",
  ];
  for (const [label, item] of Object.entries(report.scenarios ?? {})) {
    lines.push(`### ${label}`, "", "```json", JSON.stringify(item, null, 2), "```", "");
  }
  lines.push("## Developer checkout", "", "```json", JSON.stringify(report.developer_checkout ?? null, null, 2), "```", "");
  return lines.join("\n");
}

function escape(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) fail(`unexpected argument ${argument}`);
    const key = argument.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) { parsed[key] = true; } else { parsed[key] = next; index += 1; }
  }
  return parsed;
}

function fail(message) {
  console.error(`m3-smoke: ${message}`);
  process.exit(2);
}
