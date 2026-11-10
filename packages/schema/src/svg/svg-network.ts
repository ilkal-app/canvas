// Subpaths into the board's vector network. A path object fills the components of its
// network in which every vertex joins exactly two segments and there are at least three vertices
// (`closedLoops` in the engine), even-odd, and strokes every segment; a network may not join two
// vertices twice or a vertex to itself (`findNetworkIssues`). So each subpath becomes its own
// chain of fresh vertices: an open subpath a chain, a closed one a loop, whose last piece ends at
// its first vertex. A loop of one or two pieces is made three by splitting its cubics in half,
// which leaves the curve unchanged. Pure.
import type { Point } from '../fields/point.js';
import type { Segment, Vertex } from '../objects/path-network.js';

import type { OutlinePiece, Subpath } from './svg-geometry.js';

/** Coordinates closer than this, world units, are the same point. */
const SAME_POINT = 1e-6;

/** A vector network in some frame: vertices and the segments joining them. */
export interface Network {
  /** The vertices, ids `v0`, `v1`, … . */
  readonly vertices: Vertex[];
  /** The segments, ids `s0`, `s1`, … . */
  readonly segments: Segment[];
}

/**
 * Tells whether two points are the same, within {@link SAME_POINT}.
 *
 * @param p - A point.
 * @param q - Another.
 * @returns True when they coincide.
 */
function samePoint(p: Point, q: Point): boolean {
  return Math.abs(p.x - q.x) <= SAME_POINT && Math.abs(p.y - q.y) <= SAME_POINT;
}

/**
 * Tells whether a piece draws nothing from `from`: a line to its start, or a cubic whose control
 * points and end are all its start.
 *
 * @param from - Where the piece starts.
 * @param piece - The piece.
 * @returns True for a zero-length piece.
 */
function isEmptyPiece(from: Point, piece: OutlinePiece): boolean {
  if (!samePoint(from, piece.to)) return false;
  return piece.kind === 'line' || (samePoint(from, piece.c1) && samePoint(from, piece.c2));
}

/**
 * Splits a cubic in half (de Casteljau at t = 0.5): the same curve as two cubics.
 *
 * @param from - Where it starts.
 * @param piece - The cubic.
 * @returns The two halves.
 */
function halveCubic(
  from: Point,
  piece: Extract<OutlinePiece, { kind: 'cubic' }>,
): [OutlinePiece, OutlinePiece] {
  const mid = (p: Point, q: Point): Point => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const ab = mid(from, piece.c1);
  const bc = mid(piece.c1, piece.c2);
  const cd = mid(piece.c2, piece.to);
  const abc = mid(ab, bc);
  const bcd = mid(bc, cd);
  const centre = mid(abc, bcd);
  return [
    { kind: 'cubic', c1: ab, c2: abc, to: centre },
    { kind: 'cubic', c1: bcd, c2: cd, to: piece.to },
  ];
}

/**
 * A closed subpath's pieces, at least three where any is a cubic: the first cubic is split in
 * half until there are three, so the loop has three vertices and no two of its segments join the
 * same pair. Two lines (there and back) stay two; the caller draws them as one open line.
 *
 * @param start - The loop's start.
 * @param pieces - Its pieces, the last ending at its start.
 * @returns The pieces.
 */
function loopOfThree(start: Point, pieces: readonly OutlinePiece[]): OutlinePiece[] {
  let result = [...pieces];
  while (result.length < 3) {
    const index = result.findIndex((piece) => piece.kind === 'cubic');
    const piece = result[index];
    if (piece?.kind !== 'cubic') break;
    const from = result.slice(0, index).reduce<Point>((unused, before) => before.to, start);
    result = [...result.slice(0, index), ...halveCubic(from, piece), ...result.slice(index + 1)];
  }
  return result;
}

/** Builds a network, numbering vertices and segments in the order they are added. */
class NetworkBuilder {
  readonly vertices: Vertex[] = [];
  readonly segments: Segment[] = [];

  vertex(point: Point): string {
    const id = `v${String(this.vertices.length)}`;
    this.vertices.push({ id, x: point.x, y: point.y, mirror: 'none' });
    return id;
  }

  segment(a: string, from: Point, piece: OutlinePiece, b: string): void {
    const zero = { x: 0, y: 0 };
    const id = `s${String(this.segments.length)}`;
    this.segments.push(
      piece.kind === 'line'
        ? { id, a, b, ha: zero, hb: zero }
        : {
            id,
            a,
            b,
            ha: { x: piece.c1.x - from.x, y: piece.c1.y - from.y },
            hb: { x: piece.c2.x - piece.to.x, y: piece.c2.y - piece.to.y },
          },
    );
  }

