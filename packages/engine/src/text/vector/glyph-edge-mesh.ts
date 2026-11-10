// A glyph's edge hulls for the vector tier's analytic antialiasing: one quad per edge,
// two triangles, whose every vertex carries the whole edge (its start, control and end, em with
// y up), which corner of the hull it is, and the edge's kind and side. The edge shader
// (GLYPH_EDGE_SHADER) grows each hull by a device pixel around its edge and covers it with the
// signed distance to the edge. Pure: no DOM, no GPU.
import type { GlyphEdge } from './glyph-edges.js';

/** A glyph's edge hulls, em with y up. */
export interface GlyphEdgeMesh {
  /**
   * {@link EDGE_FLOATS_PER_VERTEX} floats per vertex, six vertices per edge: the edge's start,
   * control point and end (x, y each; a line's control is its middle), the hull corner (−1 or
   * +1 along the chord, then across it), the kind and side (±1 for a line, +1 when its
   * outside is to the left of its direction; ±2 for a quadratic, +2 when its inside is on its
   * chord's side, away from the control point), then the outward unit normals of the edges
   * before and after it where they meet it (x, y each), and how they meet it at its start and
   * at its end: +1 at a convex join, −1 at a reflex one, 0 where they run on straight.
   */
  readonly vertices: Float32Array;
  /** How many vertices: six per edge. */
  readonly vertexCount: number;
}

/**
 * Floats per edge vertex: start, control, end, corner, kind and side, the neighbours' normals,
 * and the joins.
 */
export const EDGE_FLOATS_PER_VERTEX = 15;

/**
 * The sine of the turn below which two edges are taken to run on straight (about 6°): a curve's
 * pieces meet smoothly, and only a real corner's neighbour changes what is covered past an end.
 */
const STRAIGHT_SINE = 0.1;

type Point = readonly [number, number];

/** The hull's corners, two triangles: along the chord, then across it. */
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, -1],
  [1, 1],
  [-1, 1],
] as const;

/**
 * The hulls of a glyph's edges, one quad each.
 *
 * @param edges - The glyph's edges, each with its inside side (`glyphEdges`).
 * @returns The hulls.
 */
export function glyphEdgeMesh(edges: readonly GlyphEdge[]): GlyphEdgeMesh {
  const vertices = new Float32Array(edges.length * CORNERS.length * EDGE_FLOATS_PER_VERTEX);
  const neighbours = neighboursOf(edges);
  let offset = 0;
  edges.forEach((edge, index) => {
    const [start, control, end, side] =
      edge.kind === 'line'
        ? [edge.from, midpoint(edge.from, edge.to), edge.to, -edge.inside]
        : [edge.start, edge.control, edge.end, 2 * quadraticSide(edge)];
    const { before, after } = neighbours[index] ?? { before: edge, after: edge };
    const startJoin = joinOf(before, edge);
    const endJoin = joinOf(edge, after);
    const previous = outwardNormal(before, 'end');
    const next = outwardNormal(after, 'start');
    // The edge's floats, once; then each corner a copy with its own corner pair.
    const first = offset;
    vertices[first] = start[0];
    vertices[first + 1] = start[1];
    vertices[first + 2] = control[0];
    vertices[first + 3] = control[1];
    vertices[first + 4] = end[0];
    vertices[first + 5] = end[1];
    vertices[first + 8] = side;
    vertices[first + 9] = previous[0];
    vertices[first + 10] = previous[1];
    vertices[first + 11] = next[0];
    vertices[first + 12] = next[1];
    vertices[first + 13] = startJoin;
    vertices[first + 14] = endJoin;
    for (const [along, across] of CORNERS) {
      if (offset !== first) vertices.copyWithin(offset, first, first + EDGE_FLOATS_PER_VERTEX);
      vertices[offset + 6] = along;
      vertices[offset + 7] = across;
      offset += EDGE_FLOATS_PER_VERTEX;
    }
  });
  return { vertices, vertexCount: edges.length * CORNERS.length };
}

/**
 * Each edge's neighbours on the outline's boundary: the edge ending where it starts, and the one
 * starting where it ends. Consecutive edges usually are (a contour is a run of edges each starting
 * where the last ended); where the boundary runs on from one contour to another at a crossing
 * (`glyphEdges` splits pieces there and leaves out the parts inside the filled area), the
 * neighbour is the edge that shares the point. An edge with none is its own, which joins straight.
 *
 * @param edges - The edges, contour by contour, in order.
 * @returns Per edge, the edge before it and the edge after it.
 */
