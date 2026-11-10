import type { Board } from '../board/board.js';
import type { ChildIndex } from '../board/child-index.js';
import type { Point } from '../fields/point.js';
import type { CommentObject } from '../objects/comment-object.js';
import type { ConnectorEnd, ConnectorObject } from '../objects/connector-object.js';

import { objectToBoardTransform, parentToBoardTransform } from './board-transform.js';
import { placeConnectorEnds, type ConnectorEndInput } from './connector-ends.js';
import { localBounds, type BoundsCache } from './local-bounds.js';
import {
  applyTransform,
  composeTransforms,
  invertTransform,
  type RigidTransform,
} from './rigid-transform.js';

/**
 * One end of a connector, ready for `placeConnectorEnds`: its target's bounds and the map from
 * the target's frame to the connector's.
 *
 * @param board - The board holding the connector and its target.
 * @param toConnector - The map from the board to the connector's frame.
 * @param end - The end.
 * @param children - The board's child index, for a group target's derived bounds.
 * @param boundsCache - Target bounds already measured on this same board; filled as it goes.
 * @returns The input.
 */
function endInput(
  board: Board,
  toConnector: RigidTransform,
  end: ConnectorEnd,
  children: ChildIndex,
  boundsCache: BoundsCache,
): ConnectorEndInput {
  if (end.kind === 'point') return { kind: 'point', point: { x: end.x, y: end.y } };
  const target = board.objects.get(end.objectId);
  if (target === undefined) return { kind: 'object', anchor: end.anchor, box: undefined };
  const bounds = localBounds(board, target, children, boundsCache);
  const box = {
    bounds,
    toConnector: composeTransforms(toConnector, objectToBoardTransform(board, target)),
  };
  return { kind: 'object', anchor: end.anchor, box };
}

/**
 * Where a connector end is, in the connector's own frame (`placeConnectorEnds`): the free point
 * itself, a fixed anchor on the target's bounds, or for an automatic anchor the midpoint of the
 * target side nearest the other end, as the renderer draws it. An end whose target is not on the
 * board is placed at the connector's origin.
 *
 * @param board - The board holding the connector and its targets.
 * @param connector - The connector.
 * @param end - One of the connector's ends: `connector.from` or `connector.to` (an end that is
 *   neither is placed as the start).
 * @param children - The board's child index, for a group target's derived bounds.
 * @param boundsCache - Target bounds already measured on this same board; filled as it goes.
 * @returns The end's position, world units in the connector's frame.
 * @throws {RangeError} When a target's or the connector's ancestors form a cycle.
 */
export function connectorEndPoint(
  board: Board,
  connector: ConnectorObject,
  end: ConnectorEnd,
  children: ChildIndex,
  boundsCache: BoundsCache = new Map(),
): Point {
  if (end.kind === 'point') return { x: end.x, y: end.y };
  const other = end === connector.to && end !== connector.from ? connector.from : connector.to;
  const toConnector = invertTransform(objectToBoardTransform(board, connector));
  const placed = placeConnectorEnds(
    endInput(board, toConnector, end, children, boundsCache),
    endInput(board, toConnector, other, children, boundsCache),
  );
  return placed.from.point;
}

/**
 * Where a comment pin is, in the frame of the comment's parent: its own `x`, `y` for a point
 * anchor, or its offset on the anchor object. A pin whose anchor object is not on the board is
 * placed at its own `x`, `y`.
 *
 * @param board - The board holding the comment and its anchor object.
 * @param comment - The comment.
 * @returns The pin's position, world units in the comment's parent frame.
 * @throws {RangeError} When the anchor object's or the comment's ancestors form a cycle.
 */
export function commentPinPoint(board: Board, comment: CommentObject): Point {
  const ownPoint = { x: comment.x, y: comment.y };
  if (comment.anchor.kind === 'point') return ownPoint;
  const target = board.objects.get(comment.anchor.objectId);
  if (target === undefined) return ownPoint;
  const onBoard = applyTransform(objectToBoardTransform(board, target), comment.anchor.offset);
  return applyTransform(invertTransform(parentToBoardTransform(board, comment)), onBoard);
}
