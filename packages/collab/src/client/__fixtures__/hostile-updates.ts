// Update-v1 bytes a hostile peer or a corrupted cache can hold and no Yjs encoder produces (item 2),
// written byte by byte as in @canvas/document's own fixture: a count of plain values no bytes
// back, and plain values nested far past what lib0's recursive `readAny` can follow.

/**
 * One client, one `ContentAny` item under the top-level type `a`, declaring 2^49 - 1 plain
 * values with no byte behind the count (the review's 15 bytes, C1).
 */
export const COUNT_OVERFLOW_UPDATE = Uint8Array.from([
  1, 1, 1, 0, 8, 1, 1, 0x61, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f,
]);

/**
 * One plain value nested `levels` one-element arrays deep around `undefined`, under the
 * top-level type `a`, then an empty delete set.
 *
 * @param levels - How many arrays enclose the innermost value.
 * @returns The update's bytes (about two per level).
 */
export function deepNestingUpdate(levels: number): Uint8Array {
  const head = [1, 1, 1, 0, 8, 1, 1, 0x61, 1];
  const bytes = new Uint8Array(head.length + levels * 2 + 2);
  bytes.set(head);
  for (let level = 0; level < levels; level += 1) {
    bytes[head.length + level * 2] = 117;
    bytes[head.length + level * 2 + 1] = 1;
  }
  bytes[head.length + levels * 2] = 127;
  return bytes;
}
