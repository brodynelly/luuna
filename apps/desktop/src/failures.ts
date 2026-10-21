import { ApiError } from "@luuna/api-client";

/**
 * Developer-facing text for a failed request. The runtime's short deterministic
 * reasons pass through; transport failures and status codes become plain
 * sentences; a raw server body is never shown.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return "The runtime no longer has this record. Refresh the panel.";
    if (error.status === 429) return "The runtime already has four active runs. Wait for one to finish or cancel it.";
    if (error.status >= 500) return `The runtime reported an internal error (HTTP ${error.status}). Check its log, then retry.`;
    return error.message;
  }
  if (error instanceof DOMException && error.name === "AbortError") return "The request was abandoned before the runtime answered.";
  if (error instanceof TypeError) return "The runtime did not answer. Start the service, or check its address and that it is still running; this panel reconnects by itself once it answers.";
  return error instanceof Error && error.message ? error.message : "The runtime could not be reached.";
}

/**
 * What the developer can do next, derived from the runtime's recorded reason.
 * Empty when the reason already names the action or no action exists.
 */
export function nextStep(reason: string): string {
  const text = reason.toLowerCase();
  if (/rejected this token/.test(text)) return "Check the LUUNA_API_TOKEN value the service was started with, then connect again.";
  if (/did not answer|could not be reached/.test(text)) return "";
  if (/budget|exhausted|repair limit|max_task_repairs/.test(text)) return "The approved budgets are spent. Create the next plan revision and approve it to continue.";
  if (/unreported provider spend|remaining approved cost budget is reserved/.test(text)) return "Spend from the interrupted model session is reserved. Create the next plan revision to continue.";
  if (/hash changed|is stale|reload|manifest changed|state changed/.test(text)) return "The runtime state moved on; this panel has refreshed. Review the current candidate or plan before acting again.";
  if (/already has active work|already active|another session is active|no active local process/.test(text)) return "Wait for the active work to finish, or cancel it, then act on the settled state.";
  if (/baseline/.test(text)) return "Run a passing baseline for the current manifest on this host, then try again.";
  if (/approval|approve/.test(text)) return "Approve the current plan revision first; approval binds to its exact hash.";
  if (/interrupted by runtime shutdown|runtime restarted|interrupted/.test(text)) return "The service stopped during this stage. Validate again for fresh check and review evidence; a writer that was interrupted needs a new plan revision, and its worktree is preserved.";
  if (/invalid structured reviewer response|reviewer response|reviewer returned no|reviewer settled without/.test(text)) return "The reviewer produced no usable verdict. Re-validate the candidate to start a fresh reviewer session under the same approval.";
  if (/independent review did not pass/.test(text)) return "Read the findings, then repair the candidate or create the next plan revision.";
  if (/required candidate checks failed|checks failed|check failed/.test(text)) return "Open the failed check's log, then repair the candidate.";
  if (/could not run meaningfully|testing blocked|blocked/.test(text)) return "A required check could not run on this host. Fix the check recipe or the host, then run a new baseline.";
  if (/scope|outside|not permitted|unrelated/.test(text)) return "The change reached outside the approved scope. Create the next plan revision with the paths the change needs.";
  if (/cancelled/.test(text)) return "This work was cancelled. Create the next plan revision to try again.";
  if (/dirty|uncommitted/.test(text)) return "Commit or stash the developer checkout's changes, then try again.";
  return "";
}

/** One sentence naming the refused action, the runtime's reason and the next step. */
export function actionFailure(action: string, error: unknown): string {
  const detail = describeFailure(error);
  const hint = nextStep(detail);
  return hint ? `${action} refused: ${detail} ${hint}` : `${action} refused: ${detail}`;
}
