/**
 * Compares decoded plain override values independent of record allocation and key order.
 * A placement decode rebuilds its override map even when no override changed.
 *
 * @param before - Previous JSON-compatible override value.
 * @param after - Current JSON-compatible override value.
 * @returns Whether the values have the same content.
 */
export function equalOverrides(before: unknown, after: unknown): boolean {
  if (before === after) return true;
  if (
    before === null ||
    after === null ||
    typeof before !== 'object' ||
    typeof after !== 'object'
  ) {
    return false;
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    return (
      Array.isArray(before) &&
      Array.isArray(after) &&
      before.length === after.length &&
      before.every((value: unknown, index) => equalOverrides(value, after[index]))
    );
  }
  const left = before as Readonly<Record<string, unknown>>;
  const right = after as Readonly<Record<string, unknown>>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && equalOverrides(left[key], right[key]))
  );
}
