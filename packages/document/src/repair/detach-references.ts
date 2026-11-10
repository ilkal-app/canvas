import {
  detachCommentsFrom,
  detachConnectorsFrom,
  type Board,
  type BoardObject,
  type ConnectorEnd,
  type ConnectorObject,
  type ObjectId,
  type Point,
} from '@canvas/schema';

import type { BoardReader } from '../commands/command.js';
import { SubBoard } from '../commands/sub-board.js';
import { unlessParentCycle } from '../commands/world-frame.js';

/** The two ends of a connector, each with the name of the other. */
const END_PAIRS = [
  ['from', 'to'],
  ['to', 'from'],
] as const;

/** The name of one end of a connector. */
type EndName = (typeof END_PAIRS)[number][0];

/**
 * Detaches without geometry, for a board whose parents form a cycle: ends at the connector's
 * origin (moved to the other end by {@link placeUnknownEnds} where it can), pins where the
 * comment's own position is.
 *
 * @param object - A connector or comment with a reference to a missing object.
 * @param missing - The missing objects.
 * @returns The detached object.
 */
function detachWithoutGeometry(object: BoardObject, missing: ReadonlySet<ObjectId>): BoardObject {
  const detach = (end: ConnectorEnd): ConnectorEnd =>
    end.kind === 'object' && missing.has(end.objectId) ? { kind: 'point', x: 0, y: 0 } : end;
  if (object.type === 'connector')
    return { ...object, from: detach(object.from), to: detach(object.to) };
  const isPinnedToMissing =
    object.type === 'comment' &&
    object.anchor.kind === 'object' &&
    missing.has(object.anchor.objectId);
  return isPinnedToMissing ? { ...object, anchor: { kind: 'point' } } : object;
}

/**
 * Where one end of a connector is in the connector's frame: a free point's own position, or an
 * attached end's anchor on its target, measured by detaching that end with the schema's rule.
 *
 * @param board - A board holding the end's target and its ancestors, or `null` when it has no
 *   geometry (a parent cycle).
 * @param connector - The connector.
 * @param name - Which end.
 * @returns The position, world units in the connector's frame, or `null` when unknown.
 */
function endPosition(board: Board | null, connector: ConnectorObject, name: EndName): Point | null {
  const end = connector[name];
  if (end.kind === 'point') return { x: end.x, y: end.y };
  if (board === null) return null;
  const withConnector: Board = { objects: new Map([...board.objects, [connector.id, connector]]) };
  const measured = unlessParentCycle(
    () => detachConnectorsFrom(withConnector, [end.objectId]).objects.get(connector.id) ?? null,
  );
  const detached = measured?.type === 'connector' ? measured[name] : undefined;
  return detached?.kind === 'point' ? { x: detached.x, y: detached.y } : null;
}

/**
 * Moves the ends that were attached to a target nothing is known of (neither on the board nor
 * remembered, so the schema's rule put them at the connector's origin) onto the connector's
 * other end, when that end's position is known, so the connector collapses onto the end that
 * survives rather than stretching to (0, 0). Deterministic: it reads only the board and the
 * connector.
 *
 * @param original - The connector as it was, with its attached ends.
 * @param detached - The connector after detaching.
 * @param unknown - The missing targets nothing is known of.
 * @param board - The board the detaching measured on, or `null` without geometry.
 * @returns The connector with those ends moved, or `detached` when there are none.
 */
function placeUnknownEnds(
  original: ConnectorObject,
  detached: ConnectorObject,
  unknown: ReadonlySet<ObjectId>,
  board: Board | null,
): ConnectorObject {
  let placed = detached;
  for (const [name, otherName] of END_PAIRS) {
    const end = original[name];
    if (end.kind !== 'object' || !unknown.has(end.objectId)) continue;
    const other = endPosition(board, detached, otherName);
    if (other !== null) placed = { ...placed, [name]: { kind: 'point', ...other } };
  }
  return placed;
}

/**
 * Whether an object is a connector with an end attached to one of the given objects.
 *
 * @param object - The object.
 * @param ids - The objects.
 * @returns `true` for such a connector.
 */
function isAttachedToAny(object: BoardObject, ids: ReadonlySet<ObjectId>): boolean {
  return (
    object.type === 'connector' &&
    [object.from, object.to].some((end) => end.kind === 'object' && ids.has(end.objectId))
  );
}

/**
 * Detaches connector ends and comment pins from missing objects with the schema's rules
 * (`detachConnectorsFrom`, `detachCommentsFrom`: an end becomes a free point where its anchor
 * was, a pin a point pin where it was), measured on a board that still
 * holds the missing objects as they were last seen, gathered through the reverse indexes rather
 * than by scanning the board. An end on a target nothing is known of goes to the connector's
 * other end when that end's position is known, else to the connector's origin.
 *
 * @param before - A board that still holds the missing objects (a `LastKnownBoard`).
 * @param dangling - The connectors and comments to detach, as they are now.
 * @param missing - The objects they refer to that are gone.
 * @returns The detached versions, in the order of `dangling`; objects with nothing to detach
 *   come back unchanged.
 */
export function detachFromMissing(
  before: BoardReader,
  dangling: readonly BoardObject[],
  missing: ReadonlySet<ObjectId>,
): BoardObject[] {
  const unknown = new Set([...missing].filter((id) => before.get(id) === undefined));
  const subBoard = new SubBoard(before, dangling);
  for (const object of dangling) {
    subBoard.addWithAncestors(object.id);
    // Both ends' targets: an automatic anchor measures its side from the other end, and an end
    // on an unknown target goes to the other end.
    subBoard.addConnectorTargets(object);
  }
  for (const id of missing) {
    subBoard.addSubtree(id);
    subBoard.addWithAncestors(id);
  }
  const board = unlessParentCycle(() =>
    detachCommentsFrom(detachConnectorsFrom(subBoard.toBoard(), missing), missing),
  );
  return dangling.map((object) => {
    const detached = board?.objects.get(object.id) ?? detachWithoutGeometry(object, missing);
    return object.type === 'connector' &&
      detached.type === 'connector' &&
      isAttachedToAny(object, unknown)
      ? placeUnknownEnds(object, detached, unknown, board)
      : detached;
  });
}
