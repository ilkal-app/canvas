import {
  buildChildIndex,
  composeTransforms,
  invertTransform,
  localBounds,
  placeConnectorEnds,
  type BoardObject,
  type ConnectorEnd,
  type ConnectorEndInput,
  type ConnectorObject,
  type ObjectId,
  type PlacedConnectorEnds,
  type RigidTransform,
} from '@canvas/schema';

import type { SceneSource } from '../scene/scene-source.js';
import { worldTransformOf } from '../scene/world-transform.js';

import { connectorShapeFrom, type ConnectorShape } from './connector-shape.js';

/** What placing a connector reads: the document, and each object's children (for a group). */
export interface ConnectorTargetSource extends SceneSource {
  /**
   * The children of an object, as the document holds them now.
   *
   * @param id - The object.
   * @returns Its children's ids; empty for none.
   */
  childrenOf(id: ObjectId): Iterable<ObjectId>;
}

/**
 * A target and, for a group, everything below it, as a board for the schema's `localBounds`
 * (a group's bounds derive from its children). A parent cycle stops the
 * walk.
 *
 * @param target - The target.
 * @param source - The document.
 * @returns The objects.
 */
function targetBoard(
  target: BoardObject,
  source: ConnectorTargetSource,
): Map<ObjectId, BoardObject> {
  const objects = new Map<ObjectId, BoardObject>([[target.id, target]]);
  if (target.type !== 'group') return objects;
  const pending = [...source.childrenOf(target.id)];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (objects.has(id)) continue;
    const child = source.get(id);
    if (child === undefined) continue;
    objects.set(id, child);
    if (child.type === 'group') pending.push(...source.childrenOf(id));
  }
  return objects;
}

/**
 * One end, ready for `placeConnectorEnds`: a free point, or the target's bounds and the map
 * from its frame into the connector's.
 *
 * @param end - The stored end.
 * @param toConnector - The map from the world into the connector's frame.
 * @param source - The document.
 * @returns The input.
 */
function endInput(
  end: ConnectorEnd,
  toConnector: RigidTransform,
  source: ConnectorTargetSource,
): ConnectorEndInput {
  if (end.kind === 'point') return { kind: 'point', point: { x: end.x, y: end.y } };
  const target = source.get(end.objectId);
  if (target === undefined) return { kind: 'object', anchor: end.anchor, box: undefined };
  const objects = targetBoard(target, source);
  const board = { objects };
  const bounds = localBounds(board, target, buildChildIndex(board));
  const box = {
    bounds,
    toConnector: composeTransforms(toConnector, worldTransformOf(target, source)),
  };
  return { kind: 'object', anchor: end.anchor, box };
}

/**
 * The shape a connector draws on the document as it is now: its ends
 * placed on their targets' world boxes (`placeConnectorEnds`, the rule detaching writes too),
 * then routed (`connectorPathOf`) and its label put halfway along. A target the source does not
 * hold (deleted, or held undrawable by the drawable gate) places its end at the connector's
 * origin until the reference repair detaches it. Pure.
 *
 * @param connector - The connector.
 * @param source - The document, with each object's children.
 * @returns The shape, in the connector's frame.
 */
export function resolveConnectorShape(
  connector: ConnectorObject,
  source: ConnectorTargetSource,
): ConnectorShape {
  const ends = resolveConnectorEnds(connector, source);
  return connectorShapeFrom(connector, ends.from, ends.to);
}

/**
 * A connector's ends placed on the document as it is now, as {@link resolveConnectorShape} routes
 * from them: each end's point and the normal it leaves along, in the connector's frame, which its
 * route handles are measured from. Pure.
 *
 * @param connector - The connector.
 * @param source - The document, with each object's children.
 * @returns The placed ends.
 */
export function resolveConnectorEnds(
  connector: ConnectorObject,
  source: ConnectorTargetSource,
): PlacedConnectorEnds {
  const toConnector = invertTransform(worldTransformOf(connector, source));
  return placeConnectorEnds(
    endInput(connector.from, toConnector, source),
    endInput(connector.to, toConnector, source),
  );
}
