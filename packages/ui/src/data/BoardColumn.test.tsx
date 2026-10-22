import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BoardColumn } from "./BoardColumn";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("is a section named by its heading, with a visible count that reads in words", () => {
  const markup = html(<BoardColumn title="Ready" count={3} countLabel="tickets" scope="Waiting to start." className="ready" data-surface="board" />);
  const id = /<h3 id="([^"]+)">Ready<\/h3>/.exec(markup)![1];
  expect(markup).toContain(`<section class="board-column ready" aria-labelledby="${id}" data-surface="board">`);
  expect(markup).toContain('<span class="board-column-count">3<span class="visually-hidden"> tickets</span></span>');
  expect(markup).toContain('<p class="scope">Waiting to start.</p>');
});

test("the body can be a list and the heading level adjusts", () => {
  const markup = html(<BoardColumn title="Done" count={1} as="ul" headingLevel={4}><li>One</li></BoardColumn>);
  expect(markup).toContain("<h4 ");
  expect(markup).toMatch(/<ul class="board-column-body" aria-labelledby="[^"]+"><li>One<\/li><\/ul>/);
  expect(html(<BoardColumn title="Empty" count={0} />)).toContain('<div class="board-column-body"></div>');
});

test("two columns get distinct heading ids", () => {
  const markup = html(<><BoardColumn title="A" count={0} /><BoardColumn title="B" count={0} /></>);
  const ids = [...markup.matchAll(/<h3 id="([^"]+)"/g)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(2);
});

test("headingId is used verbatim and labels the list body; className and bodyClassName pass through", () => {
  const markup = html(<BoardColumn title="Ready" count={1} headingId="col-ready" as="ul" className="mine" bodyClassName="cards"><li>x</li></BoardColumn>);
  expect(markup).toContain('<h3 id="col-ready">Ready</h3>');
  expect(markup).toContain('aria-labelledby="col-ready"');
  expect(markup).toContain('<ul class="board-column-body cards" aria-labelledby="col-ready">');
  expect(markup).toContain('class="board-column mine"');
  expect(html(<BoardColumn title="Ready" count={1} headingId="c" />)).toContain('<div class="board-column-body"></div>');
});
