# MVP walkthrough: one repository from import to a reviewed candidate

Date: 2026-10-21. This is the representative single-repository workflow another developer follows end to end with the browser client, without editing the database or inventing data. `node scripts/mvp-ui-smoke.mjs` automates exactly these steps against the synthetic Pi fixture and records the result; a real provider follows the same steps with real model output. Read [AI-START-HERE.md](../AI-START-HERE.md) for the pins and [CURRENT-ARCHITECTURE.md](CURRENT-ARCHITECTURE.md) for what each step may and may not claim.

What the walkthrough does not cover is listed in [MVP-EVIDENCE.md](MVP-EVIDENCE.md): no publication or merge, one repository, no TUI, no memory integration, and no native Mac/Windows proof.

## 0. Prerequisites

- Rust 1.90.0, Node 24.19.0 with npm 11.9.0, Python 3, Git, and the pinned Pi 1.3.0 installed from `tools/pi` (`bash scripts/setup-cloud.sh` on the cloud image; [CONTRIBUTING.md](../CONTRIBUTING.md) elsewhere). `npm ci --ignore-scripts` at the root.
- A provider credential for a real run, exported as `LUUNA_PI_<PROVIDER>_API_KEY` (for example `LUUNA_PI_OPENROUTER_API_KEY`) in the shell that starts the runtime. Never type it into the client. For a credential-free rehearsal use the synthetic fixture: `LUUNA_PI_COMMAND=python3 LUUNA_PI_ARGS_JSON='["<repo>/fixtures/pi-rpc/mock_pi.py"]'`; its runs are protocol evidence only.
- A repository to import with a test command that can pass on this host. The fixture used below is a small Python package with `python -m unittest -v`.

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

"Discover proposed map" proposes check recipes from the repository's manifests with evidence and confidence; nothing is executed. Edit the proposed manifest JSON so `checks` holds the commands the project really runs (for the fixture, `python -m unittest -v`, `required: true`), then "Confirm manifest". The facts line reads "revision 1" with the exact base commit, and the ticket form becomes enabled.

## 3. Establish the baseline (M2b)

"Run baseline" executes the confirmed required recipes on the clean developer checkout through the supervised executor and lists the record: status, manifest revision, exact commit, and each recipe's status and exit code. The baseline must be `passed` before any writer can start; a failed, blocked or empty suite blocks feature work, and the record says which recipe and why. A dirty checkout is blocked until it is clean.

## 4. Ticket, plan and exact approval (M2c)

Create a ticket with a title, the intent and one acceptance criterion per line. "Plan" records immutable plan revision 1 bound to the ticket revision, the manifest hash, the base commit, the required checks and the budgets, and opens the workflow run in `plan ready`. The complete plan JSON and its full `sha256:` hash are shown; the "Approve r1" button stays disabled until the acknowledgment checkbox is checked (Space toggles it, Enter approves). Approval binds to that exact hash; the run becomes `approved`.

## 5. Implement in a Luuna-owned worktree

"Implement" revalidates the approval, ticket revision, manifest, base commit, passed baseline and host fingerprint, leases a detached worktree under the data directory, and runs the pinned Pi writer with file tools and the scope guard. The ticket shows `implementing`, then `validating` with the worktree path and the candidate section: revision 1, the candidate hash, the commit and tree. "Inspect candidate diff" shows the exact diff bound to that hash. The developer checkout is untouched throughout.

A writer that makes no in-scope change, or changes a path outside the approved task, fails closed with the reason shown under the ticket and a next step (re-plan with the paths the change needs).

## 6. Validate and review (M3)

"Validate and review" runs the required recipes inside the candidate worktree, records each result with its command, environment fingerprint, exit code, artifact hashes and detected test count, and only then starts a fresh read-only Pi reviewer with the requirements, diff and check evidence. While active, the candidate section says what the runtime is doing and offers "Cancel workflow"; an idle candidate has nothing to cancel.

Outcomes, all decided by the runtime from recorded evidence:

- `reviewed`: every required check passed and the reviewer's structured verdict is `passed`. The verdict, reviewer session and findings are shown; "View stdout" and "View stderr" open each check's log by record identity.
- `paused` with a `changes_required` or `blocked` verdict: read the findings, then "Repair candidate" (a new scoped writer under the same approval, which produces candidate revision 2 with fresh checks and review) or create the next plan revision. Tick "Repair automatically within approved budgets" before validating to let the runtime repair bounded failures itself; it stops at the attempt budget and pauses with the evidence.
- `failed` with a failed required check: open the log, then repair.
- `failed` with "invalid structured reviewer response" (or another reviewer failure that left no verdict) after passed checks: "Re-validate and review" starts a fresh validation generation of the same candidate under the same approval and budgets; no writer attempt is spent. The panel explains this next to the reason.
- `testing blocked`: a required check could not run meaningfully on this host (missing tool, empty suite). Fix the recipe or the host, run a new baseline, then plan again.

Every reason shown under a ticket or candidate carries the next allowed action.

## 7. Recovery: outage, restart and shutdown

Stop the runtime at any point (Ctrl+C or SIGTERM for an orderly stop; a crash or `kill -9` for a hard one). The header switches to "Reconnecting to runtime" and the connection panel says that runs, candidates and worktrees are durable and nothing is lost. Start the runtime again with the same data directory and token: the client reconnects by itself, reloads every panel, and the work that was in flight is shown as `interrupted` with the recorded reason:

- A check or review interrupted by a hard kill or by an orderly shutdown keeps its candidate; "Validate and review" runs a fresh generation (new check records, a fresh reviewer) of the same revision. The orderly path records "interrupted by runtime shutdown"; a hard kill records "runtime restarted before attempt settled".
- A review interrupted mid-turn reserves the remaining approved cost budget, because the provider's spend is unknown. Re-validation is then refused with "budget exhausted"; create the next plan revision to continue.
- A writer interrupted mid-session keeps its worktree (files preserved, lease released) but the attempt is void; create the next plan revision and implement again.
- A baseline interrupted mid-run is recorded as `interrupted`; run it again.

Closing or reloading the browser never cancels anything; reopening the client replays the durable event record from the last sequence. "Disconnect" clears the token from memory and shows the runtime as offline; the runtime keeps running.

## 8. What "done" means here

A `reviewed` candidate is evidence for its exact frozen commit and tree, under one approved plan revision: the required checks passed in the owned worktree and an independent reviewer found no blocking issue. It is a local commit in a Luuna-owned worktree, inspectable with Git at the path shown; publishing it, opening a pull request and merging stay with the developer until M7. The evidence survives client disconnects, runtime restarts and shutdowns, and nothing in the client can mark a candidate reviewed.

## Reproducing this walkthrough automatically

```sh
node scripts/mvp-ui-smoke.mjs --out /tmp/luuna-ui-smoke
```

The harness builds the runtime, starts it with the synthetic Pi fixture and a random token, starts the Vite client, and drives headless Chromium through steps 1 to 7 on two generated fixture repositories, including a wrong token, a refused registration, an invalid review followed by re-validation, a hard kill and an orderly shutdown during checks, a hard kill during review with the budget refusal, keyboard operation of every control it touches, an accessibility audit of the rendered pages and the final disconnect. It writes `report.md`, `report.json` and screenshots to the output directory. It is synthetic: the writer and reviewer are the fixture, so it proves the client and the runtime lifecycle, never a model.
