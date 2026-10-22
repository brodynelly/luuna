import type { HTMLAttributes, ReactNode } from "react";
import { useStickyScroll } from "../useStickyScroll";
import { cx } from "./cx";

export interface EventLogProps<T> extends Omit<HTMLAttributes<HTMLOListElement>, "children"> {
  events: readonly T[];
  /** The content of one event's list item. */
  renderEvent: (event: T, index: number) => ReactNode;
  eventKey: (event: T, index: number) => string | number;
  /** Required: the log is a focusable scroll region found by its name. */
  "aria-label": string;
  /** Announce additions politely. Off by default: streams must not read every line aloud. */
  live?: boolean;
  /** A separate, polite summary for assistive technology (for example "42 events, last: completed"). */
  summary?: ReactNode;
  /** Shown in place of rows when there are no events. `null` renders nothing; the default is "No events yet". */
  empty?: ReactNode;
  /**
   * Keep the log pinned to its newest row while the reader is at the end (ADR 0031, the same controller as `ScrollList`).
   * Scrolling up, the wheel, keys or a pointer press release it; reaching the end again re-pins. It writes `scrollTop` only:
   * no transform, no opacity, no state. `false` turns following off; leave it unset for a log that never follows.
   */
  follow?: boolean;
  /** Any value that changes when content changes (a count, the last event id). Defaults to the number of events. */
  followKey?: unknown;
}

/**
 * The `ol.events` pattern: a focusable, labelled, scrollable list of event rows. It adds no motion of its own, so
 * live output never moves while it is read. Row styling comes from the shared `.events` rules.
 */
export function EventLog<T>({ events, renderEvent, eventKey, live = false, summary, empty = "No events yet", follow, followKey, className, ...rest }: EventLogProps<T>) {
  const ref = useStickyScroll<HTMLOListElement>({ enabled: follow ?? false, followKey: followKey ?? events.length });
  return <>
    {summary !== undefined && <p className="visually-hidden" role="status">{summary}</p>}
    <ol className={cx("events", "event-log", className)} tabIndex={0} aria-live={live ? "polite" : "off"} aria-relevant={live ? "additions" : undefined} ref={follow === undefined ? undefined : ref} {...rest}>
      {events.length === 0 && empty !== null && <li className="event-log-empty">{empty}</li>}
      {events.map((event, index) => <li key={eventKey(event, index)}>{renderEvent(event, index)}</li>)}
    </ol>
  </>;
}
