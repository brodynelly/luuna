import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Chip, ChipGroup } from "./Chip";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("a toggle chip is a button with aria-pressed and a selected marker", () => {
  const off = html(<Chip onToggle={() => undefined}>Blocked</Chip>);
  expect(off).toBe('<button type="button" class="chip" aria-pressed="false"><span class="chip-text">Blocked</span></button>');
  const on = html(<Chip selected onToggle={() => undefined}>Blocked</Chip>);
  expect(on).toContain('aria-pressed="true"');
  expect(on).toContain('data-selected="true"');
});

test("a chip without onToggle is a plain span with no pressed state", () => {
  const markup = html(<Chip selected tone="attention" data-capability="a.b">Needs review</Chip>);
  expect(markup).toBe('<span data-capability="a.b" class="chip" data-selected="true"><span class="tone-mark" data-tone="attention" aria-hidden="true"></span><span class="chip-text">Needs review</span></span>');
  expect(markup).not.toContain("aria-pressed");
});

test("clicking a toggle chip reports the next state and a prevented click does not toggle", () => {
  const onToggle = vi.fn();
  const element = Chip({ selected: true, onToggle, children: "x" });
  element.props.onClick({ defaultPrevented: false });
  expect(onToggle).toHaveBeenCalledWith(false);
  element.props.onClick({ defaultPrevented: true });
  expect(onToggle).toHaveBeenCalledTimes(1);
  const off = Chip({ onToggle, children: "x" });
  off.props.onClick({ defaultPrevented: false });
  expect(onToggle).toHaveBeenLastCalledWith(true);
});

test("ChipGroup is a labelled group that passes className through", () => {
  expect(html(<ChipGroup label="Filter by state" className="mine"><Chip>One</Chip></ChipGroup>)).toBe('<div role="group" aria-label="Filter by state" class="chip-group mine"><span class="chip"><span class="chip-text">One</span></span></div>');
});
