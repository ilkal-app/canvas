import type { Segment, Vertex } from '@canvas/schema';

import type { VertexLookup } from './bezier.js';

/**
 * A vector network: the `vertices` and `segments` of a path object, in
 * its own frame. Well formed as `findNetworkIssues` of `@canvas/schema` defines it.
 */
export interface PathNetwork {
  /** The vertices. */
  readonly vertices: readonly Vertex[];
  /** The cubic segments joining pairs of vertices. */
  readonly segments: readonly Segment[];
}

/** One end of a segment as seen from a vertex: the segment and the vertex at its other end. */
export interface NetworkEdge {
  /** The segment. */
  readonly segment: Segment;
  /** The id of the vertex at the segment's other end. */
  readonly to: string;
}

/**
 * A network with its lookups built once: vertices by id and each vertex's edges, so walking
 * chains and loops is linear in the network's size (the prototype searched the segment list
 * per step, which is quadratic on a 1k-segment path).
 */
export interface NetworkIndex extends VertexLookup {
  /** The network indexed. */
  readonly network: PathNetwork;
  /** Every vertex's edges, in segment order; a vertex no segment touches has none. */
  readonly edgesByVertex: ReadonlyMap<string, readonly NetworkEdge[]>;
}

/**
 * Indexes a network. Pure; the network is not copied, so it must not change afterwards.
 * Segments whose ends are missing are skipped (a network `findNetworkIssues` rejects).
 *
 * @param network - The network.
 * @returns Its index.
 */
export function indexNetwork(network: PathNetwork): NetworkIndex {
  const vertexById = new Map<string, Vertex>();
  const edgesByVertex = new Map<string, NetworkEdge[]>();
  for (const vertex of network.vertices) {
    vertexById.set(vertex.id, vertex);
    edgesByVertex.set(vertex.id, []);
  }
  for (const segment of network.segments) {
    const fromA = edgesByVertex.get(segment.a);
    const fromB = edgesByVertex.get(segment.b);
    if (!fromA || !fromB) continue;
    fromA.push({ segment, to: segment.b });
    fromB.push({ segment, to: segment.a });
  }
  return { network, vertexById, edgesByVertex };
}

/**
 * A vertex's edges.
 *
 * @param index - The network's index.
 * @param vertexId - The vertex.
 * @returns Its edges; empty for an unknown or isolated vertex.
 */
export function edgesOf(index: NetworkIndex, vertexId: string): readonly NetworkEdge[] {
  return index.edgesByVertex.get(vertexId) ?? [];
}
