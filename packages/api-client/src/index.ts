export type RunState = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface RunRecord {
  id: string;
  project_id: string;
  state: RunState;
  revision: number;
  metadata: { prompt?: string; provider?: string; model?: string; [key: string]: unknown };
  created_at: string;
  updated_at: string;
}

export interface Health {
  status: string;
  pi_version: string;
  demo_only: boolean;
}

export interface RunRequest {
  prompt: string;
  provider?: string;
  model?: string;
}

// Keep raw engine payloads available: Pi may add fields without a UI release.
export interface EventEnvelope {
  schema_version: string;
  event_id: string;
  sequence: number;
  timestamp: string;
  project_id: string;
  run_id: string;
  type: string;
  payload: Record<string, unknown>;
}

export type ExecutionProfile = "native" | "container";

export interface ManifestCheck {
  id: string;
  executable: string;
  args: string[];
  required: boolean;
  timeout_seconds: number;
  capabilities: string[];
  /** Defaults to `.` (the repository root) when omitted. */
  cwd?: string;
}

export interface RepositoryManifest {
  id: string;
  remote: string;
  default_branch: string;
  profiles: string[];
  execution: ExecutionProfile;
  checks: ManifestCheck[];
}

export interface Relationship {
  producer: string;
  consumer: string;
  kind: "api" | "package" | "generated-contract" | "runtime" | "integration";
  contract: string;
  confirmed: boolean;
  evidence: string[];
}

export interface ProjectPolicy {
  approval: "plan";
  testing_prerequisite: true;
  publish: "automatic_pr";
  merge: "human";
  max_explorers: number;
  max_implementers: number;
  max_task_repairs: number;
}

/** The versioned, machine-independent project map (schemas/project.schema.json). */
export interface ProjectManifest {
  schema_version: string;
  id: string;
  name: string;
  revision: number;
  repositories: RepositoryManifest[];
  relationships: Relationship[];
  policy: ProjectPolicy;
}

export interface DirtyState {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  paths: string[];
  truncated: boolean;
}

export interface RepositoryObservation {
  local_path: string;
  identity: { remote: string | null; push_remote?: string | null; root_commits: string[]; shallow: boolean };
  head_commit: string;
  branch: string | null;
  remote_default_branch: string | null;
  local_branches: string[];
  dirty: DirtyState;
  git_version: string;
  observed_at: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  revision: number;
  manifest_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepositoryRegistration {
  project_id: string;
  repository_id: string;
  local_path: string;
  observation: RepositoryObservation;
  registered_at: string;
}

export interface ManifestRecord {
  project_id: string;
  revision: number;
  hash: string;
  manifest: ProjectManifest;
  base_commits: Record<string, string>;
  confirmed_at: string;
}

export interface ProposedCheck {
  check: ManifestCheck;
  evidence: string[];
  confidence: "observed" | "inferred";
}

export interface DiscoveryQuestion {
  repository_id: string | null;
  topic: string;
  detail: string;
}

/** A read-only proposal; it executed nothing and authorizes nothing. */
export interface Discovery {
  schema_version: string;
  id: string;
  project_id: string;
  created_at: string;
  repositories: { repository_id: string; observation: RepositoryObservation; profiles: string[]; evidence: string[]; proposed_checks: ProposedCheck[] }[];
  proposed_manifest: ProjectManifest;
  manifest_problems: string[];
  questions: DiscoveryQuestion[];
}

export interface ProjectView {
  project: ProjectRecord;
  repositories: RepositoryRegistration[];
  manifest: ManifestRecord | null;
  discovery: Discovery | null;
}

export type CheckStatus = "passed" | "failed" | "blocked" | "cancelled" | "interrupted";
export type BaselineStatus = "running" | CheckStatus;

/** Deterministic evidence for one recipe execution (schemas/result.schema.json). */
export interface CheckResult {
  schema_version: string;
  id: string;
  run_id: string;
  repository_id: string;
  recipe_id: string;
  candidate_hash: string;
  commit: string;
  environment_fingerprint: string;
  command: string[];
  status: CheckStatus;
  exit_code: number | null;
  artifact_refs: string[];
  cwd?: string;
  started_at?: string;
  finished_at?: string;
  reason?: string;
  artifact_hashes?: Record<string, string>;
  tests_detected?: number;
}

/** A repository's required checks at an exact commit, tree, manifest and host. */
export interface BaselineEvidence {
  id: string;
  run_id: string;
  project_id: string;
  manifest_revision: number;
  identity: { manifest_hash: string; repository_id: string; commit: string; tree: string };
  environment_fingerprint: string;
  status: BaselineStatus;
  required_checks: string[];
  results: CheckResult[];
  started_at: string;
  finished_at?: string;
  reason?: string;
}

export interface StartBaselineRequest {
  repository_id: string;
  include_optional?: boolean;
}

export interface RegisterProjectRequest {
  id?: string;
  name: string;
  repositories: { id: string; path: string }[];
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** Tokens may only be sent to the developer's local runtime. */
export function loopbackUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Use an HTTP loopback runtime URL (127.0.0.1, localhost or [::1]).");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Runtime URL must contain only a loopback address and optional port.");
  }
  return url.origin;
}

