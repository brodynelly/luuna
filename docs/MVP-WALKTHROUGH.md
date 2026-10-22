# MVP walkthrough: one repository from import to a reviewed candidate

Date: 2026-10-21. This is the representative single-repository workflow another developer follows end to end with the browser client, without editing the database or inventing data. `node scripts/mvp-ui-smoke.mjs` automates exactly these steps against the synthetic Pi fixture and records the result; a real provider follows the same steps with real model output. Read [AI-START-HERE.md](../AI-START-HERE.md) for the pins and [CURRENT-ARCHITECTURE.md](CURRENT-ARCHITECTURE.md) for what each step may and may not claim.

What the walkthrough does not cover is listed in [MVP-EVIDENCE.md](MVP-EVIDENCE.md): no publication or merge, one repository, no TUI, no memory integration, and no native Mac/Windows proof.

## 0. Prerequisites

- Rust 1.90.0, Node 24.19.0 with npm 11.9.0, Python 3, Git, and the pinned Pi 1.3.0 installed from `tools/pi` (`bash scripts/setup-cloud.sh` on the cloud image; [CONTRIBUTING.md](../CONTRIBUTING.md) elsewhere). `npm ci --ignore-scripts` at the root.
- A provider credential for a real run, exported as `LUUNA_PI_<PROVIDER>_API_KEY` (for example `LUUNA_PI_OPENROUTER_API_KEY`) in the shell that starts the runtime. Never type it into the client. Without a credential, rehearse with the synthetic fixture as described in [the credential-free rehearsal](#credential-free-rehearsal-with-the-synthetic-fixture); its runs are protocol evidence only.
- A repository to import with a test command that can pass on this host. The fixture used below is a small Python package with `python -m unittest -v`.

### Credential-free rehearsal with the synthetic fixture

`fixtures/pi-rpc/mock_pi.py` stands in for Pi. It is not a model: it acts only on `fixture:<name>` markers in the ticket's acceptance criteria, and its writer only ever rewrites `src/main.py` (to print one line). Without a marker the writer changes nothing and the workflow fails with "writer settled without changing any file". Start the runtime of step 1 with these settings instead of a provider:

```sh
export LUUNA_PI_COMMAND=python3
export LUUNA_PI_ARGS_JSON="[\"$PWD/fixtures/pi-rpc/mock_pi.py\"]"   # run from the Luuna checkout
export LUUNA_PI_PROVIDER=test LUUNA_PI_MODEL=synthetic
```

Import a repository whose tests still pass after that rewrite, for example:

```sh
mkdir -p /tmp/luuna-rehearsal/src && cd /tmp/luuna-rehearsal
git init -q -b main && git remote add origin https://example.invalid/rehearsal.git
printf '__pycache__/\n' > .gitignore
printf '[project]\nname = "rehearsal"\n' > pyproject.toml
printf "print('fixture')\n" > src/main.py
cat > test_main.py <<'PY'
import subprocess, sys, unittest

class MainTest(unittest.TestCase):
    def test_main_prints(self):
        completed = subprocess.run([sys.executable, "src/main.py"], capture_output=True, text=True, check=True)
        self.assertTrue(completed.stdout.strip())
PY
git add -A && git commit -qm "rehearsal fixture"
```

Then follow the steps below with the manifest check `python3 -m unittest -v` (`required: true`), keep `src` in the writer paths, and put a marker on its own line in the acceptance criteria. The first `fixture:` marker selects the writer; the reviewer answers the first `fixture:review_*` marker and passes otherwise:

- `fixture:write_in_scope`: the writer rewrites `src/main.py` and the review passes, so the candidate reaches `reviewed`.
- `fixture:review_malformed_once`: the writer does the same, the first review is malformed and the next one passes, which rehearses re-validation (step 6).
- `fixture:review_blocking`: the review returns `changes_required` with a blocking finding, which rehearses repair.
- `fixture:review_hold`: the reviewer waits 60 s, long enough to cancel or stop the runtime mid-review (step 7).
- `fixture:slow`: the writer waits 60 s, long enough to cancel it from the ticket (step 5).
- `fixture:no_change` and `fixture:write_out_of_scope`: the writer fails closed with the no-change or scope reason and its next step.

## 1. Start the runtime, then the client

```sh
export LUUNA_API_TOKEN="$(openssl rand -hex 32)"      # private; at least 32 bytes
export LUUNA_DATA_DIR="$HOME/.luuna"                   # SQLite, worktrees and private artifacts
export LUUNA_PI_PROVIDER=openrouter LUUNA_PI_MODEL=openai/gpt-4.1   # or set them per action in the client
cargo run --locked -p luuna-runtime                    # listens on http://127.0.0.1:4242
```

In a second shell, `npm run dev` and open `http://127.0.0.1:1420`. Press Tab once: the first stop is "Skip to main content". Enter the runtime URL and the token in the connection form and press Enter. The header reads "Local runtime connected"; the token field disappears and the token is kept only in memory.

If the token is wrong the alert says so and names the next step: check the `LUUNA_API_TOKEN` the service was started with and connect again.

## 2. Import the repository (M2a)

In Projects, enter a name, a repository ID (`app`) and the absolute path of the checkout, then "Register repository". The runtime inspects the checkout read-only (optional locks off, hooks neutralised) and shows the redacted remote, the HEAD commit, the branch and the dirty counts. A path that is not a repository root is refused with the runtime's reason ("Registration refused: …").

"Discover proposed map" proposes check recipes from the repository's manifests with evidence and confidence; nothing is executed. Edit the proposed manifest JSON so `checks` holds the commands the project really runs (for the fixture, `python -m unittest -v`, `required: true`), then "Confirm manifest". The facts line reads "revision 1" with the exact base commit, and the ticket form becomes enabled. A draft the runtime cannot read (a misspelled or missing field, or a quoted `"true"`) is refused with the runtime's reason naming the field. A confirmed proposal is spent: run Discover again for the next revision's draft; a stale draft is refused as a revision conflict with that next step.

If the checkout moved or its remote changed on purpose, open "Rebind repository" under the facts, enter the new root path (or leave it empty to re-inspect the registered one), tick the confirmation and rebind. The runtime re-inspects the checkout read-only and records the old and new identity; plans, baselines and approvals stay bound to exact commits, and a manifest whose remote no longer matches must be confirmed again. Every identity-mismatch refusal names this control as the recovery.

## 3. Establish the baseline (M2b)

"Run baseline" executes the confirmed required recipes on the clean developer checkout through the supervised executor and lists the record: status, manifest revision, exact commit, and each recipe's status and exit code. "View unit stdout" and "View unit stderr" open each recipe's log by record identity. The baseline must be `passed` before any writer can start; a failed, blocked or empty suite blocks feature work, and the record says which recipe and why, with the next step (a missing tool or dependency asks for a dependency-preparation recipe such as `npm ci` before the tests). A dirty checkout is blocked until it is clean. "Cancel baseline" stops a running baseline; a second baseline for the same repository waits until the first settles. A baseline run that fails before it records anything (for example a changed repository identity) shows the reason from its final event.

## 4. Ticket, plan and exact approval (M2c)

Create a ticket with a title, the intent and one acceptance criterion per line. Each field shows its size in UTF-8 bytes, as the runtime counts it (a title takes at most 200 bytes, the intent and each criterion 16,000), so accented letters, CJK text and emoji count more than once.

Set the budgets for the next plan revision in the run settings: writer attempts (1 to 10, default 2), the time budget (1 to 86,400 seconds, default 600) and the cost budget (up to $1,000, default $1.00). Time and cost are cumulative across the whole workflow: the writer, every required check, the independent review and each repair spend from the same budget, so a suite that takes eight minutes needs more than the 600-second default. "Plan" records immutable plan revision 1 bound to the ticket revision, the manifest hash, the base commit, the required checks and those budgets, and opens the workflow run in `plan ready`; the plan line repeats the budgets. Retrying "Plan" after a lost answer replays the same revision instead of creating another. The complete plan JSON and its full `sha256:` hash are shown; the "Approve r1" button stays disabled until the acknowledgment checkbox is checked (Space toggles it, Enter approves). Approval binds to that exact hash; the run becomes `approved`.

"Plan r2" stays disabled, with the reason beside it, while revision 1's writer, checks or review are running: a new revision would leave that work unreachable, so cancel it first to re-plan sooner. While revision 1 is approved, its candidate waits for validation, or it is reviewed, "Plan r2" first asks you to confirm what the new revision leaves behind (a pending candidate can then no longer be validated). Earlier revisions stay listed on the ticket with their final state.

## 5. Implement in a Luuna-owned worktree

"Implement" revalidates the approval, ticket revision, manifest, base commit, passed baseline and host fingerprint, leases a detached worktree under the data directory, and runs the pinned Pi writer with file tools and the scope guard. The ticket shows `implementing` with a line saying the writer runs and a "Cancel workflow" button, then `validating` with the worktree path and the candidate section: revision 1, the candidate hash, the commit and tree. "Inspect candidate diff" shows the exact diff bound to that hash. The developer checkout is untouched throughout. If another workflow's writer holds the repository, Implement is refused with that reason and the next step (wait for it or cancel it).

A writer that makes no in-scope change, or changes a path outside the approved task, fails closed with the reason shown under the ticket and a next step (re-plan with the paths the change needs).

## 6. Validate and review (M3)

"Validate and review" runs the required recipes inside the candidate worktree, records each result with its command, environment fingerprint, exit code, artifact hashes and detected test count, and only then starts a fresh read-only Pi reviewer with the requirements, diff and check evidence. While active, the candidate section says what the runtime is doing and offers "Cancel workflow"; an idle candidate has nothing to cancel.

Outcomes, all decided by the runtime from recorded evidence:

- `reviewed`: every required check passed and the reviewer's structured verdict is `passed`. The verdict, reviewer session and findings are shown; "View stdout" and "View stderr" open each check's log by record identity.
- `paused` with a `changes_required` or `blocked` verdict: read the findings, then "Repair candidate" (a new scoped writer under the same approval, which produces candidate revision 2 with fresh checks and review) or create the next plan revision. Tick "Repair automatically within approved budgets" before validating to let the runtime repair bounded failures itself; it stops at the attempt budget and pauses with the evidence.
- `failed` with a failed required check: open the log, then repair.
- `failed` with "invalid structured reviewer response" (or another reviewer failure that left no verdict) after passed checks: "Re-validate and review" starts a fresh validation generation of the same candidate under the same approval and budgets; no writer attempt is spent. The panel explains this next to the reason.
- `testing blocked`: a required check could not run meaningfully on this host (missing tool, empty suite). Fix the recipe or the host, run a new baseline, then plan again.

Every reason shown under a ticket or candidate carries the next allowed action, and never one the runtime would refuse: when repair or validation is not available (for example because the attempt budget is spent), the candidate says so with the runtime's reason and names the next plan revision instead. The usage line shows the whole workflow against its approved budgets: writer attempts, seconds, cost and repairs.

## 7. Recovery: outage, restart and shutdown

Stop the runtime at any point (Ctrl+C or SIGTERM for an orderly stop; a crash or `kill -9` for a hard one). The header switches to "Reconnecting to runtime" and the connection panel says that runs, candidates and worktrees are durable and nothing is lost. While the runtime is stopping it refuses new work with "runtime is shutting down" and the next step. Start the runtime again with the same data directory and token (step 1's `openssl` line makes a new token, so reuse the exported value): the client reconnects by itself, reloads every panel, and the work that was in flight is shown as `interrupted` with the recorded reason. If the runtime comes back with a different token, the client stops reconnecting and shows the connection form with "The service rejected this token"; enter the current token.

- A check or review interrupted by a hard kill or by an orderly shutdown keeps its candidate; "Validate and review" runs a fresh generation (new check records, a fresh reviewer) of the same revision. The orderly path records "interrupted by runtime shutdown"; a hard kill records "runtime restarted before attempt settled".
- A review interrupted mid-turn reserves the remaining approved cost budget, because the provider's spend is unknown. Validation is then not available: the candidate says so with the runtime's budget reason and names the next plan revision (a runtime that does not report its decisions refuses the click with the same reason).
- A writer interrupted mid-session keeps its worktree (files preserved, lease released) but the attempt is void; create the next plan revision and implement again.
- A baseline interrupted mid-run is recorded as `interrupted`; run it again.

Closing or reloading the browser never cancels anything; reopening the client replays the durable event record from the last sequence. "Disconnect" clears the token from memory and shows the runtime as offline; the runtime keeps running.

## 8. What "done" means here

A `reviewed` candidate is evidence for its exact frozen commit and tree, under one approved plan revision: the required checks passed in the owned worktree and an independent reviewer found no blocking issue. It is a local commit in a Luuna-owned worktree, inspectable with Git at the path shown; publishing it, opening a pull request and merging stay with the developer until M7. The evidence survives client disconnects, runtime restarts and shutdowns, and nothing in the client can mark a candidate reviewed.

## Reproducing this walkthrough automatically

```sh
node scripts/mvp-ui-smoke.mjs --out /tmp/luuna-ui-smoke
```

The harness builds the runtime, starts it with the synthetic Pi fixture and a random token, starts the Vite client, and drives headless Chromium through steps 1 to 7 on two generated fixture repositories, including a wrong token, a refused registration, an unreadable manifest draft, baseline logs, a plan with chosen budgets, cancelling the first writer from its ticket while the next revision is held back, an invalid review followed by re-validation, a hard kill and an orderly shutdown during checks, a hard kill during review with the budget refusal, keyboard operation of every control it touches, an accessibility audit of the rendered pages, a presentation audit (WCAG AA contrast against painted backgrounds in the dark and light schemes, scheme following, no horizontal scroll at the 760 px window minimum) and the final disconnect. It writes `report.md`, `report.json` and screenshots to the output directory. It is synthetic: the writer and reviewer are the fixture, so it proves the client and the runtime lifecycle, never a model.
