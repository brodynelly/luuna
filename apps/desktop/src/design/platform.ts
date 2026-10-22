// Platform detection for font selection (fonts.css). Apple platforms keep Ledger's system stack;
// every other platform puts the bundled Söhne first. Pure and DOM-free so it is unit-testable.
export type Platform = "apple" | "other";
export interface PlatformSource { userAgentData?: { platform?: string } | undefined; platform?: string; userAgent?: string }

// \b keeps "AppleWebKit" (present in Windows Chromium user agents) from matching.
const APPLE = /\b(?:mac|iphone|ipad|ipod)/i;

export function detectPlatform(source: PlatformSource): Platform {
  const value = [source.userAgentData?.platform, source.platform, source.userAgent].find((candidate) => typeof candidate === "string" && candidate.length > 0);
  return value !== undefined && APPLE.test(value) ? "apple" : "other";
}

export function applyPlatform(root: HTMLElement, source: PlatformSource): Platform {
  const platform = detectPlatform(source);
  root.dataset.platform = platform;
  return platform;
}
