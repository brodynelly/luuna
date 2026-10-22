import { isValidElement } from "react";
import type { ReactNode } from "react";

/** The plain text of a label, for default names and accessible names. DOM-free. */
export function labelText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(labelText).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return labelText(node.props.children);
  return "";
}

/** The default `name` of a control: a slug of its label, or its id when the label has no text. */
export function slugName(label: ReactNode, id: string): string {
  const slug = labelText(label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return slug || id;
}

/** Whether a hint or error slot has anything to show. */
export function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/** One `aria-describedby` value from several optional ids; undefined when none. */
export function describedBy(...ids: Array<string | false | undefined>): string | undefined {
  const used = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
  return used.length > 0 ? used.join(" ") : undefined;
}

/** What a labelled control receives from its field wrapper. */
export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

export interface FieldWiring { hintId: string; errorId: string; control: FieldControlProps }

/** The generated ids and control attributes of a field. Pure, so the wiring is unit-tested without a DOM. */
export function fieldWiring(id: string, state: { hint?: ReactNode; error?: ReactNode; required?: boolean; describedBy?: string }): FieldWiring {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasError = hasContent(state.error);
  return {
    hintId,
    errorId,
    control: {
      id,
      "aria-describedby": describedBy(state.describedBy, hasContent(state.hint) && hintId, hasError && errorId),
      "aria-invalid": hasError ? true : undefined,
      "aria-required": state.required ? true : undefined,
    },
  };
}

export const joinClass = (...names: Array<string | undefined | false>): string | undefined => names.filter(Boolean).join(" ") || undefined;
