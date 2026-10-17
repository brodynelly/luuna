import type { EventEnvelope, RunState } from "@luuna/api-client";

export function canCancel(state: RunState): boolean {
  return state === "running" || state === "implementing";
}

export function workflowReason(events: EventEnvelope[]): string {
  const event = [...events].reverse().find((event) => typeof event.payload.reason === "string");
  return typeof event?.payload.reason === "string" ? event.payload.reason : "";
}
