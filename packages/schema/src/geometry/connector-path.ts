import type { Point } from '../fields/point.js';
import type { ConnectorCurvePoint, ConnectorObject } from '../objects/connector-object.js';

import type { Cubic } from './bezier.js';
import type { PlacedConnectorEnd } from './connector-ends.js';

/**
 * How far an elbow route runs straight out of an attached end before it may turn, world units:
 * enough to clear a cap's head (`capLength` of a 4-wide stroke is 20) so an arrowhead never sits
 * on a bend.
 */
export const ELBOW_STUB = 24;

/** How far a curved route's handles reach along each end's normal, as a fraction of its span. */
export const CURVE_HANDLE_FRACTION = 0.4;

/**
 * A connector's centre line in its own frame: a polyline, or for a curved route one cubic (its
 * `route` then holds just the two ends). Derived when drawn, never stored.
 */
export interface ConnectorPath {
  /** The polyline, first end first; for a curved route its two ends. */
  readonly route: readonly Point[];
  /** The curve of a curved route; `undefined` for straight and elbow routes. */
  readonly curve: Cubic | undefined;
}

/** The fields a person sets to reshape a route by its handles; absent is automatic. */
export type ConnectorRouteHandles = Partial<Pick<ConnectorObject, 'elbowMiddle' | 'curvePoint'>>;

/** A direction along one axis. */
interface AxisDirection {
  readonly x: number;
  readonly y: number;
}

/**
 * The axis direction an end leaves along: its normal snapped to the nearer axis, or for a free
 * end the axis along which the other end is further away, pointing at it (ties horizontal).
 *
 * @param end - The end.
 * @param other - The other end's point.
 * @returns A unit axis direction.
 */
function leavingDirection(end: PlacedConnectorEnd, other: Point): AxisDirection {
  const along = end.normal ?? { x: other.x - end.point.x, y: other.y - end.point.y };
  if (Math.abs(along.x) >= Math.abs(along.y)) return { x: along.x < 0 ? -1 : 1, y: 0 };
  return { x: 0, y: along.y < 0 ? -1 : 1 };
}

/**
 * Whether a point lies ahead of (or level with) another along a direction.
 *
 * @param from - Where the direction starts.
 * @param direction - The axis direction.
 * @param point - The point.
 * @returns True when `point` is not behind `from`.
 */
function isAhead(from: Point, direction: AxisDirection, point: Point): boolean {
  return (point.x - from.x) * direction.x + (point.y - from.y) * direction.y >= 0;
}

/**
 * An elbow route's movable piece, moving along one axis from the first stub point
 * (`middle` 0) to the second (1): with two bends the middle piece, halfway by default; with one
 * (an L) the arm into the second stub point, at 1 by default, which a move gives a second bend.
 */
export interface ElbowMiddlePiece {
  /** The axis the piece moves along: `'x'` for an upright piece, `'y'` for a level one. */
  readonly axis: 'x' | 'y';
  /** The coordinate on that axis at `middle` 0: the first stub point's. */
  readonly start: number;
  /** The coordinate on that axis at `middle` 1: the second stub point's. */
  readonly end: number;
  /** Its two corners' coordinates on the other axis: the first stub point's, then the second's. */
  readonly across: readonly [number, number];
  /** Where it runs when the connector stores no `elbowMiddle`: 0.5, or 1 for an L's arm. */
  readonly automatic: number;
}

/**
 * How two stub points are joined: through one corner (`corner`), or through a middle piece moving
 * along an axis (`piece`) whose corners sit at the piece's coordinate on each stub's other axis.
 */
type StubJoin =
  | { readonly kind: 'corner'; readonly corner: Point; readonly piece: ElbowMiddlePiece }
  | { readonly kind: 'piece'; readonly piece: ElbowMiddlePiece };

/**
 * A one-bend join through a corner, with the arm from the corner to the second stub point as its
 * movable piece, at 1 by default: an upright arm moves along x, a level one along y.
 *
 * @param a - The first stub point.
 * @param b - The second stub point.
 * @param corner - The bend.
 * @returns The join.
 */
