/** UTC form display may use millisecond precision. Untouched historical values
 * retain the exact original string, including offsets and extra precision. */
export function statusUtcInput(value: string | null | undefined) {
  return value ? new Date(value).toISOString().slice(0,-1) : "";
}
export function statusUtcValue(value: string, original?: string | null) {
  if (original && value === statusUtcInput(original)) return original;
  if (!value) return null;
  return new Date(/[zZ]$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`).toISOString();
}
