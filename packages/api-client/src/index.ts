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
  /** Approved writers and required checks run with the developer's host permissions. */
  native_execution?: boolean;
  /** Content digest of the sources the runtime binary was built from. */
  build_identity?: string;
  /** Release and commit of the compiler that built the runtime binary. */
  build_rustc?: string;
  /** Any rustc wrapper Cargo ran the compiler through, or "none". */
  build_rustc_sha256?: string;
  build_rustc_wrapper?: string;
  /** Profile, optimization and RUSTFLAGS the runtime binary was compiled with. */
  build_flags?: string;
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
  /** Whether this host has the check's tools; absent in discoveries stored before probing existed. */
  capability?: "available" | "missing";
  missing_tools?: string[];
}

export interface HostCapabilities {
  probed_at: string;
  os: string;
  arch: string;
  tools: ToolProbe[];
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
  host_capabilities?: HostCapabilities;
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

/** Legacy local records migrate to the authoritative Missions projection. */
export type TicketSource = "luuna_sqlite_temporary" | "missions";

export interface TicketUsage {
  workflows: number; attempts: number; elapsed_seconds: number; cost_usd_micros: number; cost_unreported: boolean; repairs: number;
}

export interface Ticket {
  usage?: TicketUsage;
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

export interface TicketSourceStatus {
  source?: TicketSource;
  source_id: string | null;
  source_revision: string | null;
  reconciliation_required: boolean;
  workspace: string | null;
}

export interface CreateTicketRequest {
  /** Repeating a delivery with the same key returns the same ticket. */
  idempotency_key: string;
  title: string;
  intent: string;
  acceptance_criteria: string[];
  repository_ids: string[];
}

export interface ComponentStatus {
  enabled: boolean;
  workspace_path?: string;
  reason?: string;
}

export type MemoryScope = "project" | "process" | "user";

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  content: string;
  provenance: string;
  hash: string;
  created_at?: string;
}

export interface CreateMemoryRequest {
  idempotency_key: string;
  scope: MemoryScope;
  content: string;
  provenance: string;
}

export interface PromoteMemoryRequest {
  idempotency_key: string;
  expected_hash: string;
  to_scope: "project" | "user";
}

export interface PromotedMemory {
  promoted: MemoryRecord;
  from: { id: string; scope: MemoryScope };
}

export interface ProjectExport {
  schema_version: string;
  kind: "luuna-project-export";
  exported_at: string;
  project: { id: string; name: string; manifest_revision: number; manifest_hash: string | null };
  manifest: ProjectManifest | null;
  tickets: Ticket[];
  memory: MemoryRecord[];
  prompts: RenderedPrompt[];
  omitted: string[];
}

export type ScaffoldProfile = "node" | "node-typescript" | "react" | "python" | "go" | "rust" | "flutter" | "android" | "ios";

export interface ScaffoldProposalRequest {
  profile: ScaffoldProfile;
  name: string;
  parent_dir: string;
}

export interface ScaffoldGenerator {
  id: string;
  executable: string;
  args: string[];
  capabilities: string[];
  network: boolean;
  description: string;
}

export interface ToolProbe {
  tool: string;
  status: "available" | "missing";
  version?: string;
  detail?: string;
}

export interface ScaffoldProposal {
  schema_version: string;
  profile: ScaffoldProfile;
  name: string;
  parent_dir: string;
  target_dir: string;
  status: "ready" | "blocked";
  blocked_reason?: string;
  files: { path: string; contents: string }[];
  generator?: ScaffoldGenerator;
  preparation: ScaffoldGenerator[];
  network_steps: string[];
  baseline: ManifestCheck[];
  required_tools: ToolProbe[];
  questions: DiscoveryQuestion[];
  hash: string;
}

export interface ScaffoldRequest {
  proposal_hash: string;
  idempotency_key: string;
  confirm: true;
  confirm_network?: boolean;
}

export interface ScaffoldCheckOutcome {
  recipe_id: string;
  status: CheckStatus;
  exit_code: number | null;
  reason: string | null;
  command: string[];
  tool_version: string | null;
  tests_detected: number | null;
  stdout_excerpt: string;
  stderr_excerpt: string;
}

export interface ScaffoldResult {
  proposal_hash: string;
  idempotency_key: string;
  profile: ScaffoldProfile;
  target_dir: string;
  commit: string;
  generator?: ScaffoldCheckOutcome;
  preparation: ScaffoldCheckOutcome[];
  check: ScaffoldCheckOutcome;
  baseline_passed: boolean;
  project: ProjectView;
  discovery: Discovery;
  replayed: boolean;
}

export interface PromptRecord {
  name: string;
  version: number;
  hash?: string;
}

export interface RenderedPrompt {
  name: string;
  version: number;
  hash: string;
  body: string;
}

export interface CreatePromptRequest {
  idempotency_key: string;
  name: string;
  body: string;
  expected_version?: number;
}

/** Explicit selection only: nothing is attached from personal stores automatically. */
export interface ComponentContext {
  memory_ids: string[];
  prompt?: { name: string; version: number; hash: string } | null;
}

/** Exact runtime-resolved resource content covered by the immutable plan hash. */
export interface ComponentContextSnapshot {
  memory: Array<{ id: string; scope: MemoryScope; hash: string; content: string; provenance: string }>;
  prompt?: { name: string; version: number; hash: string; body: string } | null;
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
  component_context?: ComponentContextSnapshot;
}

export interface PlanBudgetRequest {
  /** Concurrent writers for a multi-task plan (1 to the number of tasks, at most 4); a single-task plan allows exactly 1. */
  max_workers?: number;
  max_attempts?: number;
  /** Cumulative across the writer, checks, review and repairs of the workflow. */
  timeout_seconds?: number;
  cost_usd_micros?: number;
}

export interface PlanTaskRequest {
  id?: string;
  repository_id: string;
  paths: string[];
  operations: Operation[];
  acceptance_criteria?: string[];
  /** Task ids this task waits for; its writer and checks receive the producers' candidate worktrees and commits. */
  depends_on?: string[];
}

export interface CreatePlanRequest {
  /** One task, or `tasks` for a dependency-ordered multi-repository plan (never both). */
  task?: PlanTaskRequest;
  tasks?: PlanTaskRequest[];
  permissions?: Record<string, string[]>;
  budgets?: PlanBudgetRequest;
  component_context?: ComponentContext;
  /** Repeating a delivery with the same key and request returns the plan it created. */
  idempotency_key?: string;
}

/** The runtime's defaults when a plan names no budgets. */
export const DEFAULT_PLAN_BUDGETS: Required<PlanBudgetRequest> = { max_workers: 1, max_attempts: 2, timeout_seconds: 600, cost_usd_micros: 1_000_000 };

/** Inclusive bounds the runtime enforces for each plan budget. */
export const PLAN_BUDGET_LIMITS: Record<keyof PlanBudgetRequest, readonly [number, number]> = {
  max_workers: [1, 4],
  max_attempts: [1, 10],
  timeout_seconds: [1, 86_400],
  cost_usd_micros: [1, 1_000_000_000],
};

/** The runtime's refusal for an out-of-range budget, or null when every named budget is in range. */
export function planBudgetProblem(budgets: PlanBudgetRequest): string | null {
  for (const [field, [low, high]] of Object.entries(PLAN_BUDGET_LIMITS) as [keyof PlanBudgetRequest, readonly [number, number]][]) {
    const value = budgets[field];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < low || value > high)) return `budgets.${field} must be between ${low} and ${high}`;
  }
  return null;
}