function neighboursOf(edges: readonly GlyphEdge[]): { before: GlyphEdge; after: GlyphEdge }[] {
  const starting = new Map<string, GlyphEdge[]>();
  const ending = new Map<string, GlyphEdge[]>();
  for (const edge of edges) {
    const [from, to] = [keyOf(startOf(edge)), keyOf(endOf(edge))];
    starting.set(from, [...(starting.get(from) ?? []), edge]);
    ending.set(to, [...(ending.get(to) ?? []), edge]);
  }
  return edges.map((edge, index) => {
    const next = edges[index + 1];
    const previous = edges[index - 1];
    const afters = starting.get(keyOf(endOf(edge))) ?? [];
    const befores = ending.get(keyOf(startOf(edge))) ?? [];
    // The next edge in order when it carries on from this one, else whichever does.
    const after =
      next !== undefined && afters.includes(next) ? next : (afters.find((e) => e !== edge) ?? edge);
    const before =
      previous !== undefined && befores.includes(previous)
        ? previous
        : (befores.find((e) => e !== edge) ?? edge);
    return { before, after };
  });
}

function keyOf(point: Point): string {
  return `${String(point[0])},${String(point[1])}`;
}

/**
 * How two consecutive edges meet: convex where the outline turns toward its inside, reflex where
 * it turns away, and straight where it hardly turns, unless they meet at a crossing of contours.
 *
 * @param from - The edge ending at the join.
 * @param to - The edge starting there.
 * @returns +1 convex, −1 reflex, 0 straight.
 */
function joinOf(from: GlyphEdge, to: GlyphEdge): number {
  if (from === to) return 0;
  const a = unit(tangentOf(from, 'end'));
  const b = unit(tangentOf(to, 'start'));
  const sine = a[0] * b[1] - a[1] * b[0];
  // Where contours cross, the boundary turns however shallowly they meet: beyond the crossing
  // each edge's own line runs on inside the other contour.
  const isCrossing = from.isEndAtCrossing === true;
  if (sine === 0 || (!isCrossing && Math.abs(sine) < STRAIGHT_SINE)) return 0;
  const isLeftTurn = sine > 0;
  return isLeftTurn === (from.inside === 1) ? 1 : -1;
}

/**
 * An edge's outward unit normal at one of its ends.
 *
 * @param edge - The edge.
 * @param at - Which end.
 * @returns The normal, pointing away from the glyph's inside.
 */
function outwardNormal(edge: GlyphEdge, at: 'start' | 'end'): Point {
  const [x, y] = unit(tangentOf(edge, at));
  // The left normal is (−y, x); the inside is to the left when `inside` is +1.
  return edge.inside === 1 ? [y, -x] : [-y, x];
}

/**
 * An edge's direction at one of its ends.
 *
 * @param edge - The edge.
 * @param at - Which end.
 * @returns The direction, not normalised.
 */
function tangentOf(edge: GlyphEdge, at: 'start' | 'end'): Point {
  if (edge.kind === 'line') return [edge.to[0] - edge.from[0], edge.to[1] - edge.from[1]];
  const { start, control, end } = edge;
  const [from, to] =
    at === 'start'
      ? [start, isSame(start, control) ? end : control]
      : [isSame(control, end) ? start : control, end];
  return [to[0] - from[0], to[1] - from[1]];
}

function unit([x, y]: Point): Point {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
}

function startOf(edge: GlyphEdge): Point {
  return edge.kind === 'line' ? edge.from : edge.start;
}

function endOf(edge: GlyphEdge): Point {
  return edge.kind === 'line' ? edge.to : edge.end;
}

function isSame(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Whether a quadratic's inside is on its chord's side: away from its control point. Mirroring
 * the plane flips both sides alike, so the answer survives the box frame's flipped y.
 *
 * @param edge - The quadratic.
 * @returns +1 on the chord's side, −1 on the control point's.
 */
function quadraticSide(edge: Extract<GlyphEdge, { kind: 'quadratic' }>): 1 | -1 {
  const { start, control, end, inside } = edge;
  const cross =
    (end[0] - start[0]) * (control[1] - start[1]) - (end[1] - start[1]) * (control[0] - start[0]);
  const isControlLeft = cross > 0;
  const isInsideLeft = inside === 1;
  return isControlLeft === isInsideLeft ? -1 : 1;
}

function midpoint(a: readonly [number, number], b: readonly [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
