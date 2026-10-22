import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmDialog } from "./ConfirmDialog";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => undefined;

test("the consequence is the dialog's description, and the safe action comes first", () => {
  const markup = html(<ConfirmDialog open={false} onClose={noop} title="Discard candidate" consequence="This deletes the candidate branch and its evidence. It cannot be undone." confirmLabel="Discard candidate" onConfirm={noop} />);
  const described = markup.match(/aria-describedby="([^"]+)"/)?.[1];
  expect(markup).toContain(`id="${described}">This deletes the candidate branch and its evidence. It cannot be undone.</p>`);
  expect(markup.indexOf(">Cancel</button>")).toBeLessThan(markup.indexOf(">Discard candidate</button>"));
});

test("danger is the default: a danger mark, a danger confirm button and a plain cancel", () => {
  const markup = html(<ConfirmDialog open={false} onClose={noop} title="Discard" consequence="Deletes it." confirmLabel="Discard" onConfirm={noop} />);
  expect(markup).toContain('data-tone="danger"');
  expect(markup).toContain('<button type="button" class="danger">Discard</button>');
  expect(markup).toContain('<button type="button">Cancel</button>');
});

test("a neutral confirmation uses the primary button and no danger mark", () => {
  const markup = html(<ConfirmDialog open={false} onClose={noop} tone="neutral" title="Publish" consequence="Pushes the branch." confirmLabel="Publish branch" cancelLabel="Not now" onConfirm={noop} />);
  expect(markup).toContain('<button type="button" class="primary">Publish branch</button>');
  expect(markup).toContain(">Not now</button>");
  expect(markup).not.toContain("tone-mark");
});
