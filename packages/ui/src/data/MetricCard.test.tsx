import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MetricCard } from "./MetricCard";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("is a dl with the label, a static value and an optional hint, and no tone", () => {
  const markup = html(<MetricCard label="Open tickets" value={12} hint="+3 since yesterday" className="wide" />);
  expect(markup).toBe('<dl class="metric-card wide"><dt>Open tickets</dt><dd class="metric-value">12</dd><dd class="metric-hint">+3 since yesterday</dd></dl>');
  expect(markup).not.toContain("data-tone");
});

test("the empty state says No data instead of a figure", () => {
  const markup = html(<MetricCard label="Pass rate" value="0%" empty />);
  expect(markup).toContain('<dd class="metric-value metric-empty">No data</dd>');
  expect(markup).not.toContain("0%");
  expect(html(<MetricCard label="Pass rate" value="" empty emptyLabel="Not measured" />)).toContain("Not measured");
});

test("passes aria and data props through", () => {
  expect(html(<MetricCard label="A" value={1} aria-label="Metric A" data-surface="home" />)).toContain('aria-label="Metric A" data-surface="home"');
});