/** Idempotency keys are 1 to 128 visible ASCII characters. */
export function validIdempotencyKey(key: string): boolean {
  return /^[\x21-\x7e]{1,128}$/.test(key);
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
export type TaskState = "queued" | "running" | "completed" | "failed" | "interrupted" | "blocked" | "cancelled";

/** Durable per-task state of a multi-repository workflow (ADR 0017). */
export interface TaskRecord {
  run_id: string;
  task_id: string;
  repository_id: string;
  state: TaskState;
  attempt_id?: string;
  candidate_commit?: string;
  candidate_tree?: string;
  depends_on: string[];
  reason?: string;
  updated_at: string;
}

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

/** The refusal each candidate route would give now, or null when it would admit the request. */
export interface CandidateDecisionReasons {
  validate: string | null;
  repair: string | null;
  revalidate: string | null;
}

/** The whole workflow's usage (writer attempts, validation and review) against its approved plan. */
export interface WorkflowUsage {
  attempts: number;
  max_attempts: number;
  elapsed_seconds: number;
  timeout_seconds: number;
  cost_usd_micros: number;
  cost_budget_usd_micros: number;
  /** A writer or reviewer reported tokens without a cost, so the cost budget did not meter them. */
  cost_unreported: boolean;
  repairs: number;
  max_repairs: number | null;
}

export interface CandidateView {
  evidence: CandidateEvidence | null;
  /** Whether the runtime currently owns a worker for this workflow. */
  active: boolean;
  /** The runtime's decision after checking state, repair and attempt budgets. */
  repair_allowed: boolean;
  /**
   * Whether a failed candidate may start a fresh validation generation in place: its required
   * checks passed but no reviewer verdict was recorded, and the approved budgets still have
   * headroom. Same revision, same approval, fresh checks and a fresh reviewer.
   */
  revalidate_allowed: boolean;
  /** The validate route's own gate (absent from runtimes that predate it). */
  validate_allowed?: boolean;
  /** Why each refused action is refused (absent from runtimes that predate it). */
  decision_reasons?: CandidateDecisionReasons;
  /** Absent from runtimes that predate workflow usage reporting. */
  usage?: WorkflowUsage;
}

export type PublicationState = "pending" | "pushing" | "pr_open" | "failed" | "integrated";
export type PublicationStep = "pending" | "done" | "failed";

export interface PublishRequest {
  expected_hash: string;
  idempotency_key: string;
}

export interface CiObservation {
  state: "pending" | "success" | "failure" | "unknown";
  observed_at?: string;
  checks: { name: string; status: string; conclusion?: string }[];
  reason?: string;
}

export interface MergeObservation {
  merged: boolean;
  merged_at?: string;
  merged_by?: string;
  observed_at?: string;
  reason?: string;
}

export interface RepositoryPublication {
  branch: string;
  commit: string;
  remote: string;
  owner: string;
  repo: string;
  base_branch: string;
  push: PublicationStep;
  pull_request_step: PublicationStep;
  pull_request?: { number: number; url: string };
  reason?: string;
  ci: CiObservation;
  merge: MergeObservation;
}

/** Mirrors schemas/publication.schema.json. */
export interface Publication {
  schema_version: string;
  ticket_id: string;
  candidate_hash: string;
  per_repository_branch: Record<string, string>;
  pull_request_urls: Record<string, string>;
  publication_state: PublicationState;
}

export interface PublicationRecord {
  schema_version: string;
  run_id: string;
  project_id: string;
  ticket_id: string;
  candidate_hash: string;
  idempotency_key: string;
  publication_state: PublicationState;
  repositories: Record<string, RepositoryPublication>;
  reason?: string;
  created_at: string;
  updated_at: string;
  observed_at?: string;
  /** The developer sent this published candidate to a bounded repair after its pull request failed CI; a later revision publishes under its own record whose pull request body names this one. */
  superseded_by_repair?: boolean;
  superseded_reason?: string;
  superseded_at?: string;
  contract: Publication;
  active: boolean;
}

/** The response of a CI-failure repair: the superseded publication record plus the workflow run now implementing the next candidate revision. */
export interface PublicationRepair extends PublicationRecord {
  run: RunRecord;
}

export interface CandidateDiff {
  candidate_hash: string;
  repository_id: string;
  base_commit: string;
  commit: string;
  diff: string;
  truncated?: boolean;
  files?: { path: string; status: string; shown: "text" | "summary" | "omitted" }[];
  worktree_drift?: string | null;
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

/** Sending it is the developer's confirmation; the registered path is re-inspected when omitted. */
export interface RebindRepositoryRequest {
  local_path?: string;
}

/** The largest page a paged read may request. */
export const MAX_PAGE = 10_000;

export interface PageOptions {
  /** At most this many records (1 to MAX_PAGE); omitted reads every record. */
  limit?: number;
}

export class ApiError extends Error {
  readonly status: number;
  /**
   * `fromRuntime` is true when the message is the runtime's own short reason from a JSON
   * `{error}` body, false when the client substituted a generic sentence.
   */
  readonly fromRuntime: boolean;

  // No parameter properties: Node loads this source directly (type stripping) for the TUI.
  constructor(status: number, message: string, fromRuntime = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fromRuntime = fromRuntime;
  }
}

/** One parsed `text/event-stream` frame. */
interface SseFrame { event: string; data: string; id: string }

/** Parses SSE frames from a byte stream; a frame is dispatched at each blank line. */
async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let frame: SseFrame = { event: "", data: "", id: "" };
  let lines: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffered += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const parts = buffered.split(/\r\n|\r|\n/);
      buffered = done ? "" : parts.pop() ?? "";
      for (const line of parts) {
        if (line === "") {
          if (lines.length) { frame.data = lines.join("\n"); yield frame; }
          frame = { event: "", data: "", id: "" };
          lines = [];
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") frame.event = value;
        else if (field === "data") lines.push(value);
        else if (field === "id") frame.id = value;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const aborted = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", aborted); resolve(); }, milliseconds);
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

/** What a live follower is told while it waits for the runtime to answer again. */
export interface FollowHooks {
  outage?: (failure: unknown) => void;
  reconnected?: () => void;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

function pageQuery(page: PageOptions, separator: "?" | "&"): string {
  if (page.limit === undefined) return "";
  if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > MAX_PAGE) throw new Error(`limit must be an integer from 1 to ${MAX_PAGE}.`);
  return `${separator}limit=${page.limit}`;
}

/**
 * Every event after `after`, read in pages of `limit` from a cursor until a page comes back empty.
 * A short page is not the end: the runtime bounds run-event pages by count and bytes (ADR 0015).
 * A runtime that ignores `limit` answers with one long page and an empty one.
 */
export async function readEventPages(read: (after: number, page: PageOptions) => Promise<EventEnvelope[]>, after: number, limit = 1000): Promise<EventEnvelope[]> {
  const events: EventEnvelope[] = [];
  let cursor = after;
  for (;;) {
    const page = await read(cursor, { limit });
    events.push(...page);
    const last = page.at(-1)?.sequence;
    if (last === undefined || last <= cursor) return events;
    cursor = last;
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
  private readonly token: string;
  private readonly fetcher: typeof fetch;

  constructor(baseUrl: string, token: string, fetcher: typeof fetch = fetch) {
    this.baseUrl = loopbackUrl(baseUrl);
    if (!token.trim()) throw new Error("Enter the local service token.");
    this.token = token;
    this.fetcher = fetcher;
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
    if (!response.ok) throw await failureOf(response);
    return await response.json() as T;
  }

  health(signal?: AbortSignal): Promise<Health> {
    return this.request("/health", { signal });
  }

  /** Asks the runtime to stop in an orderly way (ADR 0010); it answers 202 and drains. */
  shutdown(signal?: AbortSignal): Promise<{ status: string }> {
    return this.request("/shutdown", { method: "POST", signal });
  }

  /**
   * One SSE connection to a run's durable event stream, resumed after `after` through
   * `Last-Event-ID`. It yields every event in sequence order and returns when the runtime closes
   * the stream: the run settled, or the runtime is shutting down. Transport failures throw.
   */
  async *streamEvents(id: string, after = 0, signal?: AbortSignal): AsyncGenerator<EventEnvelope, void, undefined> {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid event cursor.");
    const headers = new Headers({ Authorization: `Bearer ${this.token}`, Accept: "text/event-stream" });
    if (after > 0) headers.set("Last-Event-ID", String(after));
    const response = await this.fetcher.call(globalThis, `${this.baseUrl}/api/v1/runs/${encodeURIComponent(id)}/stream?after=${after}`, {
      headers,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal,
    });
    if (!response.ok) throw await failureOf(response);
    if (!response.body) throw new Error("The runtime returned no event stream.");
    let cursor = after;
    for await (const frame of sseFrames(response.body)) {
      if (frame.event !== "run_event" || !frame.data) continue;
      const record = JSON.parse(frame.data) as EventEnvelope;
      if (!record.event_id || record.run_id !== id || !Number.isSafeInteger(record.sequence) || record.sequence <= cursor) {
        throw new Error("Runtime returned an event for a different run or out of sequence.");
      }
      cursor = record.sequence;
      yield record;
    }
  }

  /**
   * Follows a run's events live until it settles, reconnecting after an outage from the last
   * received sequence (the runtime comes back by itself). A rejected token, a denied action or a
   * forgotten run ends the follow with its error; everything else is reported through `hooks.outage`.
   */
  async *followEvents(id: string, after = 0, signal?: AbortSignal, hooks: FollowHooks = {}): AsyncGenerator<EventEnvelope, void, undefined> {
    let cursor = after;
    let lost = false;
    const wait = hooks.wait ?? pause;
    while (!signal?.aborted) {
      try {
        for await (const event of this.streamEvents(id, cursor, signal)) {
          if (lost) { lost = false; hooks.reconnected?.(); }
          cursor = event.sequence;
          yield event;
        }
        // A closed stream means the run settled, or the runtime is stopping: the run says which.
        const run = await this.run(id, signal);
        if (lost) { lost = false; hooks.reconnected?.(); }
        if (isTerminal(run.state)) return;
        await wait(1000, signal);
      } catch (failure) {
        if (signal?.aborted) return;
        if (failure instanceof ApiError && [401, 403, 404].includes(failure.status)) throw failure;
        lost = true;
        hooks.outage?.(failure);
        await wait(2500, signal).catch(() => undefined);
      }
    }
  }

  /** Newest first; `limit` keeps the most recent records. */
  listRuns(signal?: AbortSignal, page: PageOptions = {}): Promise<RunRecord[]> {
    return this.request(`/runs${pageQuery(page, "?")}`, { signal });
  }

  runsPage(before?: string, project?: string, signal?: AbortSignal): Promise<RunRecord[]> {
    const query = new URLSearchParams({ limit: "200" });
    if (before) query.set("before", before);
    if (project) query.set("project", project);
    return this.request(`/runs?${query}`, { signal });
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

  events(id: string, after = 0, signal?: AbortSignal, page: PageOptions = {}): Promise<EventEnvelope[]> {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid event cursor.");
    return this.request(`/runs/${encodeURIComponent(id)}/events?after=${after}${pageQuery(page, "&")}`, { signal });
  }

  eventPage(id: string, after = 0, before?: number, signal?: AbortSignal): Promise<EventEnvelope[]> {
    if (!Number.isSafeInteger(after) || after < 0 || (before !== undefined && (!Number.isSafeInteger(before) || before < 1))) throw new Error("Invalid event cursor.");
    return this.request(`/runs/${encodeURIComponent(id)}/events?after=${after}&limit=200${before === undefined ? "" : `&before=${before}`}`, { signal });
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

  projectEvents(id: string, after = 0, signal?: AbortSignal, page: PageOptions = {}): Promise<EventEnvelope[]> {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid event cursor.");
    return this.request(`/projects/${encodeURIComponent(id)}/events?after=${after}${pageQuery(page, "&")}`, { signal });
  }

  /**
   * Re-points a moved or re-identified checkout after re-inspecting it read-only; the request is
   * the developer's explicit intent. A manifest whose remote no longer matches must be confirmed again.
   */
  rebindRepository(projectId: string, repositoryId: string, request: RebindRepositoryRequest = {}, signal?: AbortSignal): Promise<ProjectView> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/repositories/${encodeURIComponent(repositoryId)}/rebind`, { method: "POST", body: JSON.stringify(request), signal });
  }

  listBaselines(id: string, signal?: AbortSignal): Promise<BaselineEvidence[]> {
    return this.request(`/projects/${encodeURIComponent(id)}/baselines`, { signal });
  }

  /** Starts a baseline run; it is an ordinary run with events, cancellation and replay. */
  startBaseline(id: string, request: StartBaselineRequest, signal?: AbortSignal): Promise<RunRecord> {
    return this.request(`/projects/${encodeURIComponent(id)}/baselines`, { method: "POST", body: JSON.stringify(request), signal });
  }

  /** Creates a ticket through the project's authoritative source. */
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

  reconcileTicket(id: string, expectedRevision: number, signal?: AbortSignal): Promise<Ticket> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("Invalid ticket revision.");
    return this.request(`/tickets/${encodeURIComponent(id)}/reconcile`, {
      method: "POST", body: JSON.stringify({ expected_revision: expectedRevision }), signal,
    });
  }

  ticketSource(id: string, signal?: AbortSignal): Promise<TicketSourceStatus> {
    return this.request(`/tickets/${encodeURIComponent(id)}/source`, { signal });
  }

  components(projectId: string, signal?: AbortSignal): Promise<ComponentStatus> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/components`, { signal });
  }

  enableComponents(projectId: string, signal?: AbortSignal): Promise<ComponentStatus> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/components`, { method: "POST", signal });
  }

  listMemory(projectId: string, options: { query?: string; includeUser?: boolean } = {}, signal?: AbortSignal): Promise<MemoryRecord[]> {
    const parameters = [options.query ? `q=${encodeURIComponent(options.query)}` : "", options.includeUser ? "include_user=true" : ""].filter(Boolean);
    const search = parameters.length ? `?${parameters.join("&")}` : "";
    return this.request(`/projects/${encodeURIComponent(projectId)}/memory${search}`, { signal });
  }

  createMemory(projectId: string, request: CreateMemoryRequest, signal?: AbortSignal): Promise<MemoryRecord> {
    if (!request.idempotency_key.trim()) throw new Error("An idempotency key is required.");
    return this.request(`/projects/${encodeURIComponent(projectId)}/memory`, { method: "POST", body: JSON.stringify(request), signal });
  }

  deleteMemory(projectId: string, id: string, expectedHash: string, signal?: AbortSignal): Promise<{ deleted: boolean }> {
    if (!expectedHash.startsWith("sha256:")) throw new Error("Delete memory by its exact content hash.");
    return this.request(`/projects/${encodeURIComponent(projectId)}/memory/${encodeURIComponent(id)}?expected_hash=${encodeURIComponent(expectedHash)}`, { method: "DELETE", signal });
  }

  /** Widens a memory's scope one step (process -> project, project -> user); the narrower record is deleted after the wider one exists. */
  promoteMemory(projectId: string, id: string, request: PromoteMemoryRequest, signal?: AbortSignal): Promise<PromotedMemory> {
    if (!request.expected_hash.startsWith("sha256:")) throw new Error("Promote memory by its exact content hash.");
    return this.request(`/projects/${encodeURIComponent(projectId)}/memory/${encodeURIComponent(id)}/promote`, { method: "POST", body: JSON.stringify(request), signal });
  }

  /** The scope-safe export: manifest, tickets, project/process memory and prompts; the runtime refuses one that would carry user memory, credentials or host paths. */
  exportProject(projectId: string, signal?: AbortSignal): Promise<ProjectExport> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/export`, { signal });
  }

  /** A deterministic scaffold proposal; nothing is written until it is confirmed by exact hash. */
  proposeScaffold(request: ScaffoldProposalRequest, signal?: AbortSignal): Promise<ScaffoldProposal> {
    return this.request(`/projects/scaffold/propose`, { method: "POST", body: JSON.stringify(request), signal });
  }

  /** Executes a confirmed proposal: files, an initial commit, the real baseline, registration. */
  scaffold(request: ScaffoldRequest, signal?: AbortSignal): Promise<ScaffoldResult> {
    if (request.confirm !== true) throw new Error("Scaffolding requires explicit confirmation of the proposal hash.");
    return this.request(`/projects/scaffold`, { method: "POST", body: JSON.stringify(request), signal });
  }

  listPrompts(projectId: string, signal?: AbortSignal): Promise<PromptRecord[]> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/prompts`, { signal });
  }

  createPrompt(projectId: string, request: CreatePromptRequest, signal?: AbortSignal): Promise<RenderedPrompt> {
    if (!request.idempotency_key.trim()) throw new Error("An idempotency key is required.");
    return this.request(`/projects/${encodeURIComponent(projectId)}/prompts`, { method: "POST", body: JSON.stringify(request), signal });
  }

  renderPrompt(projectId: string, name: string, version: number, signal?: AbortSignal): Promise<RenderedPrompt> {
    if (!Number.isSafeInteger(version) || version < 1) throw new Error("Invalid prompt version.");
    return this.request(`/projects/${encodeURIComponent(projectId)}/prompts/${encodeURIComponent(name)}/render?version=${version}`, { signal });
  }

  listPlans(ticketId: string, signal?: AbortSignal): Promise<PlanRevision[]> {
    return this.request(`/tickets/${encodeURIComponent(ticketId)}/plans`, { signal });
  }

  /** Records an immutable plan revision; the runtime binds ticket, manifest, base and recipes. */
  async createPlan(ticketId: string, request: CreatePlanRequest, signal?: AbortSignal): Promise<PlanOpened> {
    if (request.idempotency_key !== undefined && !validIdempotencyKey(request.idempotency_key)) throw new Error("An idempotency key is 1 to 128 visible ASCII characters.");
    const problem = request.budgets ? planBudgetProblem(request.budgets) : null;
    if (problem) throw new Error(problem);
    const path = `/tickets/${encodeURIComponent(ticketId)}/plans`;
    try {
      return await this.request(path, { method: "POST", body: JSON.stringify(request), signal });
    } catch (failure) {
      // A runtime that predates plan idempotency rejects the unknown field while decoding the
      // body (a 422 without a JSON reason), before anything is recorded; send it once without.
      if (!(failure instanceof ApiError) || failure.status !== 422 || failure.fromRuntime || request.idempotency_key === undefined) throw failure;
      const { idempotency_key: _unsupported, ...legacy } = request;
      return this.request(path, { method: "POST", body: JSON.stringify(legacy), signal });
    }
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

  /** Publishes a reviewed candidate: pushes its exact commits and opens linked pull requests, once per idempotency key. */
  publish(runId: string, request: PublishRequest, signal?: AbortSignal): Promise<PublicationRecord> {
    if (!request.expected_hash.startsWith("sha256:")) throw new Error("Publish by the exact candidate hash.");
    return this.request(`/runs/${encodeURIComponent(runId)}/publish`, { method: "POST", body: JSON.stringify(request), signal });
  }

  /** The durable publication record with CI and merge observation refreshed; merging is never performed. */
  publication(runId: string, signal?: AbortSignal): Promise<PublicationRecord> {
    return this.request(`/runs/${encodeURIComponent(runId)}/publication`, { signal });
  }

  /** Retries only the steps a partial publication still lacks, reconciling what the remote already has. */
  reconcilePublication(runId: string, signal?: AbortSignal): Promise<PublicationRecord> {
    return this.request(`/runs/${encodeURIComponent(runId)}/publication/reconcile`, { method: "POST", signal });
  }

  /** Sends a published candidate whose pull request failed CI to a bounded repair: the runtime re-observes CI, invalidates the reviewed evidence naming the failing checks, marks the publication superseded and starts the repair writer. */
  repairPublication(runId: string, request: CandidateActionRequest, signal?: AbortSignal): Promise<PublicationRepair> {
    if (!/^sha256:[a-f0-9]{64}$/.test(request.candidate_hash)) throw new Error("Use the candidate's complete hash.");
    return this.request(`/runs/${encodeURIComponent(runId)}/publication/repair`, { method: "POST", body: JSON.stringify(request), signal });
  }

  /** The task graph of a workflow: one durable record per plan task with its state, attempt and exact candidate commit. */
  tasks(runId: string, signal?: AbortSignal): Promise<TaskRecord[]> {
    return this.request(`/runs/${encodeURIComponent(runId)}/tasks`, { signal });
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

/** The error for a non-2xx response; a raw server body is never surfaced. */
async function failureOf(response: Response): Promise<ApiError> {
  // Do not surface arbitrary server error bodies: they can contain prompts or secrets.
  // Validation and conflict responses carry short deterministic runtime reasons.
  const messages: Record<number, string> = {
    400: "The runtime rejected these settings. Check the prompt, provider and model configuration.",
    401: "The service rejected this token. Reconnect using its current token.",
    403: "The runtime denied this action.",
    409: "The run state changed or another session is active. Refresh and try again.",
  };
  const reason = [400, 409, 413, 415, 422, 503].includes(response.status) ? await runtimeReason(response) : undefined;
  return new ApiError(response.status, reason ?? messages[response.status] ?? `Runtime request failed (HTTP ${response.status}).`, reason !== undefined);
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

/** Incremental replay for a single subscription. A rejected page never advances its cursor. */
export class EventReplay<T extends { sequence: number; event_id: string; run_id: string }> {
  private records: T[] = [];
  private identities = new Map<string, number>();

  get cursor(): number { return this.records.length; }

  append(incoming: T[]): T[] {
    const added: T[] = [];
    const identities = new Map<string, number>();
    const runId = this.records[0]?.run_id ?? incoming[0]?.run_id;
    for (const event of [...incoming].sort((a, b) => a.sequence - b.sequence)) {
      if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
        throw new Error("Runtime returned an invalid event sequence.");
      }
      if (!event.event_id || !event.run_id || event.run_id !== runId) {
        throw new Error("Runtime returned an event for a different run or with no identity.");
      }
      const existing = this.records[event.sequence - 1] ?? added[event.sequence - this.records.length - 1];
      const sequenceForId = this.identities.get(event.event_id) ?? identities.get(event.event_id);
      if ((existing && existing.event_id !== event.event_id) || (sequenceForId !== undefined && sequenceForId !== event.sequence)) {
        throw new Error("Runtime returned conflicting event identities.");
      }
      if (existing) continue;
      if (event.sequence !== this.records.length + added.length + 1) {
        throw new Error("Runtime event replay has a gap; retrying from the last contiguous sequence.");
      }
      added.push(event);
      identities.set(event.event_id, event.sequence);
    }
    if (added.length) {
      this.records = this.records.concat(added);
      for (const [id, sequence] of identities) this.identities.set(id, sequence);
    }
    // Empty/overlapping replay is a no-op, including the React state identity.
    return this.records;
  }
}

/** Pi text deltas are display data; completion remains the runtime's RunState. */
export class EventWindow {
  cursor = 0;
  records: EventEnvelope[] = [];
  private deltas = "";
  private finalText = "";
  private runId?: string;
  private readonly textLimit = 1024 * 1024;
  get text(): string { return this.finalText || this.deltas; }

  append(incoming: EventEnvelope[]): EventEnvelope[] {
    const runId = this.runId ?? incoming[0]?.run_id;
    const ids = new Set<string>();
    // Validate the complete page before advancing any display state.
    incoming.forEach((event, index) => {
      if (!event.event_id || ids.has(event.event_id) || event.run_id !== runId || event.sequence !== this.cursor + index + 1) throw new Error("Runtime event replay has a gap or invalid identity.");
      ids.add(event.event_id);
    });
    if (!incoming.length) return this.records;
    this.runId = runId;
    for (const event of incoming) {
      if (event.type === "pi.message_update") this.deltas = this.clip(this.deltas + assistantText([event]));
      if (event.type === "pi.message_end") {
        const text = assistantText([event]);
        if (text) this.finalText = this.clip(text);
      }
    }
    this.cursor = incoming[incoming.length - 1].sequence;
    const records = this.records.concat(incoming).slice(-200);
    let bytes = 0;
    let first = records.length - 1;
    for (; first >= 0; first--) {
      bytes += JSON.stringify(records[first]).length * 2;
      if (bytes > 1024 * 1024 && first < records.length - 1) break;
    }
    this.records = records.slice(first + 1);
    return this.records;
  }

  private clip(text: string): string {
    const suffix = "\n[Display limit reached. Full output remains in durable events.]";
    return text.length > this.textLimit ? text.slice(0, this.textLimit - suffix.length) + suffix : text;
  }
}

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

export * from "./failures.ts";
