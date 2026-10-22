import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Aurora, Button, CheckDraw, CountUp, EmptyState, GlowSurface, Loading, Placeholder, ProgressBar, RecordList, Reveal, StreamingDots, Switch, TabPanel, Table, Tabs } from "./index";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("CountUp renders the final value in static markup and respects a custom format", () => {
  expect(html(<CountUp value={1234} />)).toBe('<span class="count-up">1234</span>');
  expect(html(<CountUp value={5} format={(n) => `${n} runs`} className="big" />)).toBe('<span class="count-up big">5 runs</span>');
});

test("Reveal renders its class with no inline style, and a group only when labelled", () => {
  expect(html(<Reveal><span>a</span></Reveal>)).toBe('<div class="reveal"><span>a</span></div>');
  expect(html(<Reveal label="Cards"><span>a</span></Reveal>)).toBe('<div class="reveal" role="group" aria-label="Cards"><span>a</span></div>');
});

test("CheckDraw is decorative without a label and an image with one", () => {
  const plain = html(<CheckDraw />);
  expect(plain).toContain('aria-hidden="true"');
  expect(plain).toContain('focusable="false"');
  expect(plain).not.toContain("role=");
  expect(plain.match(/pathLength="1"/g)).toHaveLength(2);
  const named = html(<CheckDraw label="Passed" size="lg" />);
  expect(named).toContain('role="img"');
  expect(named).toContain('aria-label="Passed"');
  expect(named).toContain('data-size="lg"');
  expect(named).not.toContain("aria-hidden");
});

test("Aurora is aria-hidden and subtle by default", () => {
  expect(html(<Aurora />)).toBe('<div class="aurora" data-intensity="subtle" aria-hidden="true"></div>');
  expect(html(<Aurora intensity="vivid" />)).toContain('data-intensity="vivid"');
});

test("GlowSurface is a card with the glow class and keeps role group when labelled", () => {
  expect(html(<GlowSurface>x</GlowSurface>)).toBe('<div class="card glow-surface">x</div>');
  expect(html(<GlowSurface label="Hero" className="hero">x</GlowSurface>)).toBe('<div class="card glow-surface hero" role="group" aria-label="Hero">x</div>');
});

test("Tabs have tablist semantics, one selected tab, a roving tabindex, paired ids and one hidden indicator", () => {
  const markup = html(<Tabs label="Sections" idPrefix="s" selected="b" onSelect={() => undefined} tabs={[{ id: "a", label: "A" }, { id: "b", label: "B", "data-capability": "x.y" }, { id: "c", label: "C", disabled: true }]} />);
  expect(markup).toContain('role="tablist" aria-label="Sections"');
  expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
  expect(markup.match(/aria-selected="false"/g)).toHaveLength(2);
  expect(markup).toContain('id="s-tab-b" aria-selected="true" aria-controls="s-panel-b" tabindex="0"');
  expect(markup).toContain('id="s-tab-a" aria-selected="false" aria-controls="s-panel-a" tabindex="-1"');
  expect(markup).toContain('data-capability="x.y"');
  expect(markup).toContain("disabled");
  expect(markup.match(/class="tab-indicator" aria-hidden="true"/g)).toHaveLength(1);
  expect(markup).not.toContain("data-measured");
  const panel = html(<TabPanel id="b" idPrefix="s" selected={false}>body</TabPanel>);
  expect(panel).toBe('<div role="tabpanel" id="s-panel-b" aria-labelledby="s-tab-b" hidden="">body</div>');
});

test("Switch is a checkbox with the switch role inside its label", () => {
  expect(html(<Switch label="Follow output" defaultChecked />)).toBe('<label class="switch"><input type="checkbox" role="switch" checked=""/> Follow output</label>');
});

test("Table has labelled columns, scoped headers and numeric cells", () => {
  const markup = html(<Table label="Runs" rowKey={(row) => row.id} rows={[{ id: "r1", name: "one", count: 3 }]} columns={[{ id: "name", header: "Name", cell: (row) => row.name }, { id: "count", header: "Count", numeric: true, cell: (row) => row.count }]} />);
  expect(markup).toContain('<table class="table" aria-label="Runs">');
  expect(markup.match(/<th scope="col"/g)).toHaveLength(2);
  expect(markup).toContain('<th scope="col" data-numeric="">Count</th>');
  expect(markup).toContain('<td data-numeric="">3</td>');
  expect(markup).toContain("<td>one</td>");
});

test("ProgressBar is indeterminate and StreamingDots is decorative unless labelled", () => {
  expect(html(<ProgressBar label="Loading plan" />)).toBe('<div class="progress-bar" role="progressbar" aria-label="Loading plan"></div>');
  expect(html(<ProgressBar label="x" />)).not.toContain("aria-valuenow");
  expect(html(<StreamingDots />)).toBe('<span class="streaming-dots" aria-hidden="true"><span></span><span></span><span></span></span>');
  expect(html(<StreamingDots label="Streaming" />)).toBe('<span class="streaming-dots" role="img" aria-label="Streaming"><span></span><span></span><span></span></span>');
});

test("RecordList, EmptyState and Button render the same markup as before when the new props are omitted", () => {
  expect(html(<RecordList label="Checks" data-capability="a.b"><li>x</li></RecordList>)).toBe('<ul class="record-list" aria-label="Checks" data-capability="a.b"><li>x</li></ul>');
  expect(html(<RecordList className="mine"><li>x</li></RecordList>)).toBe('<ul class="mine record-list"><li>x</li></ul>');
  expect(html(<EmptyState>Nothing</EmptyState>)).toBe('<p class="empty">Nothing</p>');
  expect(html(<EmptyState boxed title="T" action={<Button>Go</Button>}>Body</EmptyState>)).toBe('<div class="empty-state empty-box"><p class="empty-title">T</p><p class="empty">Body</p><button type="button">Go</button></div>');
  expect(html(<Button variant="primary" submit>Save</Button>)).toBe('<button class="primary">Save</button>');
  expect(html(<Button>Go</Button>)).toBe('<button type="button">Go</button>');
});

test("the new optional props add only their documented markup", () => {
  expect(html(<RecordList variant="rows" reveal><li>x</li></RecordList>)).toBe('<ul class="record-list record-rows reveal"><li>x</li></ul>');
  expect(html(<EmptyState title="T" wash>Body</EmptyState>)).toBe('<div class="empty-state aurora-host"><div class="aurora" data-intensity="subtle" aria-hidden="true"></div><p class="empty-title">T</p><p class="empty">Body</p></div>');
  expect(html(<Button variant="quiet">Q</Button>)).toBe('<button type="button" class="quiet">Q</button>');
});

test("Loading and Placeholder keep their markup after the move to feedback", () => {
  expect(html(<Loading label="Loading runs" rows={1} />)).toBe('<div class="skeleton" role="status" aria-live="polite"><span class="visually-hidden">Loading runs</span><span class="skeleton-row" aria-hidden="true"></span></div>');
  expect(html(<Placeholder title="Pick a run" />)).toBe('<div class="activity-empty empty-box"><span aria-hidden="true">◌</span><p>Pick a run</p></div>');
});
