import {
  cubicOf,
  evalCubic,
  isStraightCubic,
  splitCubic,
  type Cubic,
  type PathNetwork,
} from '@canvas/engine';
import type { Point, Segment, Vertex } from '@canvas/schema';

import { ZERO_HANDLE, type NetworkIdSource } from './network.js';

/** A network with a segment split, and the vertex inserted. */
export interface SplitSegment {
  /** The new network. */
  readonly network: PathNetwork;
  /** The inserted vertex's id. */
  readonly vertexId: string;
}

/**
 * The offset from one point to another.
 *
 * @param point - The point.
 * @param origin - Where the offset is measured from.
 * @returns `point − origin`.
 */
function offsetFrom(point: Point, origin: Point): Point {
  return { x: point.x - origin.x, y: point.y - origin.y };
}

/**
 * The two segments that trace the halves of a split curve: the first keeps the split segment's
 * id and start, the second is new and keeps its end.
 *
 * @param segment - The segment split.
 * @param halves - The curve's halves, or `undefined` for a straight segment.
 * @param vertexId - The new vertex between them.
 * @param newSegmentId - The second segment's id.
 * @returns The two segments.
 */
function halvesOf(
  segment: Segment,
  halves: readonly [Cubic, Cubic] | undefined,
  vertexId: string,
  newSegmentId: string,
): [Segment, Segment] {
  if (halves === undefined) {
    return [
      { id: segment.id, a: segment.a, b: vertexId, ha: ZERO_HANDLE, hb: ZERO_HANDLE },
      { id: newSegmentId, a: vertexId, b: segment.b, ha: ZERO_HANDLE, hb: ZERO_HANDLE },
    ];
  }
  const [left, right] = halves;
  return [
    {
      id: segment.id,
      a: segment.a,
      b: vertexId,
      ha: offsetFrom(left[1], left[0]),
      hb: offsetFrom(left[2], left[3]),
    },
    {
      id: newSegmentId,
      a: vertexId,
      b: segment.b,
      ha: offsetFrom(right[1], right[0]),
      hb: offsetFrom(right[2], right[3]),
    },
  ];
}

/**
 * Inserts a vertex into a segment at a curve parameter without moving the curve (a pen click on
 * a segment; the prototype's `splitSegment`): de Casteljau's halves become the two segments, the
 * new vertex smooth (`angle`) on a curve. A straight segment stays two straight segments with a
 * corner between them: de Casteljau on a zero-handle cubic would leave the split handles inside
 * the chord, turning an exactly straight line into a slightly curved one.
 *
 * @param network - The network.
 * @param segmentId - The segment.
 * @param t - Where, the curve parameter in [0, 1].
 * @param newId - Makes the new vertex's and segment's ids.
 * @returns The new network and the new vertex's id; `undefined` for an unknown segment.
 */
export function splitSegment(
  network: PathNetwork,
  segmentId: string,
  t: number,
  newId: NetworkIdSource,
): SplitSegment | undefined {
  const index = network.segments.findIndex(({ id }) => id === segmentId);
  const segment = network.segments[index];
  if (segment === undefined) return undefined;
  const vertexById = new Map(network.vertices.map((vertex) => [vertex.id, vertex]));
  if (!vertexById.has(segment.a) || !vertexById.has(segment.b)) return undefined;
  const cubic = cubicOf({ vertexById }, segment);
  const isStraight = isStraightCubic(cubic);
  const halves = isStraight ? undefined : splitCubic(cubic, t);
  const at = halves === undefined ? evalCubic(cubic, t) : halves[0][3];
  const vertexId = newId();
  const vertex: Vertex = { id: vertexId, x: at.x, y: at.y, mirror: isStraight ? 'none' : 'angle' };
  const [first, second] = halvesOf(segment, halves, vertexId, newId());
  const segments = [
    ...network.segments.slice(0, index),
    first,
    second,
    ...network.segments.slice(index + 1),
  ];
  return { network: { vertices: [...network.vertices, vertex], segments }, vertexId };
}
