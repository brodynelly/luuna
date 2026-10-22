import { describe, expect, test } from "vitest";
import { applyPlatform, detectPlatform } from "./platform";

const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
const IPAD_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

describe("detectPlatform", () => {
  test("userAgentData.platform decides first", () => {
    expect(detectPlatform({ userAgentData: { platform: "macOS" } })).toBe("apple");
    expect(detectPlatform({ userAgentData: { platform: "Windows" } })).toBe("other");
    expect(detectPlatform({ userAgentData: { platform: "Linux" } })).toBe("other");
  });
  test("navigator.platform is used without userAgentData", () => {
    for (const platform of ["MacIntel", "iPhone", "iPad"]) expect(detectPlatform({ platform })).toBe("apple");
    for (const platform of ["Win32", "Linux x86_64"]) expect(detectPlatform({ platform })).toBe("other");
  });
  test("an empty platform falls back to the user agent", () => {
    expect(detectPlatform({ platform: "", userAgent: WINDOWS_UA })).toBe("other");
    expect(detectPlatform({ userAgentData: { platform: "" }, platform: "", userAgent: IPAD_DESKTOP_UA })).toBe("apple");
    expect(detectPlatform({ userAgent: ANDROID_UA })).toBe("other");
  });
  test("empty input is other", () => {
    expect(detectPlatform({})).toBe("other");
  });
  test("userAgentData.platform wins over a conflicting platform", () => {
    expect(detectPlatform({ userAgentData: { platform: "Windows" }, platform: "MacIntel" })).toBe("other");
    expect(detectPlatform({ userAgentData: { platform: "macOS" }, platform: "Win32" })).toBe("apple");
  });
});

describe("applyPlatform", () => {
  test("writes dataset.platform and returns it", () => {
    const root = { dataset: {} as Record<string, string> };
    expect(applyPlatform(root as unknown as HTMLElement, { platform: "MacIntel" })).toBe("apple");
    expect(root.dataset.platform).toBe("apple");
    expect(applyPlatform(root as unknown as HTMLElement, { platform: "Win32" })).toBe("other");
    expect(root.dataset.platform).toBe("other");
  });
});
