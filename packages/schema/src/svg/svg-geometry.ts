// The geometry an SVG import works in: affine matrices in SVG's `matrix(a b c d e f)`
// order (`AffineMap`), and outlines as subpaths of lines and cubics, which every SVG shape and
// path command becomes. A cubic stays exact under an affine map: its control points are mapped.
// Pure.
import type { Point } from '../fields/point.js';
import { mapPoint, type AffineMap } from '../geometry/affine-map.js';

/** The identity map. */
export const IDENTITY: AffineMap = { a: 1, b: 0, c: 0, d: 1, x: 0, y: 0 };

/** A piece of a subpath, from the end of the previous one (or the subpath's start). */
export type OutlinePiece =
  | {
      /** A straight line. */
      readonly kind: 'line';
      /** Where it ends. */
      readonly to: Point;
    }
  | {
      /** A cubic Bézier curve. */
      readonly kind: 'cubic';
      /** Its first control point. */
      readonly c1: Point;
      /** Its second control point. */
      readonly c2: Point;
      /** Where it ends. */
      readonly to: Point;
    };

/** A subpath: a start point and the pieces drawn from it, closed back to it or open. */
export interface Subpath {
  /** Where the subpath starts. */
  readonly start: Point;
  /** The pieces, in order. */
  readonly pieces: readonly OutlinePiece[];
  /** Whether the subpath was closed (`Z`, or a closed shape). */
  readonly isClosed: boolean;
}

/**
 * The map that applies `inner` first, then `outer`.
 *
 * @param outer - The map applied second.
 * @param inner - The map applied first.
 * @returns `outer ∘ inner`.
 */
export function composeMaps(outer: AffineMap, inner: AffineMap): AffineMap {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    x: outer.a * inner.x + outer.c * inner.y + outer.x,
    y: outer.b * inner.x + outer.d * inner.y + outer.y,
  };
}

/**
 * The inverse of a map.
 *
 * @param map - The map.
 * @returns Its inverse, or undefined when it is singular.
 */
export function invertMap(map: AffineMap): AffineMap | undefined {
  const det = map.a * map.d - map.b * map.c;
  if (det === 0 || !Number.isFinite(det)) return undefined;
  const a = map.d / det;
  const b = -map.b / det;
  const c = -map.c / det;
  const d = map.a / det;
  return { a, b, c, d, x: -(a * map.x + c * map.y), y: -(b * map.x + d * map.y) };
}

/**
 * Maps a subpath through an affine map, exactly: lines stay lines, cubics map their control points.
 *
 * @param subpath - The subpath; not mutated.
 * @param map - The map.
 * @returns The mapped subpath.
 */
export function mapSubpath(subpath: Subpath, map: AffineMap): Subpath {
  return {
    start: mapPoint(map, subpath.start),
    isClosed: subpath.isClosed,
    pieces: subpath.pieces.map((piece) =>
      piece.kind === 'line'
        ? { kind: 'line', to: mapPoint(map, piece.to) }
        : {
            kind: 'cubic',
            c1: mapPoint(map, piece.c1),
            c2: mapPoint(map, piece.c2),
            to: mapPoint(map, piece.to),
          },
    ),
  };
}
