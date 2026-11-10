import type { Point, UnitPoint } from '../fields/point.js';

import type { Rect } from './local-bounds.js';
import { applyTransform, type RigidTransform } from './rigid-transform.js';

/** A connector end's target as the router sees it: its bounds and where they are. */
export interface ConnectorTargetBox {
  /** The target's bounds in its own frame (`localBounds`). */
  readonly bounds: Rect;
  /** The map from the target's frame to the connector's frame. */
  readonly toConnector: RigidTransform;
}

/**
 * One connector end, ready to place: a free point, or an anchor (null for "nearest side") on a
 * target whose box is known, or `undefined` when the target is not on the board.
 */
export type ConnectorEndInput =
  | {
      /** A free point. */
      readonly kind: 'point';
      /** Where it is, world units in the connector's frame. */
      readonly point: Point;
    }
  | {
      /** Attached to a target. */
      readonly kind: 'object';
      /** Where on the target's bounds, as fractions of its size; null picks the nearest side. */
      readonly anchor: UnitPoint | null;
      /** The target's box, or `undefined` when the target is not on the board. */
      readonly box: ConnectorTargetBox | undefined;
    };

/** Where a connector end is, and which way the connector leaves it. */
export interface PlacedConnectorEnd {
  /** The end's position, world units in the connector's frame. */
  readonly point: Point;
  /**
   * The unit outward normal of the target side the end sits on, in the connector's frame, which
   * elbow and curved routes leave along; `null` for a free point or a missing target.
   */
  readonly normal: Point | null;
}

/** Both ends of a connector, placed. */
export interface PlacedConnectorEnds {
  /** The start (`from`). */
  readonly from: PlacedConnectorEnd;
  /** The end (`to`). */
  readonly to: PlacedConnectorEnd;
}

/** A target's four sides: the anchor of each side's midpoint and its outward normal. */
const SIDES: readonly { readonly anchor: UnitPoint; readonly normal: Point }[] = [
  { anchor: { x: 0.5, y: 0 }, normal: { x: 0, y: -1 } },
  { anchor: { x: 1, y: 0.5 }, normal: { x: 1, y: 0 } },
  { anchor: { x: 0.5, y: 1 }, normal: { x: 0, y: 1 } },
  { anchor: { x: 0, y: 0.5 }, normal: { x: -1, y: 0 } },
];

/** The centre of a target's bounds, as an anchor. */
const CENTRE: UnitPoint = { x: 0.5, y: 0.5 };

/** Where an end on a missing target goes: the connector's origin, as `connectorEndPoint` had it. */
const ORIGIN: Point = { x: 0, y: 0 };

/**
 * A point of a target's bounds, in the connector's frame.
 *
 * @param box - The target's box.
 * @param anchor - The point, as fractions of the bounds' size.
 * @returns The point.
 */
function pointOn(box: ConnectorTargetBox, anchor: UnitPoint): Point {
  const { bounds } = box;
  return applyTransform(box.toConnector, {
    x: bounds.x + anchor.x * bounds.width,
    y: bounds.y + anchor.y * bounds.height,
  });
}

/**
 * A direction of the target's frame, turned into the connector's.
 *
 * @param box - The target's box.
 * @param normal - The direction, in the target's frame.
 * @returns The direction in the connector's frame.
 */
function turned(box: ConnectorTargetBox, normal: Point): Point {
  const { cos, sin } = box.toConnector;
  return { x: cos * normal.x - sin * normal.y, y: sin * normal.x + cos * normal.y };
}

/**
 * The side an anchor lies closest to, measured in world units on the target's bounds; ties go to
 * the first side in the order top, right, bottom, left.
 *
 * @param bounds - The target's bounds.
 * @param anchor - The anchor.
 * @returns The side's index in {@link SIDES}.
 */
function sideOfAnchor(bounds: Rect, anchor: UnitPoint): number {
  const distances = [
    anchor.y * bounds.height,
    (1 - anchor.x) * bounds.width,
    (1 - anchor.y) * bounds.height,
    anchor.x * bounds.width,
  ];
  let best = 0;
  distances.forEach((distance, index) => {
    if (distance < (distances[best] ?? Number.POSITIVE_INFINITY)) best = index;
  });
  return best;
}

/**
 * The point an end measures "nearest" from when the other end picks its side: a free point, a
 * fixed anchor, or the centre of a target whose own anchor is automatic (so two automatic ends
 * never depend on each other); the connector's origin for a missing target.
 *
 * @param end - The end.
 * @returns The point, in the connector's frame.
 */
function referenceOf(end: ConnectorEndInput): Point {
  if (end.kind === 'point') return end.point;
  if (end.box === undefined) return ORIGIN;
  return pointOn(end.box, end.anchor ?? CENTRE);
}

/**
 * Places one end against the other's reference point.
 *
 * @param end - The end.
 * @param towards - The other end's reference point (`referenceOf`).
 * @returns The placed end.
 */
function placeEnd(end: ConnectorEndInput, towards: Point): PlacedConnectorEnd {
  if (end.kind === 'point') return { point: { x: end.point.x, y: end.point.y }, normal: null };
  const { box } = end;
  if (box === undefined) return { point: ORIGIN, normal: null };
  if (end.anchor !== null) {
    const side = SIDES[sideOfAnchor(box.bounds, end.anchor)] ?? SIDES[0];
    return { point: pointOn(box, end.anchor), normal: side ? turned(box, side.normal) : null };
  }
  let best: PlacedConnectorEnd = { point: ORIGIN, normal: null };
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const side of SIDES) {
    const point = pointOn(box, side.anchor);
    const distance = (point.x - towards.x) ** 2 + (point.y - towards.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { point, normal: turned(box, side.normal) };
    }
  }
  return best;
}

/**
 * Places both ends of a connector: a free point where it is stored; a
 * fixed anchor at its fraction of the target's bounds, leaving along the normal of the side it is
 * closest to; an automatic anchor (`null`) at the midpoint of the target side nearest the other
 * end (its free point, its fixed anchor, or its target's centre when it is automatic too), ties
 * going to top, right, bottom, left in that order; an end whose target is missing at the
 * connector's origin. The renderer routes between these points, and detaching an end (the
 * schema's `detachConnectorsFrom`, the reference repair) writes the same point, so an end stays
 * where it was drawn when its target goes. Pure and deterministic.
 *
 * @param from - The connector's start.
 * @param to - Its end.
 * @returns Both ends placed, in the connector's frame.
 */
export function placeConnectorEnds(
  from: ConnectorEndInput,
  to: ConnectorEndInput,
): PlacedConnectorEnds {
  return { from: placeEnd(from, referenceOf(to)), to: placeEnd(to, referenceOf(from)) };
}
