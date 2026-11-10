import type { PathNetwork } from '@canvas/engine';
import type { Vertex } from '@canvas/schema';

// The pen never writes a vertex that no segment joins (fix round 1): the document hides
// such a vertex once its network has a segment (`codec/network-visibility.ts` in
// `@canvas/document`), and a path of lone vertices is invisible and cannot be picked. The first
// click of a chain, or the vertex a Backspace steps back to when it has no segment left, is held
// in the pen's state and previewed; the next press writes it with the segment that joins it, and
// ending the chain drops it. So the first click of a new path writes nothing, and Escape after
// it leaves nothing to undo.

/** A network split into what the pen writes and the chain vertex it holds back. */
export interface HeldSplit {
  /** The network to write: `network` without the held vertex. */
  readonly written: PathNetwork;
  /** The chain's vertex when no segment joins it, else `undefined`. */
  readonly held: Vertex | undefined;
}

/**
 * The network the pen works on: the path's, with the held vertex, if any, appended.
 *
 * @param network - The path's network (the document's or the draft's).
 * @param held - The held vertex.
 * @returns The working network; `network` itself when nothing is held.
 */
export function withHeld(network: PathNetwork, held: Vertex | undefined): PathNetwork {
  return held === undefined
    ? network
    : { vertices: [...network.vertices, held], segments: network.segments };
}

/**
 * Splits off the chain's vertex when no segment joins it. Pure.
 *
 * @param network - The network after a press or a Backspace.
 * @param chainVertexId - The chain's vertex, if any.
 * @returns The network to write and the vertex to hold.
 */
export function splitHeld(network: PathNetwork, chainVertexId: string | undefined): HeldSplit {
  const isJoined = network.segments.some(({ a, b }) => a === chainVertexId || b === chainVertexId);
  const held = isJoined ? undefined : network.vertices.find(({ id }) => id === chainVertexId);
  if (held === undefined) return { written: network, held };
  const vertices = network.vertices.filter((vertex) => vertex !== held);
  return { written: { vertices, segments: network.segments }, held };
}
