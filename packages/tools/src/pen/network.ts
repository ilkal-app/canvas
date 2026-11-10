import type { PathNetwork } from '@canvas/engine';
import type { Point, Segment, Vertex } from '@canvas/schema';

// The pen tool's immutable network operations, ported from
// the prototype's `src/vector/network.ts` (webgl-whiteboard): every function returns a new
// network and leaves its input alone. Ids of new members come from an injected generator, so
// two clients adding vertices at once never pick the same id (the document keys members by id).

/** How the two handles at a vertex follow each other: the schema's `MIRROR_MODES`. */
export type Mirror = Vertex['mirror'];

/** Which end of a segment: `a` (its start) or `b` (its end). */
export type SegmentEnd = 'a' | 'b';

/** A segment as seen from one of its end vertices: the segment and which end sits there. */
export interface SegmentAtVertex {
  /** The segment. */
  readonly segment: Segment;
  /** Which of its ends is the vertex. */
  readonly end: SegmentEnd;
}

/** A network with a vertex added, and the vertex's id. */
export interface AddedVertex {
  /** The new network. */
  readonly network: PathNetwork;
  /** The new vertex's id. */
  readonly id: string;
}

/** A network after `connect`, and the new segment's id, or `null` when it was refused. */
export interface ConnectedSegment {
  /** The new network; the same one when refused. */
  readonly network: PathNetwork;
  /** The new segment's id, or `null`. */
  readonly id: string | null;
}

/** Makes a new vertex or segment id, unique in the path (the command environment's `createId`). */
export type NetworkIdSource = () => string;

/** A handle offset of zero: a straight segment end. */
export const ZERO_HANDLE: Point = Object.freeze({ x: 0, y: 0 });

/**
 * A handle turned half a turn: the opposite offset. `0 − x` rather than `−x`, so a zero stays a
 * positive zero (a negative zero would compare equal but differ in tests and stored values).
 *
 * @param handle - The offset.
 * @returns The opposite offset.
 */
export function negated(handle: Point): Point {
  return { x: 0 - handle.x, y: 0 - handle.y };
}

/**
 * Whether a handle offset is zero (a straight end).
 *
 * @param handle - The offset.
 * @returns True for zero.
 */
export function isZeroHandle(handle: Point): boolean {
  return handle.x === 0 && handle.y === 0;
}

/**
 * The handle offset at one end of a segment.
 *
 * @param segment - The segment.
 * @param end - Which end.
 * @returns The offset from that end's vertex, local units.
 */
export function handleAt(segment: Segment, end: SegmentEnd): Point {
  return end === 'a' ? segment.ha : segment.hb;
}

/**
 * A segment with the handle at one end replaced.
 *
 * @param segment - The segment.
 * @param end - Which end.
 * @param handle - The new offset.
 * @returns A new segment.
 */
export function withHandle(segment: Segment, end: SegmentEnd, handle: Point): Segment {
  return end === 'a' ? { ...segment, ha: handle } : { ...segment, hb: handle };
}

/**
 * The vertex at a segment's other end.
 *
 * @param segment - The segment.
 * @param vertexId - One of its ends.
 * @returns The id of the vertex at the other end.
 */
export function otherEnd(segment: Segment, vertexId: string): string {
  return segment.a === vertexId ? segment.b : segment.a;
}

/**
 * The segment ends at a vertex, in segment order.
 *
 * @param network - The network.
 * @param vertexId - The vertex.
 * @returns One entry per segment ending there.
 */
export function segmentsAt(network: PathNetwork, vertexId: string): SegmentAtVertex[] {
  const ends: SegmentAtVertex[] = [];
  for (const segment of network.segments) {
    if (segment.a === vertexId) ends.push({ segment, end: 'a' });
    else if (segment.b === vertexId) ends.push({ segment, end: 'b' });
  }
  return ends;
}

/**
 * Whether a segment joins two vertices, in either direction.
 *
 * @param network - The network.
 * @param first - One vertex.
 * @param second - The other.
 * @returns True when they are joined.
 */
export function isJoined(network: PathNetwork, first: string, second: string): boolean {
  return network.segments.some(
    ({ a, b }) => (a === first && b === second) || (a === second && b === first),
  );
}

/**
 * Finds a vertex by id.
 *
 * @param network - The network.
 * @param vertexId - The vertex.
 * @returns The vertex, or `undefined`.
 */
export function vertexOf(network: PathNetwork, vertexId: string): Vertex | undefined {
  return network.vertices.find(({ id }) => id === vertexId);
}

/**
 * Adds a vertex.
 *
 * @param network - The network.
 * @param point - Where, in the path's own frame.
 * @param newId - Makes the vertex's id.
 * @param mirror - How its handles follow each other; `none` (a corner) if absent.
 * @returns The new network and the vertex's id.
 */
