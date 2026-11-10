import type { BoardObject } from '@canvas/schema';

/** The words a new frame's default name starts with, before its number. */
export const FRAME_NAME_PREFIX = 'Frame';

/**
 * The name the frame tool gives a new frame: "Frame 1", "Frame 2", … per board, one
 * past the highest number a frame on the board is named with by the same prefix, so a frame
 * renamed or deleted does not bring its number back while a later one stands. A floating
 * whiteboard names its frames sections: "Section 1", … counted on their own. Pure;
 * O(objects).
 *
 * @param objects - The board's objects.
 * @param prefix - The words the name starts with; {@link FRAME_NAME_PREFIX} if absent.
 * @returns The name.
 */
export function nextFrameName(
  objects: Iterable<BoardObject>,
  prefix: string = FRAME_NAME_PREFIX,
): string {
  const start = `${prefix} `;
  let highest = 0;
  for (const object of objects) {
    if (object.type !== 'frame' || !object.name.startsWith(start)) continue;
    const digits = object.name.slice(start.length);
    if (/^\d{1,9}$/.test(digits)) highest = Math.max(highest, Number(digits));
  }
  return `${start}${String(highest + 1)}`;
}
