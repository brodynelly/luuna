import type { EventEnvelope } from "@luuna/api-client";
import { Disclosure, Item, Output, ScrollList } from "../ui";

/**
 * A durable event record as a labelled, focusable scroll region of disclosures, one per event.
 */
export function EventRecord({ label, events }: { label: string; events: readonly EventEnvelope[] }) {
  return <ScrollList label={label}>{events.map((event) => <Item key={event.event_id}>
    <Disclosure section={false} summary={<><span className="event-number">{event.sequence}</span><span>{event.type}</span></>}>
      <Output>{JSON.stringify(event.payload, null, 2)}</Output>
    </Disclosure>
  </Item>)}</ScrollList>;
}
