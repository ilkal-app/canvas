import type { Board } from '../board/board.js';
import { finiteCoordinate } from '../fields/board-bound.js';
import { commentPinPoint } from '../geometry/reference-points.js';
import type { ObjectId } from '../ids/object-id.js';
import type { CommentObject } from '../objects/comment-object.js';

import { replaceObjects } from './replace-objects.js';

/**
 * Computes the re-anchored versions of the comments pinned to deleted objects, measured on the
 * board before anything is removed; see {@link detachCommentsFrom}.
 *
 * @param board - The board before the deletion.
 * @param deleted - The objects being deleted.
 * @returns A new comment for every surviving comment anchored to a deleted object.
 * @throws {RangeError} When a parent cycle makes a pin's position undefined.
 */
export function detachedComments(board: Board, deleted: ReadonlySet<ObjectId>): CommentObject[] {
  const detached: CommentObject[] = [];
  for (const object of board.objects.values()) {
    if (object.type !== 'comment' || deleted.has(object.id)) continue;
    if (object.anchor.kind !== 'object' || !deleted.has(object.anchor.objectId)) continue;
    const pin = commentPinPoint(board, object);
    detached.push({
      ...object,
      x: finiteCoordinate(pin.x),
      y: finiteCoordinate(pin.y),
      anchor: { kind: 'point' },
    });
  }
  return detached;
}

/**
 * Re-anchors every comment pinned to a deleted object to a point where the pin was, in the
 * comment's parent frame, so the thread survives its object as a connector end does. The
 * deleted objects are not removed and
 * `updatedAt` is not touched; see `cascadeDelete`.
 *
 * @param board - The board before the deletion; it is not modified.
 * @param deletedIds - The objects being deleted.
 * @returns The input board when no comment is affected, else a new board sharing every
 *   unchanged object.
 * @throws {RangeError} When a parent cycle makes a pin's position undefined.
 */
export function detachCommentsFrom(board: Board, deletedIds: Iterable<ObjectId>): Board {
  return replaceObjects(board, [], detachedComments(board, new Set(deletedIds)));
}
