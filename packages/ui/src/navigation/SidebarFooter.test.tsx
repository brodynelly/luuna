import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarFooter } from "./SidebarFooter";

test("holds its children in a plain sidebar-footer block with no landmark", () => {
  const markup = renderToStaticMarkup(<SidebarFooter data-capability="shell.footer" className="x"><span role="status">Connected</span></SidebarFooter>);
  expect(markup).toBe('<div class="sidebar-footer x" data-capability="shell.footer"><span role="status">Connected</span></div>');
  expect(markup).not.toMatch(/<(?:nav|aside|footer)/);
});
