// A glyph's outline edges, each with the side its inside is on: the vector tier draws a
// strip along every edge whose coverage comes from the signed distance to it, so it must know
// which way is in. That is read from the outline itself, the non-zero winding just off each
// edge's middle, never from a font's contour-direction convention. Pure: no DOM, no GPU.
import type { GlyphOutline, OutlineSegment } from '@canvas/text';

import {
  bulgeOf,
  isSame,
  midpoint,
  pointKey,
  quadraticAt,
  splitAtCrossings,
  type Point,
  type Quadratic,
  type Shape,
} from './glyph-crossings.js';
import { cubicToQuadratics, DEFAULT_CUBIC_TOLERANCE_EM } from './glyph-geometry.js';
import { isolatedHulls } from './glyph-hull-isolation.js';

/** One edge of a glyph's outline, in em with y up. */
export type GlyphEdge =
  | {
      /** A straight edge. */
      readonly kind: 'line';
      /** Where it starts, `[x, y]`. */
      readonly from: readonly [x: number, y: number];
      /** Where it ends, `[x, y]`. */
      readonly to: readonly [x: number, y: number];
      /** +1 when the glyph's inside is to the left of the direction of travel, else −1. */
      readonly inside: 1 | -1;
      /** True when it starts where the outline was split at a crossing of its pieces. */
      readonly isStartAtCrossing?: boolean;
      /** True when it ends at such a crossing. */
      readonly isEndAtCrossing?: boolean;
    }
  | {
      /** A quadratic curve. */
      readonly kind: 'quadratic';
      /** Where it starts, `[x, y]`. */
      readonly start: readonly [x: number, y: number];
      /** Its control point, `[x, y]`. */
      readonly control: readonly [x: number, y: number];
      /** Where it ends, `[x, y]`. */
      readonly end: readonly [x: number, y: number];
      /** +1 when the glyph's inside is to the left of the direction of travel, else −1. */
      readonly inside: 1 | -1;
      /** True when it starts where the outline was split at a crossing of its pieces. */
      readonly isStartAtCrossing?: boolean;
      /** True when it ends at such a crossing. */
      readonly isEndAtCrossing?: boolean;
    };

/** Options of {@link glyphEdges}. */
export interface GlyphEdgeOptions {
  /** How far a cubic's quadratics may stray from it, em; `DEFAULT_CUBIC_TOLERANCE_EM` if absent. */
  readonly toleranceEm?: number;
  /** How far a quadratic's control point may lie from its chord, em; 1/64 if absent. */
  readonly maxBulgeEm?: number;
}

/** The default {@link GlyphEdgeOptions.maxBulgeEm}: hulls stay thin around their curves. */
const DEFAULT_MAX_BULGE_EM = 1 / 64;
/** The most halvings of one quadratic. */
const MAX_SPLIT_DEPTH = 10;
/** How far off an edge's middle its sides are sampled, em. */
const SIDE_OFFSET_EM = 1 / 8192;

/**
 * A glyph's outline edges, each with the side its inside is on: lines as they are, cubics as
 * quadratics (`cubicToQuadratics`), and every quadratic halved until its control point lies
 * within `maxBulgeEm` of its chord, so a hull around it stays thin. Only the outline's boundary
 * under non-zero winding is kept: pieces are split where they cross one another (or where one's
 * end lies on another), and a piece with the inside on both of its sides, or on neither, is left
 * out. A font that draws a glyph from overlapping contours (Roboto's g, p and q: the bowl and the
 * stem) has edges inside its filled area, and a hull along one would cover it with the coverage
 * of an edge that is not there. A quadratic another edge runs through the hull of is
 * halved until none does (`isolatedHulls`). Zero-length edges are left out.
 *
 * @param outline - The glyph's outline, em with y up.
 * @param options - The cubic tolerance and the most bulge.
 * @returns The edges, contour by contour, in order; where pieces were split at a crossing, both
 *   sides of the split share the same point, so the boundary runs on from one contour to the next.
 */
