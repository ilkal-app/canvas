import type { WorldBounds } from '@canvas/engine';
import type { Board, PageId, Point } from '@canvas/schema';

import type { Thread } from '../comments/comment-api.js';
import { threadPinPlaceOf } from '../comments/thread-pin-place.js';

/** Where a comment's pin is: its page and its point on the board. */
export interface PinPlace {
  /** The page it shows on. */
  readonly pageId: PageId;
  /** Its point, world units: on its object when anchored to one, else its own. */
  readonly point: Point;
}

/** The world box a search result's pin is framed in: about 2× on a desktop canvas. */
const PIN_FRAME = { width: 640, height: 400 } as const;

/**
 * Where a comment's pin is, as the comment layer draws it (`threadPinPlaceOf`): the service's
 * pin, else the document's until it is adopted. Pure.
 *
 * @param board - The whole board.
 * @param thread - The thread's pin id and service pin.
 * @returns Its place, or undefined when the thread has no pin to show.
 */
export function pinPlaceOf(
  board: Board,
  thread: Pick<Thread, 'pinId' | 'pin'>,
): PinPlace | undefined {
  const place = threadPinPlaceOf(board, thread);
  return place === undefined ? undefined : { pageId: place.pageId, point: place.point };
}

/**
 * The box a search result's pin is framed in: {@link PIN_FRAME} centred on it, so going to a
 * comment zooms to about where its card reads (a point alone would zoom in all the way).
 *
 * @param point - The pin's point, world units.
 * @returns The box.
 */
export function pinFrameOf(point: Point): WorldBounds {
  return {
    minX: point.x - PIN_FRAME.width / 2,
    minY: point.y - PIN_FRAME.height / 2,
    maxX: point.x + PIN_FRAME.width / 2,
    maxY: point.y + PIN_FRAME.height / 2,
  };
}
