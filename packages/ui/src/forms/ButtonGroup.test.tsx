import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../controls";
import { ButtonGroup } from "./ButtonGroup";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("ButtonGroup is a labelled group of its buttons in DOM order", () => {
  expect(html(<ButtonGroup label="View"><Button>List</Button><Button>Board</Button></ButtonGroup>)).toBe('<div role="group" aria-label="View" class="button-group"><button type="button">List</button><button type="button">Board</button></div>');
});

test("attached joins the buttons and className and data attributes pass through", () => {
  const markup = html(<ButtonGroup label="View" attached className="mine" data-surface="board"><Button>A</Button></ButtonGroup>);
  expect(markup).toContain('data-attached="true"');
  expect(markup).toContain('class="button-group mine"');
  expect(markup).toContain('data-surface="board"');
});