export function isTerminal(state: RunState): boolean {
  return ["completed", "failed", "cancelled", "interrupted"].includes(state);
}

export class LuunaClient {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = loopbackUrl(baseUrl);
    if (!token.trim()) throw new Error("Enter the local service token.");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await this.fetcher.call(globalThis, `${this.baseUrl}/api/v1${path}`, {
      ...init,
      headers,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok) {
      // Do not surface arbitrary server error bodies: they can contain prompts or secrets.
      // Validation and conflict responses carry short deterministic runtime reasons.
      const messages: Record<number, string> = {
        400: "The runtime rejected these settings. Check the prompt, provider and model configuration.",
        401: "The service rejected this token. Reconnect using its current token.",
        403: "The runtime denied this action.",
        409: "The run state changed or another session is active. Refresh and try again.",
      };
      const reason = [400, 409, 422].includes(response.status) ? await runtimeReason(response) : undefined;
      throw new ApiError(response.status, reason ?? messages[response.status] ?? `Runtime request failed (HTTP ${response.status}).`);
    }
    return await response.json() as T;
  }

  health(signal?: AbortSignal): Promise<Health> {
    return this.request("/health", { signal });
  }

  listRuns(signal?: AbortSignal): Promise<RunRecord[]> {
    return this.request("/runs", { signal });
  }

  run(id: string, signal?: AbortSignal): Promise<RunRecord> {
    return this.request(`/runs/${encodeURIComponent(id)}`, { signal });
  }

  startRun(request: RunRequest, signal?: AbortSignal): Promise<RunRecord> {
    return this.request("/runs", { method: "POST", body: JSON.stringify(request), signal });
  }

