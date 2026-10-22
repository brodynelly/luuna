import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Skeleton } from "./Skeleton";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("a skeleton is hidden from assistive technology and draws one row by default", () => {
  const markup = html(<Skeleton />);
  expect(markup).toContain('aria-hidden="true"');
  expect(markup).toContain('data-height="md"');
  expect(markup.match(/ov-skeleton-row/g)).toHaveLength(1);
});

test("lines sets the row count, never fewer than one", () => {
  expect(html(<Skeleton lines={4} />).match(/ov-skeleton-row/g)).toHaveLength(4);
  expect(html(<Skeleton lines={0} />).match(/ov-skeleton-row/g)).toHaveLength(1);
  expect(html(<Skeleton lines={2.9} />).match(/ov-skeleton-row/g)).toHaveLength(2);
});

test("height picks a row size and pass-through props land on the wrapper", () => {
  const markup = html(<Skeleton height="lg" className="card-loading" data-surface="board" />);
  expect(markup).toContain('data-height="lg"');
  expect(markup).toContain('class="ov-skeleton card-loading"');
  expect(markup).toContain('data-surface="board"');
});

test("nothing animates: there is no role, no live region and no pulse class", () => {
  const markup = html(<Skeleton lines={3} />);
  expect(markup).not.toMatch(/role=|aria-live|pulse|shimmer/);
});
