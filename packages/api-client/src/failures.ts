import { ApiError } from "./index.ts";
import type { BaselineStatus } from "./index.ts";

/**
 * Shared failure explanations for every Luuna client (desktop and TUI). The runtime decides every
 * state, permission, reason and next step; this module only turns a failure into the same
 * developer-facing sentence everywhere (R02, A33).
 */

/**
 * Developer-facing text for a failed request. The runtime's short deterministic
 * reasons pass through; transport failures and status codes become plain
 * sentences; a raw server body is never shown.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return "The runtime no longer has this record. Refresh the panel.";
    if (error.status === 429) return "The runtime already has four active runs. Wait for one to finish or cancel it.";
    // A stopping runtime names itself (`runtime is shutting down`); other 5xx stay generic.
    if (error.status === 503 && error.fromRuntime) return error.message;
    if (error.status >= 500) return `The runtime reported an internal error (HTTP ${error.status}). Check its log, then retry.`;
    return error.message;
  }
  if (error instanceof DOMException && error.name === "AbortError") return "The request was abandoned before the runtime answered.";
  if (error instanceof TypeError) return "The runtime did not answer. Start the service, or check its address and that it is still running; this panel reconnects by itself once it answers.";
  return error instanceof Error && error.message ? error.message : "The runtime could not be reached.";
}

/** The candidate actions the runtime currently admits, and why it refuses the others. */
export interface AllowedActions {
  validate?: boolean;
  revalidate?: boolean;
  repair?: boolean;
  reasons?: { validate?: string | null; revalidate?: string | null; repair?: string | null };
}

type Action = "validate" | "revalidate" | "repair";

