import type { EventEnvelope } from "@luuna/api-client";
import { Output, ScrollArea, Timeline } from "@luuna/ui";

/**
 * A durable event record as a labelled, focusable scroll region of timeline steps, one per
 * event; each step folds its payload.
 */
export function EventRecord({ label, events }: { label: string; events: readonly EventEnvelope[] }) {
  return <ScrollArea label={label} maxHeight="scroll">
    <Timeline aria-label="Project events" items={events.map((event) => ({
      id: event.event_id, time: event.timestamp, dateTime: event.timestamp, title: <><span className="event-number">{event.sequence}</span> <span>{event.type}</span></>,
      body: <Output>{JSON.stringify(event.payload, null, 2)}</Output>,
    }))} />
  </ScrollArea>;
}