function cornerJoin(a: Point, b: Point, corner: Point): StubJoin {
  const piece: ElbowMiddlePiece =
    corner.x === b.x
      ? { axis: 'x', start: a.x, end: b.x, across: [a.y, b.y], automatic: 1 }
      : { axis: 'y', start: a.y, end: b.y, across: [a.x, b.x], automatic: 1 };
  return { kind: 'corner', corner, piece };
}

/**
 * A two-bend join through a middle piece, halfway by default.
 *
 * @param axis - The axis the piece moves along.
 * @param a - The first stub point.
 * @param b - The second stub point.
 * @returns The join.
 */
function pieceJoin(axis: 'x' | 'y', a: Point, b: Point): StubJoin {
  const piece: ElbowMiddlePiece =
    axis === 'x'
      ? { axis, start: a.x, end: b.x, across: [a.y, b.y], automatic: 0.5 }
      : { axis, start: a.y, end: b.y, across: [a.x, b.x], automatic: 0.5 };
  return { kind: 'piece', piece };
}

/**
 * How two stub points are joined, leaving the first along `start` and arriving at the second
 * against `end` (that is, travelling along `−end`): one bend where the two axes cross, when that
 * corner lies ahead of both ends; else across the stub and across the other; and two bends through
 * a middle piece when the ends face the same axis, the piece square to them when its halfway place
 * lies ahead of both, else along them. The choice is made at halfway, so moving the piece never
 * changes it: any place between the stubs is ahead of both whenever halfway is.
 *
 * @param a - The first stub point.
 * @param start - The first end's leaving direction.
 * @param b - The second stub point.
 * @param end - The second end's leaving direction.
 * @returns The join.
 */
function stubJoin(a: Point, start: AxisDirection, b: Point, end: AxisDirection): StubJoin {
  const isStartHorizontal = start.y === 0;
  const isEndHorizontal = end.y === 0;
  if (isStartHorizontal !== isEndHorizontal) {
    // One bend where the two axes cross, when that corner lies ahead of both ends.
    const corner = isStartHorizontal ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    if (isAhead(a, start, corner) && isAhead(b, end, corner)) return cornerJoin(a, b, corner);
    // Otherwise leave across the stub and arrive across the other: still square to both.
    return cornerJoin(a, b, isStartHorizontal ? { x: a.x, y: b.y } : { x: b.x, y: a.y });
  }
  if (isStartHorizontal) {
    const middleX = (a.x + b.x) / 2;
    const isSquare =
      isAhead(a, start, { x: middleX, y: a.y }) && isAhead(b, end, { x: middleX, y: b.y });
    return pieceJoin(isSquare ? 'x' : 'y', a, b);
  }
  const middleY = (a.y + b.y) / 2;
  const isSquare =
    isAhead(a, start, { x: a.x, y: middleY }) && isAhead(b, end, { x: b.x, y: middleY });
  return pieceJoin(isSquare ? 'y' : 'x', a, b);
}

/**
 * The corners of a join between two stub points: a one-bend join's corner when nothing moved its
 * arm, else its movable piece's two corners at `middle` of the way along it (its automatic place
 * when none is given).
 *
 * @param a - The first stub point.
 * @param b - The second stub point.
 * @param join - The join (`stubJoin`).
 * @param middle - Where the piece runs, 0 to 1, or undefined for its automatic place.
 * @returns The corners between `a` and `b`, neither included.
 */
function joinCorners(a: Point, b: Point, join: StubJoin, middle: number | undefined): Point[] {
  if (join.kind === 'corner' && middle === undefined) return [join.corner];
  const { axis, start, end, automatic } = join.piece;
  const at = start + (end - start) * Math.min(1, Math.max(0, middle ?? automatic));
  return axis === 'x'
    ? [
        { x: at, y: a.y },
        { x: at, y: b.y },
      ]
    : [
        { x: a.x, y: at },
        { x: b.x, y: at },
      ];
}

/**
 * Removes repeated points and the middle point of three on one axis-aligned line, so a route
 * has only its real corners.
 *
 * @param points - The route.
 * @returns A new route.
 */
