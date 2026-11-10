import type { PathNetwork } from '@canvas/engine';
import type { Point } from '@canvas/schema';

import {
  handleAt,
  isZeroHandle,
  negated,
  otherEnd,
  segmentsAt,
  vertexOf,
  withHandle,
  ZERO_HANDLE,
  type Mirror,
  type SegmentEnd,
} from './network.js';

// Handle operations of the pen tool, ported from the prototype's
// `setHandle` and `toggleSmooth` (webgl-whiteboard `src/vector/network.ts`) and the pen mode's
// `continuationHandle` (`src/app/modes/penMode.ts`). Handles belong to segment ends; a vertex's
// `mirror` couples the two handles only while exactly two segment ends meet there.

/**
 * Sets one segment end's handle. When exactly two segment ends meet at that end's vertex, the
 * other handle follows the vertex's `mirror`: `both` makes it the exact negation, `angle` turns
 * it opposite and keeps its length, `none` leaves it. `isBreakingMirror` (Alt) moves only this
 * handle and sets the vertex's `mirror` to `none`.
 *
 * @param network - The network.
 * @param segmentId - The segment.
 * @param end - Which end's handle.
 * @param offset - The new handle offset, local units.
 * @param isBreakingMirror - Whether to break the pairing (Alt).
 * @returns The new network; the same one for an unknown segment.
 */
export function setHandle(
  network: PathNetwork,
  segmentId: string,
  end: SegmentEnd,
  offset: Point,
  isBreakingMirror: boolean,
): PathNetwork {
  const segment = network.segments.find(({ id }) => id === segmentId);
  if (segment === undefined) return network;
  const vertexId = end === 'a' ? segment.a : segment.b;
  const vertex = vertexOf(network, vertexId);
  const ends = segmentsAt(network, vertexId);
  const other =
    ends.length === 2 ? ends.find((entry) => entry.segment.id !== segmentId) : undefined;
  let otherHandle: Point | undefined;
  if (other && vertex && !isBreakingMirror && vertex.mirror !== 'none') {
    const length = Math.hypot(offset.x, offset.y);
    if (vertex.mirror === 'both') otherHandle = negated(offset);
    else if (length > 0) {
      const current = handleAt(other.segment, other.end);
      const kept = Math.hypot(current.x, current.y);
      otherHandle = negated({ x: (offset.x / length) * kept, y: (offset.y / length) * kept });
    }
  }
  const segments = network.segments.map((candidate) => {
    if (candidate.id === segmentId) return withHandle(candidate, end, offset);
    if (other && otherHandle && candidate.id === other.segment.id) {
      return withHandle(candidate, other.end, otherHandle);
    }
    return candidate;
  });
  const isBreaking = isBreakingMirror && vertex !== undefined && vertex.mirror !== 'none';
  const vertices = isBreaking
    ? network.vertices.map((candidate) =>
        candidate.id === vertexId ? { ...candidate, mirror: 'none' as const } : candidate,
      )
    : network.vertices;
  return { vertices, segments };
}

/**
 * A network with one vertex's `mirror` set.
 *
 * @param network - The network.
 * @param vertexId - The vertex.
 * @param mirror - The mode.
 * @returns The vertices.
 */
function withMirror(network: PathNetwork, vertexId: string, mirror: Mirror) {
  return network.vertices.map((vertex) =>
    vertex.id === vertexId ? { ...vertex, mirror } : vertex,
  );
}

/**
 * Toggles a vertex between corner and smooth (Alt-click in vector edit). A corner with exactly
 * two segment ends becomes smooth (`mirror: 'both'`), its handles along the direction from one
 * neighbour to the other, each a third of that neighbour's distance. A vertex with any handle
 * pulled out becomes a corner: its handles go to zero and `mirror` to `none`. A vertex with
 * other than two ends and no handles, or two neighbours in one place, is left alone.
 *
 * @param network - The network.
 * @param vertexId - The vertex.
 * @returns The new network; the same one when nothing changes.
 */
export function toggleSmooth(network: PathNetwork, vertexId: string): PathNetwork {
  const ends = segmentsAt(network, vertexId);
  const vertex = vertexOf(network, vertexId);
  if (!vertex || ends.length === 0) return network;
  const isCurved = ends.some(({ segment, end }) => !isZeroHandle(handleAt(segment, end)));
  if (isCurved) {
    const segments = network.segments.map((segment) => {
      const at = ends.find((entry) => entry.segment.id === segment.id);
      return at ? withHandle(segment, at.end, ZERO_HANDLE) : segment;
    });
    return { vertices: withMirror(network, vertexId, 'none'), segments };
  }
  const [first, second] = ends;
  if (ends.length !== 2 || !first || !second) return network;
  const before = vertexOf(network, otherEnd(first.segment, vertexId));
  const after = vertexOf(network, otherEnd(second.segment, vertexId));
  if (!before || !after) return network;
  const length = Math.hypot(after.x - before.x, after.y - before.y);
  if (length === 0) return network;
  const [ux, uy] = [(after.x - before.x) / length, (after.y - before.y) / length];
  const toBefore = Math.hypot(before.x - vertex.x, before.y - vertex.y) / 3;
  const toAfter = Math.hypot(after.x - vertex.x, after.y - vertex.y) / 3;
  const segments = network.segments.map((segment) => {
    if (segment.id === first.segment.id) {
      return withHandle(segment, first.end, negated({ x: ux * toBefore, y: uy * toBefore }));
    }
    if (segment.id === second.segment.id) {
      return withHandle(segment, second.end, { x: ux * toAfter, y: uy * toAfter });
    }
    return segment;
  });
  return { vertices: withMirror(network, vertexId, 'both'), segments };
}

/**
 * The handle a new segment takes at a vertex it starts from or arrives at, to continue smoothly
 * through an open smooth end (the prototype's smooth continuation): the negation of the vertex's
 * one handle, when exactly one segment ends there, that handle is pulled out and the vertex is
 * not a plain corner (`mirror` other than `none`).
 *
 * @param network - The network.
 * @param vertexId - The vertex.
 * @returns The handle to use, or `undefined` for none (a straight end).
 */
export function continuationHandle(network: PathNetwork, vertexId: string): Point | undefined {
  const vertex = vertexOf(network, vertexId);
  if (!vertex || vertex.mirror === 'none') return undefined;
  const ends = segmentsAt(network, vertexId);
  const [only] = ends;
  if (ends.length !== 1 || !only) return undefined;
  const handle = handleAt(only.segment, only.end);
  return isZeroHandle(handle) ? undefined : negated(handle);
}
