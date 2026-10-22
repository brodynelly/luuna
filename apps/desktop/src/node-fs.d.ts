// Minimal Node typings for the design-system tests: the workspace has no @types/node, and Vitest
// replaces `*.css?raw` imports with an empty string, so stylesheets are read with node:fs.
declare module "node:fs" {
  export interface Bytes { length: number; readUInt16BE(offset: number): number; readUInt32BE(offset: number): number; toString(encoding: "latin1", start: number, end: number): string }
  export function readFileSync(path: URL): Bytes;
  export function readFileSync(path: URL, encoding: "utf8" | "latin1"): string;
  export function readdirSync(path: URL, options: { recursive: true }): string[];
}