function simplified(points: readonly Point[]): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (last?.x === point.x && last.y === point.y) continue;
    const beforeLast = kept.at(-2);
    if (
      last &&
      beforeLast &&
      ((beforeLast.x === last.x && last.x === point.x) ||
        (beforeLast.y === last.y && last.y === point.y))
    ) {
      kept[kept.length - 1] = point;
      continue;
    }
    kept.push(point);
  }
  return kept;
}

/**
 * The stub points of an elbow route and how they are joined.
 *
 * @param from - The placed start.
 * @param to - The placed end.
 * @returns The two stub points and the join.
 */
function elbowStubs(
  from: PlacedConnectorEnd,
  to: PlacedConnectorEnd,
): { readonly a: Point; readonly b: Point; readonly join: StubJoin } {
  const start = leavingDirection(from, to.point);
  const end = leavingDirection(to, from.point);
  const startStub = from.normal === null ? 0 : ELBOW_STUB;
  const endStub = to.normal === null ? 0 : ELBOW_STUB;
  const a = { x: from.point.x + start.x * startStub, y: from.point.y + start.y * startStub };
  const b = { x: to.point.x + end.x * endStub, y: to.point.y + end.y * endStub };
  return { a, b, join: stubJoin(a, start, b, end) };
}

/**
 * An elbow connector's route: axis-aligned pieces that leave each end
 * square to its side (an attached end runs {@link ELBOW_STUB} straight out first; a free end
 * leaves along the axis the other end is further away on), joined with one bend where the two
 * axes cross, or two bends through a middle piece when the ends face the same axis, the piece
 * `middle` of the way between the two stubs (halfway by default). With one bend, a given
 * `middle` moves the arm that reaches the end's stub there instead of at it, adding a bend.
 * Without obstacle avoidance (out of scope). Pure.
 *
 * @param from - The placed start.
 * @param to - The placed end.
 * @param middle - Where the movable piece runs (`elbowMiddlePiece`), 0 (at the start's stub) to 1
 *   (the end's), clamped; its automatic place if absent.
 * @returns The route's corners, `from` first and `to` last, without repeats or straight-through
 *   points; a single point when both ends coincide.
 */
export function elbowConnectorRoute(
  from: PlacedConnectorEnd,
  to: PlacedConnectorEnd,
  middle?: number,
): Point[] {
  const { a, b, join } = elbowStubs(from, to);
  return simplified([from.point, a, ...joinCorners(a, b, join, middle), b, to.point]);
}

/**
 * An elbow route's movable piece: its middle piece, or with one bend the arm that reaches
 * the end's stub; the axis it moves along, its coordinates at either stub and its corners' on the
 * other, and its automatic place, so a handle can drag it square to itself; `undefined` when the
 * stubs sit level on the piece's axis (it cannot move) or on the other (it has no length). Pure.
 *
 * @param from - The placed start.
 * @param to - The placed end.
 * @returns The piece, or `undefined`.
 */
export function elbowMiddlePiece(
  from: PlacedConnectorEnd,
  to: PlacedConnectorEnd,
): ElbowMiddlePiece | undefined {
  const { join } = elbowStubs(from, to);
  const { start, end, across } = join.piece;
  return start === end || across[0] === across[1] ? undefined : join.piece;
}

/**
 * Where a curve point sits: `point.x` lengths of the line from `from` to `to` along it
 * and `point.y` across it, to the right of the travel (y grows downward). Pure.
 *
 * @param from - The start.
 * @param to - The end.
 * @param point - The curve point.
 * @returns The point, in the same frame.
 */
export function curvePointPosition(from: Point, to: Point, point: ConnectorCurvePoint): Point {
  const along = { x: to.x - from.x, y: to.y - from.y };
  return {
    x: from.x + along.x * point.x - along.y * point.y,
    y: from.y + along.y * point.x + along.x * point.y,
  };
}

/**
 * The curve point of a position, the inverse of {@link curvePointPosition}: where it
 * sits relative to the line from `from` to `to`, in fractions of its length; `undefined` when
 * the ends coincide. Pure.
 *
 * @param from - The start.
 * @param to - The end.
 * @param position - The position.
 * @returns The curve point, or `undefined`.
 */
