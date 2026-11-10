// Networks for the pen tool's tests: built from points and index pairs with counting ids, as
// the prototype's `network.test.ts` builds them.
import type { PathNetwork } from '@canvas/engine';
import type { Point, Segment } from '@canvas/schema';

import { addVertex, connect, type NetworkIdSource } from '../network.js';

/** An empty network. */
export const EMPTY_NETWORK: PathNetwork = Object.freeze({
  vertices: Object.freeze([]),
  segments: Object.freeze([]),
});

/**
 * A counting id source: `n1`, `n2`, … (with a prefix).
 *
 * @param prefix - The ids' prefix.
 * @returns The source.
 */
export function countingIds(prefix = 'n'): NetworkIdSource {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}${String(next)}`;
  };
}

/**
 * Builds a network from points and straight segments joining them by index.
 *
 * @param points - The vertices, `[x, y]`.
 * @param edges - The segments, as pairs of vertex indexes.
 * @returns The network, deep-frozen, and the vertex ids in point order.
 */
export function buildNetwork(
  points: readonly (readonly [number, number])[],
  edges: readonly (readonly [number, number])[] = [],
): { readonly network: PathNetwork; readonly ids: string[] } {
  const newId = countingIds();
  let network = EMPTY_NETWORK;
  const ids: string[] = [];
  for (const [x, y] of points) {
    const added = addVertex(network, { x, y }, newId);
    network = added.network;
    ids.push(added.id);
  }
  for (const [a, b] of edges) network = connect(network, ids[a] ?? '', ids[b] ?? '', newId).network;
  return { network: deepFreeze(network), ids };
}

/**
 * The segment joining two vertices.
 *
 * @param network - The network.
 * @param first - One vertex.
 * @param second - The other.
 * @returns The segment.
 * @throws {Error} When no segment joins them.
 */
export function segmentBetween(network: PathNetwork, first: string, second: string): Segment {
  const segment = network.segments.find(
    ({ a, b }) => (a === first && b === second) || (a === second && b === first),
  );
  if (!segment) throw new Error(`no segment between ${first} and ${second}`);
  return segment;
}

/**
 * The handle at a vertex's end of a segment.
 *
 * @param network - The network.
 * @param segmentId - The segment.
 * @param vertexId - One of its ends.
 * @returns The handle offset.
 * @throws {Error} When there is no such segment.
 */
export function handleAtVertex(network: PathNetwork, segmentId: string, vertexId: string): Point {
  const segment = network.segments.find(({ id }) => id === segmentId);
  if (!segment) throw new Error(`no segment ${segmentId}`);
  return segment.a === vertexId ? segment.ha : segment.hb;
}

/**
 * Freezes a value and everything in it, so a test catches any mutation of its input.
 *
 * @param value - The value.
 * @returns The same value, frozen.
 */
export function deepFreeze<Value>(value: Value): Value {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
