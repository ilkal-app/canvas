import { createObjectCommand, runCommand, whenStoreIdle } from '@canvas/document';
import { hitPaletteOf, hitPoint, NO_COLOR_TOKENS } from '@canvas/engine';
import {
  applyTransform,
  firstPageIdOf,
  invertTransform,
  isLivePage,
  objectToBoardTransform,
  shownPageIdOf,
  type Board,
  type ColorMode,
  type CommentAnchor,
  type ObjectId,
  type PageId,
  type Point,
} from '@canvas/schema';

import type { BoardConnection } from '../collab/board-connection.js';

import type { ThreadPin } from './comment-api.js';

/** Placement held while a first message is composed. */
export interface CommentPlacement {
  /** Reserved pin identifier. */
  readonly id: ObjectId;
  /** Board position, including fallback when its target disappears. */
  readonly point: Point;
  /** Object-local attachment or a point. */
  readonly anchor: CommentAnchor;
  /**
   * The page shown when it was placed, which the pin goes on; absent where the view
   * has no pages, and the pin goes where the store puts a new root object.
   */
  readonly pageId?: PageId;
}

/**
 * Chooses the topmost painted object under a comment click, in object-local coordinates. Colour
 * tokens are picked as drawn: a token fill transparent in its object's mode is no fill.
 *
 * @param board - Current document projection.
 * @param point - Click in board coordinates.
 * @param zoom - Camera scale for stroke hit tolerance.
 * @param theme - The viewer's theme, which tokens resolve in where no ancestor sets a mode.
 * @param pageId - The page shown: only its objects are hit and the pin goes on it;
 *   every page's objects when absent.
 * @returns A pin placement, with no document mutation yet.
 */
export function commentPlacement(
  board: Board,
  point: Point,
  zoom = 1,
  theme: ColorMode = 'light',
  pageId?: PageId,
): CommentPlacement {
  const candidates = [...board.objects.values()]
    .filter((object) => pageId === undefined || shownPageIdOf(board, object) === pageId)
    .map(({ id }) => id);
  const page = pageId === undefined ? {} : { pageId };
  const source = { get: (id: ObjectId) => board.objects.get(id) };
  const tokens = board.tokens ?? NO_COLOR_TOKENS;
  const paletteOf = hitPaletteOf(source, { tokens: () => tokens, theme: () => theme });
  const hits = hitPoint({ searchRect: () => candidates }, source, point, { zoom, paletteOf });
  const object = hits
    .map((id) => board.objects.get(id))
    .find((entry) => entry !== undefined && entry.type !== 'comment');
  if (object) {
    const offset = applyTransform(invertTransform(objectToBoardTransform(board, object)), point);
    return {
      id: crypto.randomUUID() as ObjectId,
      point,
      anchor: { kind: 'object', objectId: object.id, offset },
      ...page,
    };
  }
  return { id: crypto.randomUUID() as ObjectId, point, anchor: { kind: 'point' }, ...page };
}

/**
 * A placement as the thread's pin in the service: on the page it was placed on, or the
 * board's first page where the view had none; at its point, on its object when it has one. Pure.
 *
 * @param board - The whole board.
 * @param placement - The placement.
 * @returns The pin the new thread is created with.
 */
export function pinOfPlacement(board: Board, placement: CommentPlacement): ThreadPin {
  const { anchor } = placement;
  return {
    pageId: placement.pageId ?? firstPageIdOf(board),
    anchor:
      anchor.kind === 'object'
        ? { kind: 'object', objectId: anchor.objectId, offset: anchor.offset }
        : { kind: 'point' },
    point: placement.point,
  };
}

/**
 * Publishes a pin only after its relational thread exists. Canvas undo touches no service data.
 *
 * @param connection - Live document and the person's origin.
 * @param placement - Reserved placement.
 * @param threadId - Committed thread id.
 * @returns Whether the command succeeded, or the pin is held: while a stepped run holds the store,
 *   it is written once it is idle, anchored as the board then is.
 */
export function placeThreadPin(
  connection: Pick<BoardConnection, 'store' | 'origin'>,
  placement: CommentPlacement,
  threadId: string,
): boolean {
  let isPlaced = true;
  whenStoreIdle(connection.store, () => {
    isPlaced = placeNow(connection, placement, threadId);
  });
  return isPlaced;
}

/**
 * Writes the pin now (`placeThreadPin`).
 *
 * @param connection - Live document and the person's origin.
 * @param placement - Reserved placement.
 * @param threadId - Committed thread id.
 * @returns Whether the command succeeded.
 */
function placeNow(
  connection: Pick<BoardConnection, 'store' | 'origin'>,
  placement: CommentPlacement,
  threadId: string,
): boolean {
  const board = connection.store.read();
  // A page deleted while the message was composed: the pin goes where the store puts it.
  const pageId =
    placement.pageId !== undefined && isLivePage(board, placement.pageId)
      ? placement.pageId
      : undefined;
  const target =
    placement.anchor.kind === 'object' ? board.objects.get(placement.anchor.objectId) : undefined;
  // The object gone, or moved to another page, while the message was composed.
  const anchor =
    placement.anchor.kind === 'object' &&
    (target === undefined || (pageId !== undefined && shownPageIdOf(board, target) !== pageId))
      ? { kind: 'point' as const }
      : placement.anchor;
  const result = runCommand(
    connection.store,
    connection.origin,
    createObjectCommand,
    {
      object: {
        type: 'comment',
        id: placement.id,
        x: placement.point.x,
        y: placement.point.y,
        anchor,
        threadId,
        ...(pageId === undefined ? {} : { pageId }),
      },
    },
    { clock: Date.now, createId: () => crypto.randomUUID() as ObjectId },
  );
  return result.status === 'applied';
}
