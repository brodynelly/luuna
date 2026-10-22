import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Stepper } from "./Stepper";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("is a labelled ordered list with exactly one aria-current=step", () => {
  const markup = html(<Stepper aria-label="Plan progress" current="b" steps={[{ id: "a", label: "Scope", state: "complete" }, { id: "b", label: "Review" }, { id: "c", label: "Publish" }]} />);
  expect(markup).toMatch(/^<ol class="stepper" aria-label="Plan progress">/);
  expect(markup.match(/<li /g)).toHaveLength(3);
  expect(markup.match(/aria-current="step"/g)).toHaveLength(1);
  expect(markup).toMatch(/data-state="current" data-tone="active" aria-current="step"/);
});

test("every step carries a decorative tone mark and its state as text", () => {
  const markup = html(<Stepper aria-label="Steps" steps={[{ id: "a", label: "A", state: "complete" }, { id: "b", label: "B", state: "blocked" }, { id: "c", label: "C", state: "attention" }, { id: "d", label: "D" }]} />);
  expect(markup.match(/<i class="tone-mark" data-tone="[a-z]+" aria-hidden="true"/g)).toHaveLength(4);
  for (const text of ["Complete", "Blocked", "Needs you", "Not started"]) expect(markup).toContain(`<span class="stepper-state">${text}</span>`);
});

test("without a state nothing is complete, and rest props pass through", () => {
  const markup = html(<Stepper aria-label="Steps" current="b" className="x" data-capability="s" steps={[{ id: "a", label: "A" }, { id: "b", label: "B" }]} />);
  expect(markup).not.toContain("Complete");
  expect(markup).toContain('class="stepper x"');
  expect(markup).toContain('data-capability="s"');
});

test("a step's detail renders under its label, and is absent without one", () => {
  const markup = html(<Stepper aria-label="Steps" steps={[{ id: "a", label: "Scope", detail: "Two repositories" }, { id: "b", label: "Review" }]} />);
  expect(markup).toContain('<span class="stepper-text"><span class="stepper-label">Scope</span><span class="stepper-detail">Two repositories</span></span>');
  expect(markup.match(/stepper-detail/g)).toHaveLength(1);
});
