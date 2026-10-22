import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EventLog } from "./EventLog";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const events = [{ id: 1, text: "started" }, { id: 2, text: "finished" }];
const log = (extra: Partial<Parameters<typeof EventLog<(typeof events)[number]>>[0]> = {}) =>
  <EventLog aria-label="Session events" events={events} eventKey={(event) => event.id} renderEvent={(event) => event.text} {...extra} />;

test("is the ol.events pattern: focusable, labelled and quiet by default", () => {
  const markup = html(log({ className: "events", "data-capability": "sessions.events" } as never));
  expect(markup).toMatch(/^<ol class="events event-log events" tabindex="0" aria-live="off"/);
  expect(markup).toContain('aria-label="Session events"');
  expect(markup).toContain('data-capability="sessions.events"');
  expect(markup).toContain("<li>started</li><li>finished</li>");
  expect(markup).not.toContain("role=");
});

test("live mode announces additions politely", () => {
  const markup = html(log({ live: true }));
  expect(markup).toContain('aria-live="polite" aria-relevant="additions"');
});

test("a separate polite summary is rendered outside the stream", () => {
  const markup = html(log({ summary: "2 events, last: finished" }));
  expect(markup).toMatch(/^<p class="visually-hidden" role="status">2 events, last: finished<\/p><ol/);
});

test("no events shows the empty row", () => {
  expect(html(log({ events: [], empty: "Nothing yet" }))).toContain('<li class="event-log-empty">Nothing yet</li>');
});

test("empty accepts a node, and null renders nothing", () => {
  expect(html(log({ events: [], empty: <b>Quiet</b> }))).toContain('<li class="event-log-empty"><b>Quiet</b></li>');
  expect(html(log({ events: [], empty: null }))).not.toContain("event-log-empty");
});

test("follow is accepted without changing the markup or adding motion hooks", () => {
  const plain = html(log());
  const following = html(log({ follow: true, followKey: events.length }));
  expect(following).toBe(plain);
  expect(following).not.toMatch(/style=|transform|opacity/);
  expect(html(log({ follow: false }))).toBe(plain);
});
