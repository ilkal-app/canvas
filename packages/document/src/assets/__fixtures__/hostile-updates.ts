// Update-v1 bytes a hostile peer can send and no Yjs encoder produces (item 2): plain
// values that declare more entries than the bytes hold, and plain values nested far deeper
// than lib0's recursive `readAny` can follow. Written byte by byte: Yjs's own encoder recurses
// too, so it cannot build the deep ones.

/** lib0 `any` tags: an array (a count, then that many values) and `undefined` (no payload). */
const ARRAY_TAG = 117;
const UNDEFINED_TAG = 127;

/** The largest count a seven-byte varUint holds: 2^49 - 1. */
const HUGE_COUNT = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f] as const;

/**
 * The review's 15 bytes: one client, one `ContentAny` item under the top-level
 * type `a`, declaring 2^49 - 1 plain values with no byte behind the count.
 */
export const COUNT_OVERFLOW_UPDATE = Uint8Array.from([1, 1, 1, 0, 8, 1, 1, 0x61, ...HUGE_COUNT]);

/**
 * One `ContentAny` item under the top-level type `a` holding the given value bytes, then an
 * empty delete set.
 *
 * @param count - How many values the item declares.
 * @param values - The values' lib0 `any` bytes.
 * @returns The update's bytes.
 */
function plainItemUpdate(count: number, values: Uint8Array): Uint8Array {
  const head = [1, 1, 1, 0, 8, 1, 1, 0x61, count];
  const bytes = new Uint8Array(head.length + values.length + 1);
  bytes.set(head);
  bytes.set(values, head.length);
  return bytes;
}

/**
 * One plain value, an array declaring 2^49 - 1 elements with no byte behind the count.
 *
 * @returns The update's bytes.
 */
export function arrayCountOverflowUpdate(): Uint8Array {
  return plainItemUpdate(1, Uint8Array.from([ARRAY_TAG, ...HUGE_COUNT]));
}

/**
 * One plain value nested `levels` arrays deep (`[[[...undefined...]]]`), each array holding
 * one element, then a complete delete set: a well-formed update apart from its depth.
 *
 * @param levels - How many arrays enclose the innermost value.
 * @returns The update's bytes (about two per level).
 */
export function deepNestingUpdate(levels: number): Uint8Array {
  const values = new Uint8Array(levels * 2 + 1);
  for (let level = 0; level < levels; level += 1) {
    values[level * 2] = ARRAY_TAG;
    values[level * 2 + 1] = 1;
  }
  values[levels * 2] = UNDEFINED_TAG;
  return plainItemUpdate(1, values);
}
