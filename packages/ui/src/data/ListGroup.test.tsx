import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ListGroup } from "./ListGroup";
import { ListRow } from "./ListRow";

test("is a ul named by aria-label, selectable as ul[aria-label]", () => {
  const markup = renderToStaticMarkup(<ListGroup aria-label="Tickets" className="tickets" data-surface="board"><ListRow title="One" /><ListRow title="Two" /></ListGroup>);
  expect(markup).toMatch(/^<ul class="list-group tickets" aria-label="Tickets" data-surface="board">/);
  expect(markup.match(/<li /g)).toHaveLength(2);
});

test("the label is required by the type", () => {
  // @ts-expect-error aria-label is required
  const props: Parameters<typeof ListGroup>[0] = { children: null };
  expect(props).toBeDefined();
});

test("as=ol renders an ordered list that keeps its label", () => {
  const markup = renderToStaticMarkup(<ListGroup as="ol" aria-label="Steps"><ListRow title="One" /></ListGroup>);
  expect(markup).toMatch(/^<ol class="list-group" aria-label="Steps">/);
});