  /**
   * Adds pieces as a chain from `start`; `isClosing` names the vertex the last piece ends at.
   *
   * @param start - Where the chain starts.
   * @param pieces - Its pieces.
   * @param isClosing - Whether the last piece ends at the first vertex (a loop).
   */
  chain(start: Point, pieces: readonly OutlinePiece[], isClosing: boolean): void {
    const first = this.vertex(start);
    let at = first;
    let from = start;
    pieces.forEach((piece, index) => {
      const isLast = index === pieces.length - 1;
      const next = isLast && isClosing ? first : this.vertex(piece.to);
      this.segment(at, from, piece, next);
      at = next;
      from = piece.to;
    });
  }
}

/**
 * The pieces of a subpath that draw something.
 *
 * @param subpath - The subpath.
 * @returns Its pieces, zero-length ones dropped.
 */
function drawnPieces(subpath: Subpath): OutlinePiece[] {
  const pieces: OutlinePiece[] = [];
  let from = subpath.start;
  for (const piece of subpath.pieces) {
    if (isEmptyPiece(from, piece)) continue;
    pieces.push(piece);
    from = piece.to;
  }
  return pieces;
}

/**
 * Builds the network of some subpaths: each open subpath a chain, each closed one a loop of at
 * least three vertices. With `shouldCloseAll`, open subpaths are closed too, as SVG fills them.
 * Zero-length pieces are dropped, and a subpath that draws nothing adds nothing.
 *
 * @param subpaths - The subpaths, in the path's own frame; not mutated.
 * @param shouldCloseAll - Whether to close the open subpaths (a fill's network).
 * @returns The network, and how many loops (fillable regions) it has.
 */
export function subpathsToNetwork(
  subpaths: readonly Subpath[],
  shouldCloseAll: boolean,
): Network & {
  /** How many loops (fillable regions) the network has. */
  readonly loops: number;
} {
  const builder = new NetworkBuilder();
  let loops = 0;
  for (const subpath of subpaths) {
    const pieces = drawnPieces(subpath);
    const last = pieces.at(-1);
    if (last === undefined) continue;
    if (!(subpath.isClosed || shouldCloseAll)) {
      builder.chain(subpath.start, pieces, false);
      continue;
    }
    const closing: OutlinePiece[] = samePoint(last.to, subpath.start)
      ? []
      : [{ kind: 'line', to: subpath.start }];
    const loop = loopOfThree(subpath.start, [...pieces, ...closing]);
    // Two lines there and back enclose nothing: one open line draws them.
    if (loop.length < 3) builder.chain(subpath.start, loop.slice(0, 1), false);
    else {
      builder.chain(subpath.start, loop, true);
      loops += 1;
    }
  }
  return { vertices: builder.vertices, segments: builder.segments, loops };
}

/**
 * Tells whether any subpath is open and draws something: such a path's fill needs its own,
 * closed network, since the board fills only loops.
 *
 * @param subpaths - The subpaths.
 * @returns True when one is open.
 */
export function hasOpenSubpath(subpaths: readonly Subpath[]): boolean {
  return subpaths.some((subpath) => !subpath.isClosed && drawnPieces(subpath).length > 0);
}

/**
 * Moves a network so its bounds (vertices and handle points, as `pathBounds` measures them) start
 * at its origin, and says where that origin was: the path object's `x` and `y`.
 *
 * @param network - The network, in the parent's frame; not mutated.
 * @returns The origin, and the network in the path's own frame.
 */
export function placeNetwork(
  network: Network,
): Network & { readonly x: number; readonly y: number } {
  const byId = new Map(network.vertices.map((vertex) => [vertex.id, vertex]));
  let x = Infinity;
  let y = Infinity;
  const include = (px: number, py: number): void => {
    x = Math.min(x, px);
    y = Math.min(y, py);
  };
  for (const vertex of network.vertices) include(vertex.x, vertex.y);
  for (const segment of network.segments) {
    const a = byId.get(segment.a);
    const b = byId.get(segment.b);
    if (a !== undefined) include(a.x + segment.ha.x, a.y + segment.ha.y);
    if (b !== undefined) include(b.x + segment.hb.x, b.y + segment.hb.y);
  }
  return {
    x,
    y,
    vertices: network.vertices.map((vertex) => ({ ...vertex, x: vertex.x - x, y: vertex.y - y })),
    segments: network.segments,
  };
}