  cancelRun(id: string, signal?: AbortSignal): Promise<RunRecord> {
    return this.request(`/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", signal });
  }

  events(id: string, after = 0, signal?: AbortSignal): Promise<EventEnvelope[]> {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid event cursor.");
    return this.request(`/runs/${encodeURIComponent(id)}/events?after=${after}`, { signal });
  }

  listProjects(signal?: AbortSignal): Promise<ProjectRecord[]> {
    return this.request("/projects", { signal });
  }

  project(id: string, signal?: AbortSignal): Promise<ProjectView> {
    return this.request(`/projects/${encodeURIComponent(id)}`, { signal });
  }

  /** Registers existing repositories by absolute path; the runtime inspects them read-only. */
  registerProject(request: RegisterProjectRequest, signal?: AbortSignal): Promise<ProjectView> {
    return this.request("/projects", { method: "POST", body: JSON.stringify(request), signal });
  }

  discover(id: string, signal?: AbortSignal): Promise<Discovery> {
    return this.request(`/projects/${encodeURIComponent(id)}/discover`, { method: "POST", signal });
  }

  /** Saves the confirmed map; `expectedRevision` is the project's current manifest revision. */
  confirmManifest(id: string, expectedRevision: number, manifest: ProjectManifest, signal?: AbortSignal): Promise<ProjectView> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Invalid manifest revision.");
    return this.request(`/projects/${encodeURIComponent(id)}/manifest`, {
      method: "PUT",
      body: JSON.stringify({ expected_revision: expectedRevision, manifest }),
      signal,
    });
  }

  projectEvents(id: string, after = 0, signal?: AbortSignal): Promise<EventEnvelope[]> {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid event cursor.");
    return this.request(`/projects/${encodeURIComponent(id)}/events?after=${after}`, { signal });
  }

  listBaselines(id: string, signal?: AbortSignal): Promise<BaselineEvidence[]> {
    return this.request(`/projects/${encodeURIComponent(id)}/baselines`, { signal });
  }

  /** Starts a baseline run; it is an ordinary run with events, cancellation and replay. */
  startBaseline(id: string, request: StartBaselineRequest, signal?: AbortSignal): Promise<RunRecord> {
    return this.request(`/projects/${encodeURIComponent(id)}/baselines`, { method: "POST", body: JSON.stringify(request), signal });
  }

  /** Reads a private check log by record identity (`<recipe>.stdout` or `<recipe>.stderr`). */
  async artifact(runId: string, artifactId: string, signal?: AbortSignal): Promise<string> {
    if (!/^[A-Za-z0-9._-]+\.(stdout|stderr)$/.test(artifactId) || artifactId.includes("..")) throw new Error("Invalid artifact identifier.");
    const headers = new Headers({ Authorization: `Bearer ${this.token}`, Accept: "text/plain" });
    const response = await this.fetcher.call(globalThis, `${this.baseUrl}/api/v1/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`, {
      headers,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal,
    });
    if (!response.ok) throw new ApiError(response.status, response.status === 404 ? "The artifact is not available." : `Runtime request failed (HTTP ${response.status}).`);
    return await response.text();
  }
}

/** Extract check results from a baseline run's event stream, in execution order. */
export function checkResults(events: EventEnvelope[]): CheckResult[] {
  return events.flatMap((event) => {
    if (event.type !== "check.finished") return [];
    const result = event.payload.result;
    return result && typeof result === "object" ? [result as CheckResult] : [];
  });
}

async function runtimeReason(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.clone().json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      const reason = body.error.trim();
      if (reason.length > 0 && reason.length <= 300 && !/[\u0000-\u001f]/.test(reason)) return reason;
    }
  } catch {
    // Non-JSON bodies are never surfaced.
  }
  return undefined;
}

/** Fold the project event stream into the last confirmed map, or null before confirmation. */
export function confirmedManifest(events: EventEnvelope[]): { revision: number; hash: string; manifest: ProjectManifest } | null {
  let latest: { revision: number; hash: string; manifest: ProjectManifest } | null = null;
  for (const event of events) {
    if (event.type !== "manifest.confirmed") continue;
    const { revision, manifest_hash, manifest } = event.payload;
    if (typeof revision === "number" && typeof manifest_hash === "string" && manifest && typeof manifest === "object") {
      latest = { revision, hash: manifest_hash, manifest: manifest as ProjectManifest };
    }
  }
  return latest;
}

/** Merge replayed events without duplicates; a reconnect can repeat the last page. */
export function mergeEvents<T extends { sequence: number; event_id: string; run_id: string }>(previous: T[], incoming: T[]): T[] {
  const merged = new Map<number, T>();
  const identities = new Map<string, number>();
  const runId = previous[0]?.run_id ?? incoming[0]?.run_id;
  for (const event of [...previous, ...incoming]) {
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
      throw new Error("Runtime returned an invalid event sequence.");
    }
    if (!event.event_id || !event.run_id || event.run_id !== runId) {
      throw new Error("Runtime returned an event for a different run or with no identity.");
    }
    const existing = merged.get(event.sequence);
    const sequenceForId = identities.get(event.event_id);
    if ((existing && existing.event_id !== event.event_id) || (sequenceForId !== undefined && sequenceForId !== event.sequence)) {
      throw new Error("Runtime returned conflicting event identities.");
    }
    // Preserve the first received record when replay overlaps earlier data.
    if (!existing) merged.set(event.sequence, event);
    identities.set(event.event_id, event.sequence);
  }
  const ordered = [...merged.values()].sort((left, right) => left.sequence - right.sequence);
  if (ordered.some((event, index) => event.sequence !== index + 1)) {
    throw new Error("Runtime event replay has a gap; retrying from the last contiguous sequence.");
  }
  return ordered;
}

/** Pi text deltas are display data; completion remains the runtime's RunState. */
export function assistantText(events: EventEnvelope[]): string {
  let deltas = "";
  let finalText = "";
  for (const event of events) {
    const update = event.payload.assistantMessageEvent;
    if (event.type === "pi.message_update" && update && typeof update === "object") {
      const fragment = update as Record<string, unknown>;
      if (fragment.type === "text_delta" && typeof fragment.delta === "string") deltas += fragment.delta;
    }
    const message = event.payload.message;
    if (event.type === "pi.message_end" && message && typeof message === "object") {
      const result = message as Record<string, unknown>;
      if (result.role === "assistant" && Array.isArray(result.content)) {
        finalText = result.content.flatMap((part: unknown) => {
          if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string") return [part.text];
          return [];
        }).join("\n");
      }
    }
  }
  return finalText || deltas;
}
