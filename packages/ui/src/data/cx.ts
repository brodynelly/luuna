/** Join class names, skipping empty values. Internal to the data family. */
export function cx(...names: ReadonlyArray<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}