export function glyphEdges(outline: GlyphOutline, options: GlyphEdgeOptions = {}): GlyphEdge[] {
  const tolerance = options.toleranceEm ?? DEFAULT_CUBIC_TOLERANCE_EM;
  const maxBulge = options.maxBulgeEm ?? DEFAULT_MAX_BULGE_EM;
  const index = new WindingIndex(windingPieces(outline, tolerance));
  const pieces = outline.contours
    .flatMap((contour) => contour.flatMap((segment) => piecesOf(segment, tolerance, maxBulge)))
    .map((shape) => (shape.length === 3 ? straightened(shape) : shape))
    .filter((shape) => !isPoint(shape));
  // Each piece's sides are sampled where it is: a contour that crosses itself or another changes
  // sides along its length, and a piece inside another contour has the
  // inside on both sides.
  const split = splitAtCrossings(pieces);
  const boundary = split.pieces.flatMap((shape) => {
    if (isPoint(shape)) return [];
    const inside = boundarySideOf(index, shape);
    return inside === undefined ? [] : [{ shape, inside }];
  });
  return isolatedHulls(boundary).map(({ shape, inside }): GlyphEdge => {
    const end = shape.length === 2 ? shape[1] : shape[2];
    // Where the boundary turns from one contour onto another, the turn is a corner however
    // shallow it is (glyph-edge-mesh: `joinOf`).
    const crossings = {
      ...(split.crossings.has(pointKey(shape[0])) ? { isStartAtCrossing: true } : {}),
      ...(split.crossings.has(pointKey(end)) ? { isEndAtCrossing: true } : {}),
    };
    if (shape.length === 2) return { kind: 'line', from: shape[0], to: end, inside, ...crossings };
    return { kind: 'quadratic', start: shape[0], control: shape[1], end, inside, ...crossings };
  });
}

/**
 * Whether a piece is a point: a line or a quadratic whose points all meet.
 *
 * @param shape - The piece.
 * @returns True when it has no length.
 */
function isPoint(shape: Shape): boolean {
  return shape.length === 2
    ? isSame(shape[0], shape[1])
    : isSame(shape[0], shape[2]) && isSame(shape[0], shape[1]);
}

/** Bands of the outline's height: a ray toward +x meets only the pieces of its band. */
const WINDING_BANDS = 64;

/**
 * An outline's pieces by horizontal band: a point's winding counts only the pieces
 * whose height spans its band, so each of a glyph's edges costs about O(edges / bands).
 */
class WindingIndex {
  private readonly bands: WindingPiece[][];
  private readonly minY: number;
  private readonly bandHeight: number;

  /**
   * Bands the pieces.
   *
   * @param pieces - The outline as lines and quadratics.
   */
  constructor(pieces: readonly WindingPiece[]) {
    let [minY, maxY] = [Infinity, -Infinity];
    for (const piece of pieces)
      for (const [, y] of piece) [minY, maxY] = [Math.min(minY, y), Math.max(maxY, y)];
    this.minY = Number.isFinite(minY) ? minY : 0;
    this.bandHeight = Math.max((maxY - minY) / WINDING_BANDS, Number.MIN_VALUE);
    this.bands = Array.from({ length: WINDING_BANDS }, () => []);
    for (const piece of pieces) {
      // A quadratic lies within its points' hull, so their heights bound it.
      const ys = piece.map(([, y]) => y);
      const [first, last] = [this.bandOf(Math.min(...ys)), this.bandOf(Math.max(...ys))];
      for (let band = first; band <= last; band += 1) this.bands[band]?.push(piece);
    }
  }

  /**
   * The non-zero winding number around a point.
   *
   * @param point - The point.
   * @returns The winding number.
   */
  windingAt(point: Point): number {
    return windingAt(this.bands[this.bandOf(point[1])] ?? [], point);
  }

  private bandOf(y: number): number {
    return Math.min(WINDING_BANDS - 1, Math.max(0, Math.floor((y - this.minY) / this.bandHeight)));
  }
}

/**
 * Which side of a piece the outline's inside is on, from the windings just off its middle on
 * both sides; none when both are inside (the piece lies within the filled area) or both outside.
 *
 * @param index - The outline's banded pieces, for counting windings.
 * @param shape - The piece.
 * @returns +1 when the inside is to the left of its direction, −1 to the right, or undefined.
 */
