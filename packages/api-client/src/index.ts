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
      const messages: Record<number, string> = {
        400: "The runtime rejected these settings. Check the prompt, provider and model configuration.",
        401: "The service rejected this token. Reconnect using its current token.",
        403: "The runtime denied this action.",
        409: "The run state changed or another session is active. Refresh and try again.",
      };
      throw new ApiError(response.status, messages[response.status] ?? `Runtime request failed (HTTP ${response.status}).`);
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
