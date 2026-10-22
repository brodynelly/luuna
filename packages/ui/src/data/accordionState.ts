/** DOM-free open-state rules for Accordion. */
export interface OpenRule { id: string; defaultOpen?: boolean }

/** Ids that start open. In single-open mode only the first `defaultOpen` item counts. */
export function initialOpen(items: readonly OpenRule[], multiple: boolean): string[] {
  const wanted = items.filter((item) => item.defaultOpen).map((item) => item.id);
  return multiple ? wanted : wanted.slice(0, 1);
}

/** Shared `name` that makes native `details` mutually exclusive; undefined when several may be open. */
export function groupName(multiple: boolean, generated: string, explicit?: string): string | undefined {
  return multiple ? undefined : (explicit ?? generated);
}
