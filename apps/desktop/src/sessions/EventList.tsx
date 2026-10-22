import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { EventEnvelope, LuunaClient } from "@luuna/api-client";
import { describeFailure } from "../failures";
import { Button, Disclosure, ErrorBanner, Item, Meta, Output, ScrollList, Toolbar } from "../ui";

/** One durable event: its sequence, type and time; the payload renders only while open. */
const EventRow = memo(function EventRow({ event }: { event: EventEnvelope }) {
  const [open, setOpen] = useState(event.type.includes("error") || event.type === "run.failed");
  const payload = useMemo(() => open ? JSON.stringify(event.payload, null, 2) : "", [event, open]);
  const summary = <><span className="event-number">{event.sequence}</span><span>{event.type}</span><time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleTimeString()}</time></>;
  return <Item><Disclosure summary={summary} section={false} open={open} onToggle={setOpen}>{open && <Output>{payload}</Output>}</Disclosure></Item>;
});

/** The session's event record with paging through older and newer pages (ADR 0015). */
export const EventList = memo(function EventList({ events, client, runId }: { events: EventEnvelope[]; client: LuunaClient; runId: string }) {
  const [page, setPage] = useState<EventEnvelope[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);

  const shown = page ?? events;
  const first = shown[0]?.sequence ?? 1;
  const last = shown.at(-1)?.sequence ?? 0;
  async function browse(earlier: boolean) {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await client.eventPage(runId, earlier ? 0 : last, earlier ? first : undefined, controller.signal);
      if (!controller.signal.aborted && result.length) setPage(result);
    } catch (failure) {
      if (!controller.signal.aborted) setError(describeFailure(failure));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  const paging = <>
    <Button variant="text" disabled={loading || first === 1} onClick={() => void browse(true)}>Earlier events</Button>
    <Button variant="text" disabled={loading || last >= (events.at(-1)?.sequence ?? 0)} onClick={() => void browse(false)}>Later events</Button>
    <Button variant="text" disabled={page === null} onClick={() => { operation.current?.abort(); setLoading(false); setPage(null); }}>Latest events</Button>
  </>;
  return <>
    {(first > 1 || page !== null) && <Toolbar><Meta>Events {first}–{last}</Meta>{paging}</Toolbar>}
    {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
    <ScrollList label="Durable session events" data-capability="runs.events runs.stream">{shown.map((event) => <EventRow key={event.event_id} event={event} />)}</ScrollList>
  </>;
});

