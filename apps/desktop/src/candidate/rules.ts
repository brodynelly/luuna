import type { CandidateView, PublicationRecord, RunRecord } from "@luuna/api-client";

/** Copies a worktree path for the developer's editor; opening it transfers no permission (docs/09-experience.md). */
export function copyPath(path: string): void {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (clipboard) void clipboard.writeText(path).catch(() => undefined);
}

/** A published candidate whose pull request failed CI on at least one repository may be sent to a bounded repair (the runtime re-observes CI and re-checks every repair gate); a superseded or still-active record never offers it. */
export function canRepairPublication(run: RunRecord, view: CandidateView, publication?: PublicationRecord): boolean {
  const evidence = view.evidence;
  if (!evidence || !publication || view.active || publication.active) return false;
  if (publication.candidate_hash !== evidence.candidate.hash || publication.superseded_by_repair) return false;
  if (evidence.status !== "reviewed" || run.state !== "reviewed" || publication.publication_state !== "pr_open") return false;
  return Object.values(publication.repositories).some((repository) => repository.ci.state === "failure");
}

/** A reviewed candidate with a passed review and no publication in flight may be published; the runtime re-checks every gate. */
export function canPublish(run: RunRecord, view: CandidateView, publication?: PublicationRecord): boolean {
  const evidence = view.evidence;
  if (!evidence || evidence.status !== "reviewed" || view.active || run.state !== "reviewed") return false;
  if (evidence.review?.candidate_hash !== evidence.candidate.hash || evidence.review.verdict !== "passed") return false;
  return !publication || publication.candidate_hash !== evidence.candidate.hash;
}

/** A check log reference the client may request: `<recipe>.<stream>`, never a path. */
export function viewableArtifact(id: string): boolean {
  return /^[A-Za-z0-9._-]+\.(stdout|stderr)$/.test(id) && !id.includes("..");
}
