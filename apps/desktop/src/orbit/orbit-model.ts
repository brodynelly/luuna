import type { DirtyState, LuunaClient, OrbitExecRequest, OrbitExecution, OrbitRepository, OrbitRunRequest, OrbitSyncRequest, SandboxNetwork, SandboxPlan } from "@luuna/api-client";
import { ORBIT_TIMEOUT_LIMITS, orbitCommand } from "@luuna/api-client";

/**
 * Orbit (ADR 0036): the request bodies the view sends and the words it shows. The runtime selects,
 * runs and reports; this only builds the developer's request from the form and reads the answer.
 * Orbit results are the developer's own commands and never evidence.
 */

/** The repositories to act on: omitted when every registered repository is selected (the runtime's default). */
export function repositorySelection(selected: readonly string[], all: readonly string[]): string[] | undefined {
  const chosen = all.filter((id) => selected.includes(id));
  if (chosen.length === 0) throw new Error("Select at least one repository.");
  return chosen.length === all.length ? undefined : chosen;
}

export interface ExecForm {
  line: string;
  selected: readonly string[];
  all: readonly string[];
  parallel: boolean;
  /** Seconds as typed; empty keeps the runtime's default. */
  timeout: string;
}

/** The exec body: the typed command split into executable and arguments (no shell runs it). */
export function execRequest(form: ExecForm): OrbitExecRequest {
  const { executable, args } = orbitCommand(form.line);
  const body: OrbitExecRequest = { executable, args, parallel: form.parallel };
  const repositories = repositorySelection(form.selected, form.all);
  if (repositories) body.repositories = repositories;
  const typed = form.timeout.trim();
  if (typed) {
    const seconds = Number(typed);
    const [low, high] = ORBIT_TIMEOUT_LIMITS;
    if (!Number.isSafeInteger(seconds) || seconds < low || seconds > high) throw new Error(`The timeout must be ${low} to ${high} seconds.`);
    body.timeout_seconds = seconds;
  }
  return body;
}

export function runRequest(recipe: string, selected: readonly string[], all: readonly string[], parallel: boolean): OrbitRunRequest {
  if (!recipe) throw new Error("Choose a recipe to run.");
  const body: OrbitRunRequest = { recipe, parallel };
  const repositories = repositorySelection(selected, all);
  if (repositories) body.repositories = repositories;
  return body;
}

export function syncRequest(fetch: boolean, selected: readonly string[], all: readonly string[]): OrbitSyncRequest {
  const body: OrbitSyncRequest = { fetch };
  const repositories = repositorySelection(selected, all);
  if (repositories) body.repositories = repositories;
  return body;
}

type OrbitClient = Pick<LuunaClient, "orbit" | "orbitExec" | "orbitRun" | "orbitSync" | "orbitSandbox">;

/** Every Orbit request the view makes, in one place so the tests exercise the exact path. */
export const orbitActions = {
  status: (client: OrbitClient, projectId: string, signal?: AbortSignal) => client.orbit(projectId, signal),
  exec: (client: OrbitClient, projectId: string, form: ExecForm, signal?: AbortSignal): Promise<OrbitExecution> => client.orbitExec(projectId, execRequest(form), signal),
  run: (client: OrbitClient, projectId: string, recipe: string, selected: readonly string[], all: readonly string[], parallel: boolean, signal?: AbortSignal): Promise<OrbitExecution> =>
    client.orbitRun(projectId, runRequest(recipe, selected, all, parallel), signal),
  sync: (client: OrbitClient, projectId: string, fetch: boolean, selected: readonly string[], all: readonly string[], signal?: AbortSignal): Promise<OrbitExecution> =>
    client.orbitSync(projectId, syncRequest(fetch, selected, all), signal),
  sandbox: (client: OrbitClient, projectId: string, network: SandboxNetwork, signal?: AbortSignal): Promise<SandboxPlan> => client.orbitSandbox(projectId, network, signal),
};

/** `↑ahead ↓behind` against the tracked branch, or "no upstream". */
export function upstreamText(repository: Pick<OrbitRepository, "upstream">): string {
  const upstream = repository.upstream;
  return upstream ? `↑${upstream.ahead} ↓${upstream.behind}` : "no upstream";
}

/** Uncommitted changes as one count (staged, unstaged, untracked and conflicted), or "clean". */
export function dirtyText(dirty: DirtyState | null): string {
  if (!dirty) return "not read";
  const count = dirty.staged + dirty.unstaged + dirty.untracked + dirty.conflicted;
  if (count === 0) return "clean";
  return `${count}${dirty.truncated ? "+" : ""} uncommitted ${count === 1 ? "change" : "changes"}`;
}

const KIND_LABEL: Record<OrbitExecution["kind"], string> = { exec: "Command", recipe: "Recipe", sync: "Sync" };

/** The one sentence the live region announces when an execution finishes. */
export function executionSummary(execution: OrbitExecution): string {
  const counts = new Map<string, number>();
  for (const result of execution.results) counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
  const parts = [...counts].map(([status, count]) => `${count} ${status}`);
  return `${KIND_LABEL[execution.kind]} finished in ${execution.results.length} ${execution.results.length === 1 ? "repository" : "repositories"}${parts.length ? `: ${parts.join(", ")}` : ""}.`;
}

/** The last `segments` parts of a checkout path, so a deep path stays one readable line; the full path goes in its title. */
export function tailPath(path: string, segments = 3): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= segments) return path;
  const separator = path.includes("\\") ? "\\" : "/";
  return `…${separator}${parts.slice(-segments).join(separator)}`;
}
