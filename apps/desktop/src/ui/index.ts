/**
 * The desktop's component library (ADR 0028). Views compose these; they never render a raw
 * control, heading, form or container element themselves (enforced by design-system.test.ts).
 */
export * from "./controls";
export * from "./layout";
export * from "./content";
export * from "./selection";
export * from "./shell";
export * from "./menus";
export * from "./palette";
export { StatusBadge } from "../design/StatusBadge";
export { Icon } from "../design/Icon";
export type { IconName } from "../design/Icon";
