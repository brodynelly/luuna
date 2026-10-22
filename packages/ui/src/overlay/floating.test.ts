import { expect, test } from "vitest";
import { applyPlacement } from "./floating";

function fakePanel() {
  const properties = new Map<string, string>();
  const attributes = new Map<string, string>();
  return {
    properties, attributes,
    offsetWidth: 200, offsetHeight: 100,
    style: { setProperty: (name: string, value: string) => { properties.set(name, value); } },
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
  };
}
const anchor = (left: number, top: number) => ({ getBoundingClientRect: () => ({ left, top, width: 80, height: 30 }) });

test("the position is written as two custom properties and the resolved side as data-placement, never as inline style", () => {
  const panel = fakePanel();
  const result = applyPlacement(anchor(300, 200), panel, { width: 1000, height: 800 }, "bottom-start", 4);
  expect(result).toEqual({ x: 300, y: 234, placement: "bottom-start" });
  expect(panel.properties.get("--float-x")).toBe("300px");
  expect(panel.properties.get("--float-y")).toBe("234px");
  expect([...panel.properties.keys()]).toEqual(["--float-x", "--float-y"]);
  expect(panel.attributes.get("data-placement")).toBe("bottom-start");
});

test("a flip is reported through data-placement", () => {
  const panel = fakePanel();
  applyPlacement(anchor(300, 760), panel, { width: 1000, height: 800 }, "bottom-start", 4);
  expect(panel.attributes.get("data-placement")).toBe("top-start");
});
