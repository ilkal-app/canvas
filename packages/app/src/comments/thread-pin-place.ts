import {
  applyTransform,
  objectToBoardTransform,
  shownPageIdOf,
  type Board,
  type BoardObject,
  type ObjectId,
  type PageId,
  type Point,
} from '@canvas/schema';

import type { Thread } from './comment-api.js';

/** Where a thread's pin shows: its page, its board point and the object it follows, if any. */
export interface ThreadPinPlace {
  /** The page it shows on. */
  readonly pageId: PageId;
  /** Its board point. */
  readonly point: Point;
  /** The object it follows there, when it follows one (so it hides while that object moves). */
  readonly target?: BoardObject;
}

/**
 * Where a thread's pin shows. A pin kept in the service shows on its page: on its
 * object while that object is live on that page, else at its own point (a point pin, or an
 * object pin whose object is gone, unknown or on another page; it follows the object again once
 * the object is back). A thread whose pin is still a document object (not yet adopted) shows as
 * that object does: on its anchor object when it has one, else at its own point, on the page the
 * object shows on. Pure.
 *
 * @param board - The whole board.
 * @param thread - The thread's pin id and service pin.
 * @returns Its place, or undefined for a thread with neither a service pin nor a document pin.
 */
export function threadPinPlaceOf(
  board: Board,
  thread: Pick<Thread, 'pinId' | 'pin'>,
): ThreadPinPlace | undefined {
  const { pin } = thread;
  if (pin) {
    const pageId = pin.pageId as PageId;
    const { anchor } = pin;
    const target =
      anchor.kind === 'object' ? board.objects.get(anchor.objectId as ObjectId) : undefined;
    return target !== undefined &&
      anchor.kind === 'object' &&
      shownPageIdOf(board, target) === pageId
      ? {
          pageId,
          point: applyTransform(objectToBoardTransform(board, target), anchor.offset),
          target,
        }
      : { pageId, point: pin.point };
  }
  const object = board.objects.get(thread.pinId as ObjectId);
  if (object?.type !== 'comment') return undefined;
  const pageId = shownPageIdOf(board, object);
  const target =
    object.anchor.kind === 'object' ? board.objects.get(object.anchor.objectId) : undefined;
  return target !== undefined && object.anchor.kind === 'object'
    ? {
        pageId,
        point: applyTransform(objectToBoardTransform(board, target), object.anchor.offset),
        target,
      }
    : { pageId, point: { x: object.x, y: object.y } };
}
