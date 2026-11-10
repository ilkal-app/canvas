import {
  connectorShapeFrom,
  placeConnectorEnds,
  type ConnectorEnd,
  type ConnectorEndInput,
  type ConnectorObject,
  type ConnectorPath,
  type ConnectorShape,
  type Point,
} from '@canvas/schema';

export { connectorShapeFrom } from '@canvas/schema';
export type { ConnectorShape } from '@canvas/schema';

/**
 * Each placed connector value's shape. Board objects are immutable values and the router hands
 * the scene a fresh copy of a connector whenever its shape changes (`placedConnector`), so a
 * value's shape never changes, and every reader (the path pass, its level of detail, the culler's
 * index, hit testing, the text pass) sees the same one. Weak: a value no one holds takes its
 * shape with it.
 */
const shapes = new WeakMap<ConnectorObject, ConnectorShape>();

/**
 * An end as it is placed without its target's geometry: a free point as stored, an attached end
 * as on a missing target (at the connector's origin).
 *
 * @param end - The stored end.
 * @returns The input to `placeConnectorEnds`.
 */
function unresolvedInput(end: ConnectorEnd): ConnectorEndInput {
  return end.kind === 'point'
    ? { kind: 'point', point: { x: end.x, y: end.y } }
    : { kind: 'object', anchor: end.anchor, box: undefined };
}

/**
 * The shape a connector value draws: the one the router placed it with (`placedConnector`), or,
 * for a value that did not come through the router (a test, a hand-built change set), the shape
 * of its free ends with attached ends at its origin.
 *
 * @param connector - The connector value.
 * @returns Its shape.
 */
export function connectorShapeOf(connector: ConnectorObject): ConnectorShape {
  const placed = shapes.get(connector);
  if (placed) return placed;
  const ends = placeConnectorEnds(unresolvedInput(connector.from), unresolvedInput(connector.to));
  const shape = connectorShapeFrom(connector, ends.from, ends.to);
  shapes.set(connector, shape);
  return shape;
}

/**
 * A copy of a connector that draws a given shape: what the router hands the scene in place of
 * the document's value, so its shape travels with the value.
 *
 * @param connector - The document's connector; not mutated.
 * @param shape - The shape it draws now.
 * @returns A new value equal to `connector` field for field.
 */
export function placedConnector(
  connector: ConnectorObject,
  shape: ConnectorShape,
): ConnectorObject {
  const copy = { ...connector };
  shapes.set(copy, shape);
  return copy;
}

/**
 * Whether two points are equal.
 *
 * @param a - One point.
 * @param b - The other.
 * @returns True when both coordinates are.
 */
function isSamePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Whether two connector paths are the same line: the same points and the same curve.
 *
 * @param a - One path.
 * @param b - The other.
 * @returns True when they draw the same centre line.
 */
export function isSameConnectorPath(a: ConnectorPath, b: ConnectorPath): boolean {
  const first = coordinatesOf(a);
  const second = coordinatesOf(b);
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index]) &&
    (a.curve === undefined) === (b.curve === undefined)
  );
}

/**
 * A path's numbers in order: its route's coordinates, then its curve's.
 *
 * @param path - The path.
 * @returns The coordinates.
 */
function coordinatesOf(path: ConnectorPath): number[] {
  return [...path.route, ...(path.curve ?? [])].flatMap(({ x, y }) => [x, y]);
}

/**
 * Whether two shapes draw the same: the same path and label point.
 *
 * @param a - One shape.
 * @param b - The other.
 * @returns True when they are equal.
 */
export function isSameConnectorShape(a: ConnectorShape, b: ConnectorShape): boolean {
  return isSamePoint(a.label, b.label) && isSameConnectorPath(a.path, b.path);
}