export function addVertex(
  network: PathNetwork,
  point: Point,
  newId: NetworkIdSource,
  mirror: Mirror = 'none',
): AddedVertex {
  const id = newId();
  const vertex: Vertex = { id, x: point.x, y: point.y, mirror };
  return { network: { vertices: [...network.vertices, vertex], segments: network.segments }, id };
}

/**
 * Joins two vertices with a segment. Refused (the network comes back unchanged and the id is
 * `null`) for a vertex joined to itself, a missing vertex, or a pair already joined: the rules
 * `findNetworkIssues` enforces.
 *
 * @param network - The network.
 * @param a - The start vertex.
 * @param b - The end vertex.
 * @param newId - Makes the segment's id.
 * @param ha - The handle at `a`; zero if absent.
 * @param hb - The handle at `b`; zero if absent.
 * @returns The network and the new segment's id, or the same network and `null`.
 */
export function connect(
  network: PathNetwork,
  a: string,
  b: string,
  newId: NetworkIdSource,
  ha: Point = ZERO_HANDLE,
  hb: Point = ZERO_HANDLE,
): ConnectedSegment {
  const isMissing = (vertexId: string) => vertexOf(network, vertexId) === undefined;
  if (a === b || isMissing(a) || isMissing(b) || isJoined(network, a, b)) {
    return { network, id: null };
  }
  const id = newId();
  const segment: Segment = { id, a, b, ha, hb };
  return { network: { vertices: network.vertices, segments: [...network.segments, segment] }, id };
}

/**
 * Moves vertices by an offset; their handles move with them (they are offsets).
 *
 * @param network - The network.
 * @param ids - The vertices.
 * @param dx - The offset along x, local units.
 * @param dy - The offset along y, local units.
 * @returns The new network.
 */
export function moveVertices(
  network: PathNetwork,
  ids: Iterable<string>,
  dx: number,
  dy: number,
): PathNetwork {
  const moved = new Set(ids);
  return {
    vertices: network.vertices.map((vertex) =>
      moved.has(vertex.id) ? { ...vertex, x: vertex.x + dx, y: vertex.y + dy } : vertex,
    ),
    segments: network.segments,
  };
}

/**
 * Drops vertices no segment touches, optionally keeping one (the lone first vertex of a chain
 * being drawn).
 *
 * @param network - The network.
 * @param keep - A vertex to keep even when no segment touches it.
 * @returns The network, the same one when nothing was dropped.
 */
export function pruneOrphans(network: PathNetwork, keep?: string): PathNetwork {
  const used = new Set<string>();
  for (const { a, b } of network.segments) {
    used.add(a);
    used.add(b);
  }
  const vertices = network.vertices.filter(({ id }) => used.has(id) || id === keep);
  return vertices.length === network.vertices.length
    ? network
    : { vertices, segments: network.segments };
}

/**
 * Deletes vertices with every segment touching them, leaving gaps, then drops the vertices
 * left with no segment (Delete in vector edit).
 *
 * @param network - The network.
 * @param ids - The vertices.
 * @returns The new network.
 */
export function deleteVertices(network: PathNetwork, ids: Iterable<string>): PathNetwork {
  const deleted = new Set(ids);
  return pruneOrphans({
    vertices: network.vertices.filter(({ id }) => !deleted.has(id)),
    segments: network.segments.filter(({ a, b }) => !deleted.has(a) && !deleted.has(b)),
  });
}

/**
 * Deletes vertices and heals the gaps (Shift+Delete in vector edit): a vertex with exactly two
 * segment ends has its two neighbours joined by one segment that keeps their outer handles,
 * unless they are the same vertex or already joined. Vertices left with no segment are dropped.
 *
 * @param network - The network.
 * @param ids - The vertices, deleted one after another.
 * @param newId - Makes the healing segments' ids.
 * @returns The new network.
 */
export function deleteAndHeal(
  network: PathNetwork,
  ids: Iterable<string>,
  newId: NetworkIdSource,
): PathNetwork {
  let current = network;
  for (const id of ids) {
    const ends = segmentsAt(current, id);
    let healed: Segment | undefined;
    const [first, second] = ends;
    if (ends.length === 2 && first && second) {
      const [from, to] = [otherEnd(first.segment, id), otherEnd(second.segment, id)];
      if (from !== to && !isJoined(current, from, to)) {
        // The handle each neighbour had towards the deleted vertex: the far end of its segment.
        const outer = ({ segment, end }: SegmentAtVertex) =>
          handleAt(segment, end === 'a' ? 'b' : 'a');
        healed = { id: newId(), a: from, b: to, ha: outer(first), hb: outer(second) };
      }
    }
    const segments = current.segments.filter(({ a, b }) => a !== id && b !== id);
    current = {
      vertices: current.vertices.filter((vertex) => vertex.id !== id),
      segments: healed ? [...segments, healed] : segments,
    };
  }
  return pruneOrphans(current);
}
