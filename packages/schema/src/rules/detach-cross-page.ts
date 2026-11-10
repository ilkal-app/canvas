import type { Board } from '../board/board.js';
import { buildChildIndex, type ChildIndex } from '../board/child-index.js';
import { finiteCoordinate } from '../fields/board-bound.js';
import type { BoundsCache } from '../geometry/local-bounds.js';
import { commentPinPoint, connectorEndPoint } from '../geometry/reference-points.js';
import type { ObjectId } from '../ids/object-id.js';
import type { PageId } from '../ids/page-id.js';
import type { BoardObject } from '../objects/board-object.js';
import type { ConnectorEnd } from '../objects/connector-object.js';

/**
 * The page of each object, as the caller judges it (`storedPageIdOf`, or `shownPageIdOf` when a
 * page that is not live counts as the first); `undefined` when unknown, which never detaches.
 */
export type PageOf = (object: BoardObject) => PageId | undefined;

/**
 * Detaches one connector end when its target is on another page than the connector.
 *
 * @param context - The board, its child index, the bounds cache and the page lookup.
 * @param context.board - The board.
 * @param context.children - Its child index.
 * @param context.cache - Bounds measured so far.
 * @param context.pageOf - The page lookup.
 * @param connector - The connector, on page `page`.
 * @param end - One of its ends.
 * @param page - The connector's page.
 * @returns The end, or a free point where it was.
 */
function detachedEnd(
  context: {
    readonly board: Board;
    readonly children: ChildIndex;
    readonly cache: BoundsCache;
    readonly pageOf: PageOf;
  },
  connector: BoardObject & { readonly type: 'connector' },
  end: ConnectorEnd,
  page: PageId,
): ConnectorEnd {
  if (end.kind !== 'object') return end;
  const target = context.board.objects.get(end.objectId);
  const targetPage = target === undefined ? undefined : context.pageOf(target);
  if (targetPage === undefined || targetPage === page) return end;
  const at = connectorEndPoint(context.board, connector, end, context.children, context.cache);
  return { kind: 'point', x: finiteCoordinate(at.x), y: finiteCoordinate(at.y) };
}

/**
 * Detaches every connector end and comment pin among `candidates` that refers to an object on
 * another page (the page repair's R3 and R4): the end becomes a free point where
 * it was, the pin a point pin where it was, measured on `board` (a page move keeps every object
 * where it is on the board, so this is where they were drawn). Never deletes. Pure; the cost
 * follows the candidates.
 *
 * @param board - The board, with every object where it is now; not modified.
 * @param candidates - The connectors and comments to check; other objects are skipped.
 * @param pageOf - Each object's page.
 * @returns The changed connectors and comments, in candidate order.
 * @throws {RangeError} When a parent cycle makes an end's position undefined.
 */
export function detachAcrossPages(
  board: Board,
  candidates: Iterable<ObjectId>,
  pageOf: PageOf,
): BoardObject[] {
  const context = { board, children: buildChildIndex(board), cache: new Map(), pageOf };
  const changed: BoardObject[] = [];
  for (const id of new Set(candidates)) {
    const object = board.objects.get(id);
    const page = object === undefined ? undefined : pageOf(object);
    if (object === undefined || page === undefined) continue;
    if (object.type === 'connector') {
      const from = detachedEnd(context, object, object.from, page);
      const to = detachedEnd(context, object, object.to, page);
      if (from !== object.from || to !== object.to) changed.push({ ...object, from, to });
    } else if (object.type === 'comment' && object.anchor.kind === 'object') {
      const target = board.objects.get(object.anchor.objectId);
      const targetPage = target === undefined ? undefined : pageOf(target);
      if (targetPage === undefined || targetPage === page) continue;
      const pin = commentPinPoint(board, object);
      changed.push({
        ...object,
        x: finiteCoordinate(pin.x),
        y: finiteCoordinate(pin.y),
        anchor: { kind: 'point' },
      });
    }
  }
  return changed;
}
