import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ShortId, shortHash, shortId } from "./index";

const TICKET = "ticket-3f2a91c0-1b2c-4d5e-8f90-0123456789ab";
const HASH = `sha256:${"ab12".repeat(16)}`;

test("a short id is the first eight hex digits of the generated UUID, the same one the terminal accepts", () => {
  expect(shortId(TICKET)).toBe("3f2a91c0");
  expect(shortId(`plan-${TICKET}`)).toBe("3f2a91c0");
  expect(shortId("workflow-8B1E0000-1b2c-4d5e-8f90-0123456789ab")).toBe("8b1e0000");
  expect(shortId("walkthrough")).toBe("walkthrough");
  expect(shortId("plan-1")).toBe("plan-1");
  expect(shortHash(HASH)).toBe("sha256:ab12ab12ab12");
  expect(shortHash("sha256:abc")).toBe("sha256:abc");
});

test("ShortId shows the short form, keeps the whole value as its tooltip and labels the copy", () => {
  const html = renderToStaticMarkup(<ShortId value={TICKET} kind="ticket" />);
  expect(html).toContain("<code>3f2a91c0…</code>");
  expect(html).toContain(`title="${TICKET} · click to copy"`);
  expect(html).toContain(`aria-label="Copy ticket ${TICKET}"`);
  expect(renderToStaticMarkup(<ShortId value={HASH} />)).toContain("<code>sha256:ab12ab12ab12…</code>");
  expect(renderToStaticMarkup(<ShortId value="plan-1" />)).toContain("<code>plan-1</code>");
});
