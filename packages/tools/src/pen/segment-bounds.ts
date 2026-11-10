import { cubicOf, type Cubic, type PathNetwork } from '@canvas/engine';
import type { Segment } from '@canvas/schema';

// The box round each segment's curve, so a hit test measures the distance to a curve only for the
// few segments whose box is near the point (fix round 2: a hover move over a 1,000-segment
// path measured every curve, 7.7 ms a move). A cubic lies inside the hull of its four control
// points, so the box of those points holds the curve. A network is immutable (a decoded path, or
// a new network from an edit), so its identity is its version: the boxes are kept per network
// object, and forgotten with it.

/** A segment with its curve and the box round the curve, local units. */
export interface SegmentBounds {
  /** The segment. */
  readonly segment: Segment;
  /** Its curve. */
  readonly cubic: Cubic;
  /** The box's left edge. */
  readonly minX: number;
  /** The box's top edge. */
  readonly minY: number;
  /** The box's right edge. */
  readonly maxX: number;
  /** The box's bottom edge. */
  readonly maxY: number;
}

/** The boxes of the networks seen, per network object. */
const boundsByNetwork = new WeakMap<PathNetwork, readonly SegmentBounds[]>();

/**
 * The box round a curve's control points, which holds the curve.
 *
 * @param segment - The segment.
 * @param cubic - Its curve.
 * @returns The segment with its curve and box.
 */
function boundsOf(segment: Segment, cubic: Cubic): SegmentBounds {
  const xs = cubic.map(({ x }) => x);
  const ys = cubic.map(({ y }) => y);
  return {
    segment,
    cubic,
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/**
 * The boxes of a network's segments whose two ends it holds, in segment order; computed once
 * per network object.
 *
 * @param network - The network.
 * @returns The segments with their curves and boxes.
 */
export function segmentBoundsOf(network: PathNetwork): readonly SegmentBounds[] {
  const known = boundsByNetwork.get(network);
  if (known !== undefined) return known;
  const vertexById = new Map(network.vertices.map((vertex) => [vertex.id, vertex]));
  const bounds = network.segments
    .filter(({ a, b }) => vertexById.has(a) && vertexById.has(b))
    .map((segment) => boundsOf(segment, cubicOf({ vertexById }, segment)));
  boundsByNetwork.set(network, bounds);
  return bounds;
}

/**
 * Whether a point is within a distance of a segment's box.
 *
 * @param bounds - The segment's box.
 * @param x - The point's x, local units.
 * @param y - The point's y, local units.
 * @param distance - The distance, local units.
 * @returns `true` when the point may be that near the curve.
 */
export function isNearBounds(bounds: SegmentBounds, x: number, y: number, distance: number) {
  return (
    x >= bounds.minX - distance &&
    x <= bounds.maxX + distance &&
    y >= bounds.minY - distance &&
    y <= bounds.maxY + distance
  );
}
