import type { Board } from '../board/board.js';
import { buildChildIndex, type ChildIndex } from '../board/child-index.js';
import { finiteCoordinate } from '../fields/board-bound.js';
import type { BoundsCache } from '../geometry/local-bounds.js';
import { connectorEndPoint } from '../geometry/reference-points.js';
import type { ObjectId } from '../ids/object-id.js';
import type { ConnectorEnd, ConnectorObject } from '../objects/connector-object.js';

import { replaceObjects } from './replace-objects.js';

/**
 * Whether a connector end is attached to one of the given objects.
 *
 * @param end - The connector end.
 * @param ids - The objects to test against.
 * @returns `true` when the end is attached to an object in `ids`.
 */
export function isEndAttachedTo(end: ConnectorEnd, ids: ReadonlySet<ObjectId>): boolean {
  return end.kind === 'object' && ids.has(end.objectId);
}

/**
 * Computes the detached versions of the connectors attached to deleted objects, measured on the
 * board before anything is removed; see {@link detachConnectorsFrom}.
 *
 * @param board - The board before the deletion.
 * @param deleted - The objects being deleted.
 * @param children - The board's child index.
 * @returns A new connector for every surviving connector with an end on a deleted object.
 * @throws {RangeError} When a parent cycle makes an end's position undefined.
 */
export function detachedConnectors(
  board: Board,
  deleted: ReadonlySet<ObjectId>,
  children: ChildIndex,
): ConnectorObject[] {
  const detached: ConnectorObject[] = [];
  // Many connectors can share one target; measure each target's bounds once.
  const boundsCache: BoundsCache = new Map();
  for (const object of board.objects.values()) {
    if (object.type !== 'connector' || deleted.has(object.id)) continue;
    const detachEnd = (end: ConnectorEnd): ConnectorEnd => {
      if (!isEndAttachedTo(end, deleted)) return end;
      const at = connectorEndPoint(board, object, end, children, boundsCache);
      return { kind: 'point', x: finiteCoordinate(at.x), y: finiteCoordinate(at.y) };
    };
    const from = detachEnd(object.from);
    const to = detachEnd(object.to);
    if (from !== object.from || to !== object.to) detached.push({ ...object, from, to });
  }
  return detached;
}

/**
 * Detaches every connector end attached to a deleted object: the end becomes a free point where
 * its anchor was, so the connector keeps its drawn shape (the default
 * "detach" policy). Connectors that are themselves among `deletedIds` are left alone, and the
 * deleted objects are not removed; `cascadeDelete` does both steps together. `updatedAt` is not
 * touched: the command layer stamps it.
 *
 * @param board - The board before the deletion; it is not modified.
 * @param deletedIds - The objects being deleted.
 * @returns The input board when no connector is affected, else a new board sharing every
 *   unchanged object.
 * @throws {RangeError} When a parent cycle makes an end's position undefined.
 */
export function detachConnectorsFrom(board: Board, deletedIds: Iterable<ObjectId>): Board {
  const detached = detachedConnectors(board, new Set(deletedIds), buildChildIndex(board));
  return replaceObjects(board, [], detached);
}
