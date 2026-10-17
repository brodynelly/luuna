export type RunState =
  | "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted"
  | "discovered" | "exploring" | "testing_blocked" | "plan_ready" | "approved" | "implementing" | "validating" | "reviewing" | "reviewed" | "paused";

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
  /** Content digest of the sources the runtime binary was built from. */
  build_identity?: string;
  /** Release and commit of the compiler that built the runtime binary. */
  build_rustc?: string;
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
  /** Artifact references whose stream reached the executor's size cap. */
  truncated_artifacts?: string[];
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

/** Temporary local ticket (ADR 0003); Missions becomes authoritative in M6. */
export type TicketSource = "luuna_sqlite_temporary";

export interface Ticket {
  schema_version: string;
  id: string;
  project_id: string;
  revision: number;
  source: TicketSource;
  title: string;
  intent: string;
  acceptance_criteria: string[];
  repository_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateTicketRequest {
  /** Repeating a delivery with the same key returns the same ticket. */
  idempotency_key: string;
  title: string;
  intent: string;
  acceptance_criteria: string[];
  repository_ids: string[];
}

export type Operation = "read" | "write" | "shell" | "network" | "publish";

export interface PlanTask {
  id: string;
  repository_id: string;
  role: string;
  depends_on: string[];
  paths: string[];
  operations: Operation[];
  acceptance_criteria: string[];
  execution_profile: string;
}

export interface CheckRecipe {
  id: string;
  repository_id: string;
  executable: string;
  args: string[];
  cwd: string;
  timeout_seconds: number;
  required: boolean;
  capabilities: string[];
  execution_profile: string;
}

export interface Budgets {
  max_workers: number;
  max_attempts: number;
  timeout_seconds: number;
  cost_usd_micros: number;
}

export interface PlanRevision {
  schema_version: string;
  canonicalization: string;
  id: string;
  revision: number;
  project_id: string;
  ticket_id: string;
  ticket_revision: number;
  manifest_hash: string;
  base_commits: Record<string, string>;
  candidate_hash: string | null;
  permissions: { repositories: Record<string, string[]>; operations: Operation[] };
  tasks: PlanTask[];
  required_checks: CheckRecipe[];
  budgets: Budgets;
  hash: string;
}

export interface CreatePlanRequest {
  task: { id?: string; repository_id: string; paths: string[]; operations: Operation[]; acceptance_criteria?: string[] };
  permissions?: Record<string, string[]>;
  budgets?: { max_attempts?: number; timeout_seconds?: number; cost_usd_micros?: number };
}

export interface PlanOpened {
  plan: PlanRevision;
  run: RunRecord;
}

export interface Approval {
  schema_version: string;
  id: string;
  plan_id: string;
  plan_revision: number;
  plan_hash: string;
  approved_by: string;
  approved_at: string;
  permissions: { repositories: Record<string, string[]>; operations: Operation[] };
}

export interface ApprovePlanRequest {
  plan_revision: number;
  /** The exact hash the approver saw; anything else is a stale approval. */
  plan_hash: string;
  approved_by: string;
}

export interface PlanApproved {
  approval: Approval;
  run: RunRecord;
}

export interface ImplementRequest {
  task_id?: string;
  provider?: string;
  model?: string;
}

/** The runtime's immutable identity for an exact set of repository commits. */
export interface CandidateSet {
  schema_version: string;
  id: string;
  revision: number;
  plan_hash: string;
  repository_commits: Record<string, string>;
  dependency_bindings: Record<string, string>;
  hash: string;
}

export interface ReviewFinding {
  severity: "info" | "warning" | "blocking";
  path: string;
  line: number;
  explanation: string;
  evidence: string[];
}

/** A structured, independently recorded review of one exact candidate. */
export interface ReviewResult {
  schema_version: string;
  id: string;
  candidate_hash: string;
  reviewer_session: string;
  findings: ReviewFinding[];
  verdict: "passed" | "changes_required" | "blocked";
  evidence: string[];
}

export type CandidateStatus = "pending" | "validating" | "reviewing" | "reviewed" | "failed" | "testing_blocked" | "paused" | "cancelled" | "interrupted";

export interface CandidateEvidence {
  candidate: CandidateSet;
  run_id: string;
  implementer_session: string;
  repository_trees: Record<string, string>;
  status: CandidateStatus;
  results: CheckResult[];
  review?: ReviewResult | null;
  started_at: string;
  finished_at?: string;
  reason?: string;
  elapsed_seconds: number;
  cost_usd_micros: number;
  validation_generation: number;
}

export interface CandidateView {
  evidence: CandidateEvidence | null;
  /** Whether the runtime currently owns a worker for this workflow. */
  active: boolean;
  /** The runtime's decision after checking state, repair and attempt budgets. */
  repair_allowed: boolean;
}

export interface CandidateDiff {
  candidate_hash: string;
  repository_id: string;
  base_commit: string;
  commit: string;
  diff: string;
}

export interface CandidateActionRequest {
  /** The full candidate hash shown to the developer; stale requests are refused. */
  candidate_hash: string;
  provider?: string;
  model?: string;
}

export interface ValidateCandidateRequest extends CandidateActionRequest {
  /** Opt in to bounded automatic repair under this immutable plan's approval. */
  auto_repair?: boolean;
}

export type LeaseState = "active" | "released" | "abandoned";

export interface WorktreeLease {
  id: string;
  run_id: string;
  project_id: string;
  repository_id: string;
  path: string;
  base_commit: string;
  state: LeaseState;
  candidate_commit?: string;
  created_at: string;
  released_at?: string;
  reason?: string;
}

export type AttemptState = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface AttemptRecord {
  id: string;
  run_id: string;
  task_id: string;
  number: number;
  state: AttemptState;
  payload: Record<string, unknown>;
  started_at: string;
  finished_at?: string;
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
  return ["completed", "failed", "cancelled", "interrupted", "reviewed"].includes(state);
}

/** A workflow whose writer has settled with a candidate and now waits for validation (M3). */
export function awaitsValidation(state: RunState): boolean {
  return state === "validating";
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

  /** Creates the temporary local ticket through the canonical project-scoped route. */
  createTicket(projectId: string, request: CreateTicketRequest, signal?: AbortSignal): Promise<Ticket> {
    if (!request.idempotency_key.trim()) throw new Error("An idempotency key is required.");
    return this.request(`/projects/${encodeURIComponent(projectId)}/tickets`, { method: "POST", body: JSON.stringify(request), signal });
  }

  listTickets(projectId: string, signal?: AbortSignal): Promise<Ticket[]> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/tickets`, { signal });
  }

  ticket(id: string, signal?: AbortSignal): Promise<Ticket> {
    return this.request(`/tickets/${encodeURIComponent(id)}`, { signal });
  }

  listPlans(ticketId: string, signal?: AbortSignal): Promise<PlanRevision[]> {
    return this.request(`/tickets/${encodeURIComponent(ticketId)}/plans`, { signal });
  }

  /** Records an immutable plan revision; the runtime binds ticket, manifest, base and recipes. */
  createPlan(ticketId: string, request: CreatePlanRequest, signal?: AbortSignal): Promise<PlanOpened> {
    return this.request(`/tickets/${encodeURIComponent(ticketId)}/plans`, { method: "POST", body: JSON.stringify(request), signal });
  }

  plan(id: string, signal?: AbortSignal): Promise<PlanRevision> {
    return this.request(`/plans/${encodeURIComponent(id)}`, { signal });
  }

  /** Approves exactly one plan revision by hash; permissions come from the plan, never the client. */
  approvePlan(id: string, request: ApprovePlanRequest, signal?: AbortSignal): Promise<PlanApproved> {
    if (!request.plan_hash.startsWith("sha256:")) throw new Error("Approve the plan by its exact hash.");
    return this.request(`/plans/${encodeURIComponent(id)}/approvals`, { method: "POST", body: JSON.stringify(request), signal });
  }

  /** Schedules the approved workflow's writer; the runtime revalidates everything before it starts. */
  implement(runId: string, request: ImplementRequest = {}, signal?: AbortSignal): Promise<RunRecord> {
    return this.request(`/runs/${encodeURIComponent(runId)}/implement`, { method: "POST", body: JSON.stringify(request), signal });
  }

  worktrees(runId: string, signal?: AbortSignal): Promise<WorktreeLease[]> {
    return this.request(`/runs/${encodeURIComponent(runId)}/worktrees`, { signal });
  }

  attempts(runId: string, signal?: AbortSignal): Promise<AttemptRecord[]> {
    return this.request(`/runs/${encodeURIComponent(runId)}/attempts`, { signal });
  }

  candidate(runId: string, signal?: AbortSignal): Promise<CandidateView> {
    return this.request(`/runs/${encodeURIComponent(runId)}/candidate`, { signal });
  }

  candidateDiff(runId: string, signal?: AbortSignal): Promise<CandidateDiff> {
    return this.request(`/runs/${encodeURIComponent(runId)}/diff`, { signal });
  }

  /** Runs the approved recipes and an independent reviewer for this exact candidate. */
  validateCandidate(runId: string, request: ValidateCandidateRequest, signal?: AbortSignal): Promise<RunRecord> {
    return this.candidateAction(runId, "validate", request, signal);
  }

  /** Requests a bounded writer repair under the existing approval. */
  repairCandidate(runId: string, request: CandidateActionRequest, signal?: AbortSignal): Promise<RunRecord> {
    return this.candidateAction(runId, "repair", request, signal);
  }

  private candidateAction(runId: string, action: "validate" | "repair", request: CandidateActionRequest, signal?: AbortSignal): Promise<RunRecord> {
    if (!/^sha256:[a-f0-9]{64}$/.test(request.candidate_hash)) throw new Error("Use the candidate's complete hash.");
    return this.request(`/runs/${encodeURIComponent(runId)}/${action}`, { method: "POST", body: JSON.stringify(request), signal });
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
