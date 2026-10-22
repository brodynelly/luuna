import type { MemoryRetentionPolicy, MemoryScope } from "@luuna/api-client";

/** Keeps retry delivery identity stable until the form content changes or succeeds. */
export function retryIdentity(previous: { content: string; key: string } | null, content: string, create: () => string = () => crypto.randomUUID()) {
  return previous?.content === content ? previous : { content, key: create() };
}

export type PromptDelivery = { content: string; key: string; expectedVersion: number; refused?: boolean };

export function promptRetryIdentity(previous: PromptDelivery | null, content: string, expectedVersion: number, create: () => string = () => crypto.randomUUID()): PromptDelivery {
  return previous?.content === content ? previous : { ...retryIdentity(null, content, create), expectedVersion };
}

export function promptDeliveryAfterPreview(previous: PromptDelivery | null, currentVersion: number) {
  return previous?.refused && previous.expectedVersion !== currentVersion ? null : previous;
}

export function promptEditBody(body: string) {
  const prefix = "## guidance\n";
  return body.startsWith(prefix) && body.endsWith("\n") ? body.slice(prefix.length, -1) : body;
}

/** The one wider scope a memory may move to; `null` for user memory, which is already the widest. */
export function promotionTarget(scope: MemoryScope): "project" | "user" | null {
  return scope === "process" ? "project" : scope === "project" ? "user" : null;
}

/** The retention form's text fields as a policy; an empty field keeps that scope's records. */
export function retentionPolicyFromForm(processDays: string, projectDays: string): MemoryRetentionPolicy {
  const days = (text: string) => (text.trim() === "" ? null : Number(text));
  return { process_max_age_days: days(processDays), project_max_age_days: days(projectDays) };
}

/** The memory scopes a record may be saved in, as the scope select lists them. */
export const MEMORY_SCOPES: readonly { value: MemoryScope; label: string }[] = [
  { value: "project", label: "Project" },
  { value: "process", label: "Process" },
  { value: "user", label: "Private user" },
];
