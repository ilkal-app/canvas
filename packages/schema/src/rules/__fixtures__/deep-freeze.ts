/**
 * Freezes a value and everything reachable from it, including the entries of maps, so a test
 * fails if a pure function writes to its input. Map entries are frozen but the map itself is
 * left alone (freezing a map does not stop `set`); tests compare maps before and after instead.
 *
 * @param value - The value to freeze.
 * @returns The same value, now deeply frozen.
 */
export function deepFreeze<Value>(value: Value): Value {
  if (value instanceof Map) {
    for (const entry of value.values()) deepFreeze(entry);
    return value;
  }
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const property of Object.values(value)) deepFreeze(property);
  }
  return value;
}
