import type * as Y from 'yjs';

/**
 * Tells whether two plain JSON values are equal: the same primitive (NaN equal to NaN), or arrays
 * and objects with equal members. The codec compares a field's stored value with its new value
 * this way, so a write that changes nothing adds nothing to the Yjs update log and cannot win a
 * last-writer-wins race against a real concurrent change. NaN counts as the same: a
 * command may now write an object a peer left with a NaN field, and keeping that field must not
 * rewrite its group, which would undo a concurrent change of the group's other fields.
 *
 * @param first - A plain value: a primitive, `null`, an array or a plain object.
 * @param second - The other plain value.
 * @returns `true` when the values are structurally equal.
 */
export function isSamePlainValue(first: unknown, second: unknown): boolean {
  if (first === second) return true;
  if (typeof first === 'number' && typeof second === 'number') {
    return Number.isNaN(first) && Number.isNaN(second);
  }
  if (typeof first !== 'object' || typeof second !== 'object') return false;
  if (first === null || second === null) return false;
  if (Array.isArray(first) || Array.isArray(second)) {
    return (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((member, index) => isSamePlainValue(member, second[index]))
    );
  }
  const firstRecord = first as Readonly<Record<string, unknown>>;
  const secondRecord = second as Readonly<Record<string, unknown>>;
  const keys = Object.keys(firstRecord);
  return (
    keys.length === Object.keys(secondRecord).length &&
    keys.every(
      (key) => key in secondRecord && isSamePlainValue(firstRecord[key], secondRecord[key]),
    )
  );
}

/**
 * Sets a plain value under a key of a map unless the stored value is equal, so a write that
 * changes nothing adds nothing to the update log and cannot win a race against a real
 * concurrent change.
 *
 * @param map - The map, integrated in a document.
 * @param key - The key.
 * @param value - The new plain value.
 */
export function setIfChanged(map: Y.Map<unknown>, key: string, value: unknown): void {
  if (!map.has(key) || !isSamePlainValue(map.get(key), value)) map.set(key, value);
}