export function curvePointOf(
  from: Point,
  to: Point,
  position: Point,
): ConnectorCurvePoint | undefined {
  const along = { x: to.x - from.x, y: to.y - from.y };
  const squared = along.x * along.x + along.y * along.y;
  if (squared === 0) return undefined;
  const offset = { x: position.x - from.x, y: position.y - from.y };
  return {
    x: (offset.x * along.x + offset.y * along.y) / squared,
    y: (offset.y * along.x - offset.x * along.y) / squared,
  };
}

/**
 * The point a cubic passes through halfway (t = ½): where a curved connector's bend handle sits.
 * Pure.
 *
 * @param cubic - The cubic.
 * @returns The point.
 */
export function cubicMidpoint(cubic: Cubic): Point {
  const [p0, p1, p2, p3] = cubic;
  return {
    x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8,
    y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8,
  };
}

/**
 * A curved connector's cubic: from one end to the other, each handle reaching
 * {@link CURVE_HANDLE_FRACTION} of the span along its end's normal, so the curve leaves square to
 * the side; a free end's handle points a third of the way to the other end, so two free ends give
 * a straight curve. With a curve point, both handles shift by the same vector so the
 * curve passes through it halfway: it then leaves its ends toward the bend. Pure.
 *
 * @param from - The placed start.
 * @param to - The placed end.
 * @param point - The point it passes through halfway (`curvePointPosition`); automatic if absent.
 *   Ignored when the ends coincide.
 * @returns The cubic.
 */
export function curvedConnectorCubic(
  from: PlacedConnectorEnd,
  to: PlacedConnectorEnd,
  point?: ConnectorCurvePoint,
): Cubic {
  const span = Math.hypot(to.point.x - from.point.x, to.point.y - from.point.y);
  const reach = span * CURVE_HANDLE_FRACTION;
  const handle = (end: PlacedConnectorEnd, other: Point): Point =>
    end.normal === null
      ? {
          x: end.point.x + (other.x - end.point.x) / 3,
          y: end.point.y + (other.y - end.point.y) / 3,
        }
      : { x: end.point.x + end.normal.x * reach, y: end.point.y + end.normal.y * reach };
  const cubic: Cubic = [from.point, handle(from, to.point), handle(to, from.point), to.point];
  if (point === undefined || span === 0) return cubic;
  // The midpoint moves ¾ as far as both handles do: shift them by 4/3 of the way to the point.
  const target = curvePointPosition(from.point, to.point, point);
  const midpoint = cubicMidpoint(cubic);
  const shift = { x: ((target.x - midpoint.x) * 4) / 3, y: ((target.y - midpoint.y) * 4) / 3 };
  const [, first, second] = cubic;
  return [
    from.point,
    { x: first.x + shift.x, y: first.y + shift.y },
    { x: second.x + shift.x, y: second.y + shift.y },
    to.point,
  ];
}

/**
 * A connector's centre line from its placed ends: straight from end to
 * end, an {@link elbowConnectorRoute}, or a {@link curvedConnectorCubic}. Pure.
 *
 * @param from - The placed start (`placeConnectorEnds`).
 * @param to - The placed end.
 * @param route - The connector's route.
 * @param handles - Where a person moved its elbow's middle piece or bent its curve; the
 *   route's own is read, the other's ignored. Automatic if absent.
 * @returns The path, in the connector's frame.
 */
export function connectorPathOf(
  from: PlacedConnectorEnd,
  to: PlacedConnectorEnd,
  route: ConnectorObject['route'],
  handles: ConnectorRouteHandles = {},
): ConnectorPath {
  const ends = [from.point, to.point];
  switch (route) {
    case 'elbow':
      return { route: elbowConnectorRoute(from, to, handles.elbowMiddle), curve: undefined };
    case 'curved':
      return { route: ends, curve: curvedConnectorCubic(from, to, handles.curvePoint) };
    default:
      return { route: ends, curve: undefined };
  }
}