function boundarySideOf(index: WindingIndex, shape: Shape): 1 | -1 | undefined {
  if (shape.length === 2) {
    const [from, to] = shape;
    return sideOf(index, midpoint(from, to), [to[0] - from[0], to[1] - from[1]]);
  }
  const [start, control, end] = shape;
  const direction: Point = isSame(start, end)
    ? [control[0] - start[0], control[1] - start[1]]
    : [end[0] - start[0], end[1] - start[1]];
  return sideOf(index, quadraticAt(shape, 0.5), direction);
}

/**
 * One outline segment as lines and thin quadratics.
 *
 * @param segment - The segment.
 * @param tolerance - The cubic tolerance, em.
 * @param maxBulge - The most a quadratic's control point may lie from its chord, em.
 * @returns Its pieces: two points for a line, three for a quadratic.
 */
function piecesOf(segment: OutlineSegment, tolerance: number, maxBulge: number): Shape[] {
  if (segment.kind === 'line')
    return [
      [
        [segment.x0, segment.y0],
        [segment.x1, segment.y1],
      ],
    ];
  const quadratics: Quadratic[] =
    segment.kind === 'quadratic'
      ? [
          [
            [segment.x0, segment.y0],
            [segment.cx, segment.cy],
            [segment.x1, segment.y1],
          ],
        ]
      : cubicToQuadratics(segment, tolerance);
  return quadratics.flatMap((quadratic) => thinned(quadratic, maxBulge, 0));
}

/**
 * How far a quadratic's control point may lie from its chord, as a share of the chord, and still
 * be drawn as its chord: within it the curve strays from the chord by at most half of that, 0.05%
 * of its length. The edge shader's Loop–Blinn distance `f / |∇f|` comes from a control triangle
 * that thin as a ratio of near-equal small numbers, and a pixel past the curve read 0.18 where it
 * is wholly inside (EB Garamond's g).
 */
const STRAIGHT_BULGE = 1e-3;

/**
 * A quadratic as a line when it is all but straight ({@link STRAIGHT_BULGE}); a quadratic whose
 * ends meet stays one.
 *
 * @param quadratic - The quadratic.
 * @returns The line, or the quadratic.
 */
function straightened(quadratic: Quadratic): Shape {
  const [start, , end] = quadratic;
  const chord = Math.hypot(end[0] - start[0], end[1] - start[1]);
  return chord > 0 && bulgeOf(quadratic) <= STRAIGHT_BULGE * chord ? [start, end] : quadratic;
}

/**
 * A quadratic halved (de Casteljau) until each piece's control point lies within a distance of
 * its chord.
 *
 * @param quadratic - The quadratic.
 * @param maxBulge - The most distance, em.
 * @param depth - Halvings so far.
 * @returns The pieces, in order.
 */
function thinned(quadratic: Quadratic, maxBulge: number, depth: number): Quadratic[] {
  if (depth >= MAX_SPLIT_DEPTH || bulgeOf(quadratic) <= maxBulge) return [quadratic];
  const [start, control, end] = quadratic;
  const left = midpoint(start, control);
  const right = midpoint(control, end);
  const middle = midpoint(left, right);
  return [
    ...thinned([start, left, middle], maxBulge, depth + 1),
    ...thinned([middle, right, end], maxBulge, depth + 1),
  ];
}

/**
 * Which side of an edge its inside is on: which of the points just to its left and right has a
 * non-zero winding.
 *
 * @param index - The outline's banded pieces, for counting windings.
 * @param middle - A point on the edge.
 * @param direction - The edge's direction there.
 * @returns +1 when only the left is inside, −1 when only the right is, else undefined.
 */
function sideOf(index: WindingIndex, middle: Point, direction: Point): 1 | -1 | undefined {
  const length = Math.hypot(direction[0], direction[1]) || 1;
  const nx = (-direction[1] / length) * SIDE_OFFSET_EM;
  const ny = (direction[0] / length) * SIDE_OFFSET_EM;
  const isLeftInside = index.windingAt([middle[0] + nx, middle[1] + ny]) !== 0;
  const isRightInside = index.windingAt([middle[0] - nx, middle[1] - ny]) !== 0;
  if (isLeftInside === isRightInside) return undefined;
  return isLeftInside ? 1 : -1;
}

/** A piece of an outline the winding is counted over: a line's ends, or a quadratic's points. */
type WindingPiece = readonly [Point, Point] | Quadratic;

