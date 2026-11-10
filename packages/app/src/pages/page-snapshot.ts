import type { BoardSnapshot } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

/**
 * A board snapshot narrowed to one page's objects: the issues, pages and tokens of the whole
 * board, the objects only where `isShown` says so. Pure: the source is never changed.
 *
 * @param source - The whole board's snapshot.
 * @param isShown - Whether an object is on the page shown.
 * @returns The page's snapshot, frozen.
 */
export function pageSnapshot(
  source: BoardSnapshot,
  isShown: (id: ObjectId) => boolean,
): BoardSnapshot {
  const objects = new Map<ObjectId, BoardObject>();
  for (const [id, object] of source.objects) {
    if (isShown(id)) objects.set(id, object);
  }
  const { issues, pages, tokens } = source;
  return Object.freeze({ objects, issues, pages, ...(tokens === undefined ? {} : { tokens }) });
}
