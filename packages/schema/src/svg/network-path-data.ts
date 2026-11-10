// A vector network as SVG path data, the inverse of `readPathData` and
// `subpathsToNetwork` up to ids and vertex order: what `query_board` returns so an agent can read
// a path back in the form it writes. Open chains come first, each from a vertex that does not join
// exactly two segments (an end or a junction) as far as the next such vertex; then every loop left,
// in which each vertex joins two segments, as `M…Z`. A segment whose handles are both zero is a
// line (`L`), any other a cubic (`C`). Coordinates are absolute, in the path's own frame, rounded
// to three decimals. Mirroring is an editing constraint and is not written. Pure.
import type { Point } from '../fields/point.js';
import type { Segment, Vertex } from '../objects/path-network.js';

/** Decimals kept in each coordinate. */
const DECIMALS = 3;

/**
 * Writes a coordinate: rounded to {@link DECIMALS} places, trailing zeros and a negative zero
 * dropped.
 *
 * @param value - The coordinate.
 * @returns Its text.
 */
function formatNumber(value: number): string {
  const rounded = Number(value.toFixed(DECIMALS));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * Writes a point as two numbers.
 *
 * @param point - The point.
 * @returns Its text.
 */
function formatPoint(point: Point): string {
  return `${formatNumber(point.x)} ${formatNumber(point.y)}`;
}

/**
 * Tells whether a segment is straight: both handles zero.
 *
 * @param segment - The segment.
 * @returns True for a line.
 */
function isStraight(segment: Segment): boolean {
  return segment.ha.x === 0 && segment.ha.y === 0 && segment.hb.x === 0 && segment.hb.y === 0;
}

/** The network's vertices by id, and each vertex's segments in segment order. */
interface Adjacency {
  readonly vertices: ReadonlyMap<string, Vertex>;
  readonly joined: ReadonlyMap<string, readonly Segment[]>;
}

/**
 * Indexes a network.
 *
 * @param vertices - Its vertices.
 * @param segments - Its segments.
 * @returns The vertices by id and the segments at each vertex.
 */
function adjacencyOf(vertices: readonly Vertex[], segments: readonly Segment[]): Adjacency {
  const byId = new Map(vertices.map((vertex) => [vertex.id, vertex]));
  const joined = new Map<string, Segment[]>(vertices.map((vertex) => [vertex.id, []]));
  for (const segment of segments) {
    joined.get(segment.a)?.push(segment);
    if (segment.b !== segment.a) joined.get(segment.b)?.push(segment);
  }
  return { vertices: byId, joined };
}

/**
 * Writes one segment walked from `from` (its `a` or its `b`) as a command, and says where it
 * ends.
 *
 * @param segment - The segment.
 * @param from - The vertex it is walked from.
 * @param adjacency - The network's index.
 * @returns The command and the vertex it reaches, or undefined when an end is missing.
 */
function writeSegment(
  segment: Segment,
  from: Vertex,
  adjacency: Adjacency,
): { readonly command: string; readonly to: Vertex } | undefined {
  const isForward = segment.a === from.id;
  const to = adjacency.vertices.get(isForward ? segment.b : segment.a);
  if (to === undefined) return undefined;
  if (isStraight(segment)) return { command: `L${formatPoint(to)}`, to };
  const [first, second] = isForward ? [segment.ha, segment.hb] : [segment.hb, segment.ha];
  const c1 = { x: from.x + first.x, y: from.y + first.y };
  const c2 = { x: to.x + second.x, y: to.y + second.y };
  return { command: `C${formatPoint(c1)} ${formatPoint(c2)} ${formatPoint(to)}`, to };
}

/**
 * Writes a vector network as SVG path data in the path's own frame: open chains first, then each
 * loop closed with `Z`. Reading it back with `readPathData` and `subpathsToNetwork` gives the same
 * curves; a loop through a junction comes back as an open chain, which the board does not fill
 * either.
 *
 * @param vertices - The network's vertices; not mutated.
 * @param segments - Its segments; not mutated.
 * @returns The path data, empty for a network with no segments.
 */
export function networkToPathData(
  vertices: readonly Vertex[],
  segments: readonly Segment[],
): string {
  const adjacency = adjacencyOf(vertices, segments);
  const used = new Set<string>();
  const parts: string[] = [];
  const degree = (vertex: Vertex): number => adjacency.joined.get(vertex.id)?.length ?? 0;

  /**
   * Walks unused segments from `start` and its first segment until a vertex that does not join
   * exactly two segments, or one whose other segment is used.
   *
   * @param start - The vertex to start from.
   * @param first - The segment to start along.
   * @param isLoop - Whether the walk is a loop, closed with `Z`.
   */
  const walk = (start: Vertex, first: Segment, isLoop: boolean): void => {
    let at = start;
    let next: Segment | undefined = first;
    let text = `M${formatPoint(start)}`;
    let isDrawn = false;
    let isClosed = false;
    while (next !== undefined) {
      used.add(next.id);
      const written = writeSegment(next, at, adjacency);
      if (written === undefined) break;
      const isClosing = isLoop && written.to.id === start.id;
      // A closepath draws the last line of a loop itself.
      isDrawn = true;
      if (!(isClosing && isStraight(next))) text += written.command;
      at = written.to;
      if (isClosing) {
        isClosed = true;
        break;
      }
      next =
        degree(at) === 2
          ? adjacency.joined.get(at.id)?.find((segment) => !used.has(segment.id))
          : undefined;
    }
    // A segment whose other end is gone (a merge can leave one) draws nothing.
    if (isDrawn) parts.push(isClosed ? `${text}Z` : text);
  };

  for (const vertex of vertices) {
    if (degree(vertex) === 2) continue;
    for (const segment of adjacency.joined.get(vertex.id) ?? []) {
      if (!used.has(segment.id)) walk(vertex, segment, false);
    }
  }
  for (const segment of segments) {
    if (used.has(segment.id)) continue;
    const start = adjacency.vertices.get(segment.a);
    if (start !== undefined) walk(start, segment, true);
  }
  return parts.join('');
}