/**
 * The outline as lines and quadratics (cubics converted), for counting windings exactly.
 *
 * @param outline - The outline.
 * @param tolerance - The cubic tolerance, em.
 * @returns The pieces.
 */
function windingPieces(outline: GlyphOutline, tolerance: number): WindingPiece[] {
  const pieces: WindingPiece[] = [];
  for (const contour of outline.contours)
    for (const segment of contour) pieces.push(...piecesOf(segment, tolerance, Infinity));
  return pieces;
}

/**
 * The non-zero winding number of the outline around a point: the signed crossings of a ray
 * toward +x, solved exactly for each quadratic (no flattening, so a point a hair off an
 * edge is counted on the right side, and a glyph costs O(edges) per point).
 *
 * @param pieces - The outline as lines and quadratics.
 * @param point - The point.
 * @returns The winding number.
 */
function windingAt(pieces: readonly WindingPiece[], point: Point): number {
  let winding = 0;
  for (const piece of pieces) {
    winding += piece.length === 2 ? lineCrossing(piece, point) : quadraticCrossings(piece, point);
  }
  return winding;
}

/**
 * A line's signed crossing of the ray from a point toward +x: +1 going up, −1 going down, 0 for
 * none (half-open in y, so a shared end counts once).
 *
 * @param line - The line's ends.
 * @param point - The point.
 * @returns The crossing.
 */
function lineCrossing(line: readonly [Point, Point], point: Point): number {
  const [a, b] = line;
  const cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
  if (a[1] <= point[1] && point[1] < b[1] && cross > 0) return 1;
  if (b[1] <= point[1] && point[1] < a[1] && cross < 0) return -1;
  return 0;
}

/**
 * A quadratic's signed crossings of the ray from a point toward +x. The curve is split where
 * dy/dt is zero into spans monotonic in y, and each span is counted as {@link lineCrossing}
 * counts a line, half-open in y on its end values, so the decision never rests on a root's
 * rounding; the root only places the crossing in x.
 *
 * @param quadratic - The quadratic.
 * @param point - The point.
 * @returns The sum of the crossings.
 */
function quadraticCrossings(quadratic: Quadratic, point: Point): number {
  const [start, control, end] = quadratic;
  const a = start[1] - 2 * control[1] + end[1];
  const b = 2 * (control[1] - start[1]);
  const turn = a === 0 ? -1 : -b / (2 * a);
  const spans: (readonly [number, number])[] =
    turn > 0 && turn < 1
      ? [
          [0, turn],
          [turn, 1],
        ]
      : [[0, 1]];
  let winding = 0;
  for (const [from, to] of spans) {
    const fromY = from === 0 ? start[1] : quadraticAt(quadratic, from)[1];
    const toY = to === 1 ? end[1] : quadraticAt(quadratic, to)[1];
    const isUp = fromY <= point[1] && point[1] < toY;
    const isDown = toY <= point[1] && point[1] < fromY;
    if (!isUp && !isDown) continue;
    const t = spanRoot(a, b, start[1] - point[1], from, to);
    if (quadraticAt(quadratic, t)[0] > point[0]) winding += isUp ? 1 : -1;
  }
  return winding;
}

/**
 * The root of a·t² + b·t + c in a span where the quadratic is monotonic and changes sign: of
 * the stable form's two roots the one nearest the span, clamped into it.
 *
 * @param a - The t² coefficient.
 * @param b - The t coefficient.
 * @param c - The constant.
 * @param from - The span's start.
 * @param to - The span's end.
 * @returns The root.
 */
function spanRoot(a: number, b: number, c: number, from: number, to: number): number {
  const discriminant = Math.max(0, b * b - 4 * a * c);
  // The stable form: no cancellation when the curve is nearly straight (a small, b large).
  const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
  const roots = [a === 0 ? Number.NaN : q / a, q === 0 ? Number.NaN : c / q];
  const middle = (from + to) / 2;
  let best = middle;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const root of roots) {
    if (Number.isNaN(root)) continue;
    const distance = Math.abs(Math.min(to, Math.max(from, root)) - root);
    if (distance < bestDistance) {
      best = Math.min(to, Math.max(from, root));
      bestDistance = distance;
    }
  }
  return best;
}
