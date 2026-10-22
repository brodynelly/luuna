/** Joins the class names that are present. */
export const cx = (...names: ReadonlyArray<string | false | null | undefined>): string => names.filter(Boolean).join(" ");
