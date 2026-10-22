import type { HTMLAttributes, ReactNode } from "react";
import { StatusBadge } from "../StatusBadge";
import type { Tone } from "../tone/tone";
import { cx } from "./cx";

export interface TimelineItem {
  id: string;
  /** Display text for the time, already formatted by the caller. */
  time: string;
  /** Machine-readable value for the `time` element. */
  dateTime?: string;
  title: ReactNode;
  /** Colour and shape mark for the marker. Pair it with `status` so the text channel is present too. */
  tone?: Tone;
  /** The runtime's word for this step, rendered through StatusBadge. */
  status?: ReactNode;
  /** Optional detail, folded in a native `details` under the title. */
  body?: ReactNode;
}

export interface TimelineProps extends HTMLAttributes<HTMLOListElement> {
  items: readonly TimelineItem[];
  /** Required: an `ol` of events is found by its name. */
  "aria-label": string;
}

/** Ordered steps with a marker column. The marker shape carries the tone; the connector is always neutral. */
export function Timeline({ items, className, ...rest }: TimelineProps) {
  return <ol className={cx("timeline", className)} {...rest}>
    {items.map((item) => <li key={item.id}>
      <span className="timeline-marker" aria-hidden="true">{item.tone ? <span className="tone-mark" data-tone={item.tone} /> : <span className="timeline-dot" />}</span>
      <div className="timeline-content">
        <p className="timeline-head">
          <time dateTime={item.dateTime}>{item.time}</time>
          {item.status !== undefined && <StatusBadge tone={item.tone}>{item.status}</StatusBadge>}
        </p>
        {item.body === undefined
          ? <p className="timeline-title">{item.title}</p>
          : <details><summary className="timeline-title">{item.title}</summary><div className="timeline-body">{item.body}</div></details>}
      </div>
    </li>)}
  </ol>;
}
