import type { BaselineEvidence, CheckResult, Discovery, ProjectExport, ProjectView } from "@luuna/api-client";
import { registerProjectRequest } from "@luuna/api-client";
import { baselineStep, nextStep } from "../failures";

/** What another panel (Home, Board) asks this one to show: a project, one of its tickets, or its ticket form. */
export interface ProjectRequest { projectId: string; ticketId?: string; ticketForm?: boolean; nonce: number }

/** The element a request lands on, in DOM order of the Projects panel. */
export function requestTarget(request: Pick<ProjectRequest, "ticketId" | "ticketForm">): string {
  return request.ticketId ? `ticket-${request.ticketId}` : request.ticketForm ? "ticket-title" : "projects-heading";
}

const ARTIFACT_ID = /^[A-Za-z0-9._-]+\.(stdout|stderr)$/;

/**
 * A stored discovery proposes the next manifest revision; once a revision is confirmed the
 * proposal is spent, and confirming it again would only be refused as a revision conflict.
 */
export function currentProposal(view: ProjectView): Discovery | null {
  return view.discovery && view.discovery.proposed_manifest.revision === view.project.revision + 1 ? view.discovery : null;
}

/**
 * The log identities of one baseline result. Results carry `<recipe>.<stream>` references; a
 * baseline recorded before that carries `artifact:` references, and the runtime serves its logs
 * under the same `<recipe>.<stream>` identity.
 */
export function baselineArtifacts(result: CheckResult): string[] {
  const recorded = result.artifact_refs.filter((id) => ARTIFACT_ID.test(id) && !id.includes(".."));
  if (recorded.length > 0) return recorded;
  return ["stdout", "stderr"].map((stream) => `${result.recipe_id}.${stream}`).filter((id) => ARTIFACT_ID.test(id) && !id.includes(".."));
}

/** One row of the registration form; a project registers several repositories at once (R05). */
export interface RepositoryRow { id: string; path: string }

/** The registration the desktop sends: every row, through the builder the TUI shares (R02). */
export function registrationRequest(name: string, projectId: string, rows: RepositoryRow[]) {
  return registerProjectRequest(name, rows, projectId);
}

/**
 * The latest recorded baseline of each registered repository. The runtime lists baselines newest
 * first (`ORDER BY rowid DESC`) and the client keeps that order, so the first match is the latest.
 */
export function latestBaselines(baselines: BaselineEvidence[], repositoryIds: string[]): Record<string, BaselineEvidence | undefined> {
  return Object.fromEntries(repositoryIds.map((id) => [id, baselines.find((baseline) => baseline.identity.repository_id === id)]));
}

/** The message for a baseline run that settled before any baseline record existed. */
export function baselineRunFailure(state: string, reason: string): string {
  if (!reason) return `Baseline run ${state} before a baseline was recorded; its events in Session history hold the details.`;
  const step = state === "interrupted" || state === "cancelled" ? baselineStep(state, reason) : nextStep(reason);
  return `Baseline run ${state}: ${reason}${step ? ` ${step}` : ""}`;
}

/**
 * A pasted project export, parsed locally only to list the repositories it names; the runtime
 * validates its hash, identities and content. Anything that is not an export with a manifest
 * naming each repository by id is `null`.
 */
export function parseProjectExport(text: string): ProjectExport | null {
  if (!text.trim()) return null;
  try {
    const value = JSON.parse(text) as ProjectExport;
    const repositories = value && typeof value === "object" && value.manifest && typeof value.manifest === "object" ? value.manifest.repositories : undefined;
    const shaped = Array.isArray(repositories) && repositories.every((repository) => repository && typeof repository === "object" && typeof repository.id === "string" && repository.id.length > 0);
    return value && typeof value === "object" && value.kind === "luuna-project-export" && shaped ? value : null;
  } catch {
    return null;
  }
}

/** A JSON document as a download link's address. */
export function jsonDataUrl(value: unknown): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(value, null, 2))}`;
}

/** The manifest draft as the developer edited it, or the reason it cannot be sent. */
export function parseManifestDraft(draft: string): object {
  let manifest: unknown;
  try {
    manifest = JSON.parse(draft);
  } catch {
    throw new Error("The manifest draft is not valid JSON.");
  }
  if (!manifest || typeof manifest !== "object") throw new Error("The manifest draft must be a JSON object.");
  return manifest;
}
