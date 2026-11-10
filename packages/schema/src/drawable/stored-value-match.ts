// The rewrite rule of the relay's door check (part 1 fix round 1): a value a write
// leaves as the board already holds it never makes the board worse (a value past its
// limit may stay), so the door judges only what a write changes. An honest command that moves
// a note whose stored rotation is 1e300 rewrites its whole `placement` group with that rotation;
// the door must let the rotation through and judge only the new `x`.

/** A value the board holds at a place. */
export interface StoredValue {
  /** The value, as stored (which may be `undefined` itself). */
  readonly value: unknown;
}

/**
 * Reads what the board holds where a value is written, or `undefined` when nothing is stored
 * there. Called at most once per judged value, and only when something in it would be refused.
 */
export type StoredValueReader = () => StoredValue | undefined;

/**
 * Tells whether two plain values are the same: equal primitives (NaN equal to NaN), or arrays
 * and records of the same values under the same keys. The door's equality rule: a field written
 * as the board holds it by this test is not judged. The command layer decides which fields a
 * write changes by the same test, so what it leaves unjudged the door leaves too. Pure.
 *
 * @param first - One value.
 * @param second - The other.
 * @returns True when they are the same.
 */
export function isSameValue(first: unknown, second: unknown): boolean {
  if (first === second) return true;
  if (typeof first === 'number' && typeof second === 'number') {
    return Number.isNaN(first) && Number.isNaN(second);
  }
  if (typeof first !== 'object' || typeof second !== 'object') return false;
  if (first === null || second === null) return false;
  if (Array.isArray(first) !== Array.isArray(second)) return false;
  const firstKeys = Object.keys(first);
  const secondRecord = second as Readonly<Record<string, unknown>>;
  if (firstKeys.length !== Object.keys(second).length) return false;
  return firstKeys.every(
    (key) =>
      Object.hasOwn(secondRecord, key) &&
      isSameValue((first as Readonly<Record<string, unknown>>)[key], secondRecord[key]),
  );
}

/**
 * Compares written fields with what the board holds at the same place, reading the stored value
 * once, on the first comparison.
 */
export class StoredValueMatch {
  readonly #read: StoredValueReader | undefined;
  #stored: StoredValue | undefined;
  #isRead = false;

  /**
   * Prepares the comparison for one written value.
   *
   * @param read - Reads the stored value; none means nothing is stored.
   */
  constructor(read: StoredValueReader | undefined) {
    this.#read = read;
  }

  /**
   * Tells whether a written field is what the board already holds at the same path.
   *
   * @param path - The field's path within the value (`[]` for the whole value).
   * @param written - The written field.
   * @returns True when the stored value holds the same at that path.
   */
  isUnchanged(path: readonly string[], written: unknown): boolean {
    if (!this.#isRead) {
      this.#stored = this.#read?.();
      this.#isRead = true;
    }
    if (this.#stored === undefined) return false;
    let stored: unknown = this.#stored.value;
    for (const segment of path) {
      if (typeof stored !== 'object' || stored === null || !Object.hasOwn(stored, segment)) {
        return false;
      }
      stored = (stored as Readonly<Record<string, unknown>>)[segment];
    }
    return isSameValue(written, stored);
  }
}