// Reasons whose next step is the same wherever they are recorded.
const IDENTITY = /identity changed|registered checkout .* no longer exists|no longer matches the regist/;
const MISSING_TOOL = /exit code 127|command not found|command `[^`]*` was not found|missing dependency|cannot start (?!pi:|the scope guard)/;
const DIRTY = /dirty|uncommitted/;
const BASELINE_RUNNING = /baseline run .* is already running|baseline .* already running/;
const ACTION_NAMES: Record<Action, string> = { validate: "Validation", revalidate: "Re-validation", repair: "Repair" };

interface Step {
  match: RegExp;
  step: string;
  /** The action `step` recommends; when the runtime refuses it, `otherwise` is shown with its reason. */
  requires?: Action;
  otherwise?: string;
}

const REPLAN = "Create the next plan revision to continue.";

// First match wins, so specific reasons precede the generic words they contain.
const STEPS: Step[] = [
  { match: /rejected this token/, step: "Check the LUUNA_API_TOKEN value the service was started with, then connect again." },
  { match: /did not answer|could not be reached/, step: "" },
  { match: /shutting down/, step: "The runtime is stopping and admits no new work. Start it again with the same data directory and token; this panel reconnects by itself, then retry." },
  { match: /runtime request failed \(http 422\)|failed to deserialize the json body/, step: "The runtime could not read this request: a field is missing, misspelled or of the wrong type. A manifest draft must follow schemas/project.schema.json." },
  { match: /revision conflict/, step: "The record changed since this panel read it. Refresh, and run Discover again before confirming a manifest draft for the next revision." },
  { match: IDENTITY, step: "If the change is intended, use Rebind repository in the project panel, then confirm a manifest revision whose remote matches; otherwise restore the registered checkout." },
  { match: BASELINE_RUNNING, step: "Wait for the running baseline to settle, or cancel it from the baseline list, then run it again." },
  { match: /already has an active writer/, step: "Another workflow's writer holds this repository. Wait for it to settle, or cancel it from its ticket, then try again." },
  { match: /settled without changing any file|made no in-scope change/, step: "The writer changed nothing. Create the next plan revision with the paths the change needs, or a clearer acceptance criterion." },
  { match: MISSING_TOOL, step: "Add a dependency-preparation recipe (for example npm ci) before the tests in the manifest, confirm it, run a new baseline, then plan again." },
  { match: /no longer the planned base/, step: "Confirm a manifest revision for the current HEAD, run its baseline, then create the next plan revision." },
  { match: /split the task/, step: "Create a plan revision with narrower paths, or split the ticket, so each candidate fits the independent review." },
  // An out-of-range budget request, not a spent budget.
  { match: /budgets?\b[^;]* must be (?:between|positive|exactly)/, step: "Correct the plan budgets in the run settings (1 to 10 writer attempts, 1 to 86400 seconds, at most $1000), then plan again." },
  { match: /budget|exhausted|repair limit|max_task_repairs/, step: "The approved budgets are spent. Create the next plan revision (with larger budgets if the work needs them) and approve it to continue." },
  { match: /unreported provider spend|remaining approved cost budget is reserved/, step: "Spend from the interrupted model session is reserved. Create the next plan revision to continue." },
  { match: /hash changed|is stale|reload|manifest changed|state changed/, step: "The runtime state moved on; this panel has refreshed. Review the current candidate or plan before acting again." },
  { match: /already has active work|already active|another session is active|no active local process/, step: "Wait for the active work to finish, or cancel it, then act on the settled state." },
  { match: /executor infrastructure failure/, step: "The check runner failed on this host, not the candidate. Check the runtime log and the host, run a new baseline, then validate again or create the next plan revision." },
  { match: /baseline/, step: "Run a passing baseline for the current manifest on this host, then try again." },
  { match: /approved_by/, step: "Enter the approver's name (at most 200 UTF-8 bytes) in the run settings, then approve again." },
  { match: /create (?:and approve )?a new plan/, step: "Create the next plan revision from the current ticket and selected resources, then approve it." },
  { match: /superseded|approval does not|approval is stale|stored approval|requires an approved workflow|not approved|approve the latest/, step: "Approve the current plan revision first; approval binds to its exact hash." },
  { match: /no candidate was recorded/, step: "The writer left no candidate; its worktree is kept. Create the next plan revision and implement again." },
  { match: /interrupted by runtime shutdown|runtime restarted|interrupted/, step: "The service stopped during this stage. Validate again for fresh check and review evidence; a writer that was interrupted needs a new plan revision, and its worktree is preserved.", requires: "validate", otherwise: `${REPLAN} A writer that was interrupted keeps its worktree.` },
  { match: /invalid structured reviewer response|reviewer response|reviewer returned no|reviewer settled without|review deadline exceeded/, step: "The reviewer produced no usable verdict. Re-validate the candidate to start a fresh reviewer session under the same approval.", requires: "revalidate", otherwise: REPLAN },
  { match: /independent review did not pass/, step: "Read the findings, then repair the candidate or create the next plan revision.", requires: "repair", otherwise: "Read the findings, then create the next plan revision." },
  { match: /required candidate checks failed|checks failed|check failed/, step: "Open the failed check's log, then repair the candidate.", requires: "repair", otherwise: "Open the failed check's log, then create the next plan revision." },
  { match: /could not run meaningfully|testing blocked|blocked/, step: "A required check could not run on this host. Fix the check recipe or the host, then run a new baseline." },
  { match: /scope|outside|not permitted|unrelated/, step: "The change reached outside the approved scope. Create the next plan revision with the paths the change needs." },
  { match: /cancelled/, step: "This work was cancelled. Create the next plan revision to try again." },
  { match: DIRTY, step: "Commit or stash the developer checkout's changes, then try again." },
  // Any other approval refusal (a missing, stale or mismatched approval), after the scope reasons
  // that merely name the approved paths.
  { match: /approv/, step: "Approve the current plan revision first; approval binds to its exact hash." },
];

/**
 * What the developer can do next, derived from the runtime's recorded reason.
 * Empty when the reason already names the action or no action exists. With the
 * runtime's current decisions it never recommends an action the runtime refuses:
 * it names the refusal and the remaining path instead.
 */
export function nextStep(reason: string, actions?: AllowedActions): string {
  const text = reason.toLowerCase();
  const entry = STEPS.find((candidate) => candidate.match.test(text));
  if (!entry) return "";
  if (!entry.requires || actions?.[entry.requires] !== false) return entry.step;
  const refusal = actions.reasons?.[entry.requires];
  return `${ACTION_NAMES[entry.requires]} is not available${refusal ? `: ${refusal}` : ""}. ${entry.otherwise ?? REPLAN}`;
}

/**
 * The next step for a baseline that did not pass. A baseline runs the repository's own checks on
 * the developer checkout, so a failure is fixed in the repository or its recipe, never by repair.
 */
export function baselineStep(status: BaselineStatus | "failed", reason: string): string {
  if (status === "passed" || status === "running") return "";
  if (status === "interrupted" || status === "cancelled") return "Run the baseline again; only a passed baseline admits feature work.";
  const text = reason.toLowerCase();
  if ([IDENTITY, MISSING_TOOL, DIRTY, BASELINE_RUNNING].some((pattern) => pattern.test(text))) return nextStep(reason);
  if (status === "blocked") return "A required check could not run meaningfully on this host. Fix the recipe or the host, confirm the manifest if it changed, then run the baseline again.";
  return "Open the failing recipe's log, fix the repository or its recipe and commit, then run the baseline again.";
}

/** One sentence naming the refused action, the runtime's reason and the next step. */
export function actionFailure(action: string, error: unknown): string {
  const detail = describeFailure(error);
  const hint = nextStep(detail);
  return hint ? `${action} refused: ${detail} ${hint}` : `${action} refused: ${detail}`;
}

/** UTF-8 bytes, the unit the runtime's ticket and approver limits count. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The failure classes a client action can meet. The capability catalog
 * (schemas/capability-catalog.json) names, per action, which of these apply.
 */
export const FAILURE_CLASSES = [
  /** The runtime did not answer (transport failure): it is down, or the address is wrong. */
  "unreachable",
  /** The request was abandoned by the client before the runtime answered. */
  "aborted",
  /** The bearer token is not the runtime's current token (401). */
  "rejected_token",
  /** The runtime denied the action (403). */
  "denied",
  /** The runtime no longer has the record (404). */
  "not_found",
  /** The runtime refused the request with its own short reason (400, 409, 413, 415, 422). */
  "refused",
  /** The runtime already has its maximum of active runs or streams (429). */
  "capacity",
  /** The runtime is stopping and admits no new work (503 with its reason). */
  "shutting_down",
  /** Any other 5xx: the runtime reported an internal error; no body is shown. */
  "internal",
  /** The client refused to send the request (a local validation of the input). */
  "client",
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

/** The class of a failed request, the same in every client. */
export function classifyFailure(error: unknown): FailureClass {
  if (error instanceof ApiError) {
    if (error.status === 401) return "rejected_token";
    if (error.status === 403) return "denied";
    if (error.status === 404) return "not_found";
    if (error.status === 429) return "capacity";
    if (error.status === 503 && error.fromRuntime) return "shutting_down";
    if (error.status >= 500) return "internal";
    return "refused";
  }
  if (error instanceof DOMException && error.name === "AbortError") return "aborted";
  if (error instanceof TypeError) return "unreachable";
  return "client";
}

/** One explanation of a failed action: its class, the reason shown and the next allowed step. */
export interface FailureExplanation {
  action: string;
  failureClass: FailureClass;
  /** The runtime's own reason, or the client's plain sentence for a transport or status failure. */
  reason: string;
  /** What the developer can do next; empty when the reason already names it. */
  step: string;
  /** `<Action> refused: <reason> <step>`, the sentence every client shows. */
  message: string;
}

/** Explains a failed action identically in every client; `actions` are the runtime's current decisions. */
export function explainFailure(action: string, error: unknown, actions?: AllowedActions): FailureExplanation {
  const reason = describeFailure(error);
  const step = nextStep(reason, actions);
  return { action, failureClass: classifyFailure(error), reason, step, message: step ? `${action} refused: ${reason} ${step}` : `${action} refused: ${reason}` };
}
