import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TONES } from "../tone/tone";
import { Timeline } from "./Timeline";
import type { TimelineItem } from "./Timeline";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const items: TimelineItem[] = [
  { id: "1", time: "09:00", dateTime: "2026-10-22T09:00", title: "Queued", tone: "neutral", status: "queued" },
  { id: "2", time: "09:05", title: "Checks ran", tone: "success", status: "passed", body: "Six checks passed." },
  { id: "3", time: "09:10", title: "Note" },
];

test("is a labelled ol with a time element per step", () => {
  const markup = html(<Timeline aria-label="Run history" items={items} className="events" data-surface="run" />);
  expect(markup).toMatch(/^<ol class="timeline events" aria-label="Run history" data-surface="run">/);
  expect(markup.match(/<li>/g)).toHaveLength(3);
  expect(markup).toContain('<time dateTime="2026-10-22T09:00">09:00</time>');
});

test("tone is a shape mark plus StatusBadge text, never a side rail on the item", () => {
  const markup = html(<Timeline aria-label="Run history" items={items} />);
  expect(markup).toContain('<span class="tone-mark" data-tone="success"></span>');
  expect(markup).toContain('<span class="state" data-tone="success">passed</span>');
  expect(markup).toContain('<span class="timeline-dot"></span>');
  expect(markup).not.toMatch(/<li[^>]*data-tone/);
  expect(markup.match(/aria-hidden="true"/g)).toHaveLength(3);
});

test("a body folds into native details under the title; without one the title is plain", () => {
  const markup = html(<Timeline aria-label="Run history" items={items} />);
  expect(markup).toContain('<details><summary class="timeline-title">Checks ran</summary><div class="timeline-body">Six checks passed.</div></details>');
  expect(markup.match(/<details>/g)).toHaveLength(1);
  expect(markup).toContain('<p class="timeline-title">Queued</p>');
});

test("every tone renders its own mark", () => {
  const markup = html(<Timeline aria-label="All" items={TONES.map((tone) => ({ id: tone, time: "t", title: tone, tone }))} />);
  for (const tone of TONES) expect(markup).toContain(`<span class="tone-mark" data-tone="${tone}">`);
});
