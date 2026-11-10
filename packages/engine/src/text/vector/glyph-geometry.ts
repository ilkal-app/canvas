// Glyph geometry for the vector glyph tier: a glyph's outline as triangles a non-zero
// stencil fill counts (CURVE_STENCIL_SHADER). Each contour is a fan of the points its segments end
// on, which covers the polygon through them, plus one Loop–Blinn control triangle per quadratic,
// which adds (or, wound the other way, takes away) the region between the curve and its chord.
// Cubics are first split into quadratics within a tolerance in em. Pure: no DOM, no GPU.
import type { CubicSegment, GlyphOutline } from '@canvas/text';

import type { GlyphEdgeMesh } from './glyph-edge-mesh.js';

/** A box in em units, y up. */
export interface GlyphBounds {
  /** The left edge. */
  readonly minX: number;
  /** The bottom edge. */
  readonly minY: number;
  /** The right edge. */
  readonly maxX: number;
  /** The top edge. */
  readonly maxY: number;
}

/** Triangles of a glyph, in em units with y up, as its outline. */
export interface GlyphGeometry {
  /** Four floats per vertex, three vertices per triangle: x, y, then the curve's u, v. */
  readonly vertices: Float32Array;
  /** How many vertices: a multiple of 3. */
  readonly vertexCount: number;
  /** The vertices' bounds, in em; `undefined` for an empty outline. */
  readonly bounds: GlyphBounds | undefined;
  /**
   * The edge hulls the vector tier antialiases with (`glyphEdgeMesh`); absent, the
   * glyph's edges keep the canvas's multisampling only.
   */
  readonly edges?: GlyphEdgeMesh;
}

/**
 * How far a cubic's quadratics may stray from it by default (1/4096 em): at the 64× zoom cap a
 * 64 px em is 4,096 device px, so a quarter of a pixel even then for text at 256 px.
 */
export const DEFAULT_CUBIC_TOLERANCE_EM = 1 / 4096;

/** The most quadratics one cubic becomes. */
const MAX_QUADRATICS_PER_CUBIC = 64;
/** Floats per vertex. */
const FLOATS_PER_VERTEX = 4;
/** The Loop–Blinn coordinates of a fan corner, which never discards. */
const FAN_UV = [0, 1] as const;

type Point = readonly [x: number, y: number];

/** A quadratic in em: its start, control point and end, each `[x, y]`. */
export type GlyphQuadratic = readonly [
  start: readonly [x: number, y: number],
  control: readonly [x: number, y: number],
  end: readonly [x: number, y: number],
];

/**
 * A cubic's point and tangent at a parameter.
 *
 * @param segment - The cubic.
 * @param t - The parameter, 0 to 1.
 * @returns The point, and the derivative there.
 */
function cubicAt(segment: CubicSegment, t: number): { point: Point; tangent: Point } {
  const s = 1 - t;
  const { x0, y0, c1x, c1y, c2x, c2y, x1, y1 } = segment;
  const point: Point = [
    s * s * s * x0 + 3 * s * s * t * c1x + 3 * s * t * t * c2x + t * t * t * x1,
    s * s * s * y0 + 3 * s * s * t * c1y + 3 * s * t * t * c2y + t * t * t * y1,
  ];
  const tangent: Point = [
    3 * (s * s * (c1x - x0) + 2 * s * t * (c2x - c1x) + t * t * (x1 - c2x)),
    3 * (s * s * (c1y - y0) + 2 * s * t * (c2y - c1y) + t * t * (y1 - c2y)),
  ];
  return { point, tangent };
}

/**
 * A cubic as consecutive quadratics within a tolerance: split into n equal pieces, each replaced
 * by the quadratic through its ends whose control point is (3(c1 + c2) − (p0 + p3)) / 4, which
 * strays at most √3/36 of the piece's third difference |p3 − 3c2 + 3c1 − p0|; that difference
 * shrinks with the cube of the piece, so n is the cube root of the whole cubic's error over the
 * tolerance.
 *
 * @param segment - The cubic.
 * @param toleranceEm - The most a quadratic may stray, in em.
 * @returns The quadratics, in order.
 */
export function cubicToQuadratics(segment: CubicSegment, toleranceEm: number): GlyphQuadratic[] {
  const { x0, y0, c1x, c1y, c2x, c2y, x1, y1 } = segment;
  const thirdDifference = Math.hypot(x1 - 3 * c2x + 3 * c1x - x0, y1 - 3 * c2y + 3 * c1y - y0);
  const error = (Math.sqrt(3) / 36) * thirdDifference;
  const pieces = Math.min(
    MAX_QUADRATICS_PER_CUBIC,
    Math.max(1, Math.ceil(Math.cbrt(error / Math.max(toleranceEm, Number.EPSILON)))),
  );
  const quadratics: GlyphQuadratic[] = [];
  for (let piece = 0; piece < pieces; piece += 1) {
    const [a, b] = [piece / pieces, (piece + 1) / pieces];
    const start = cubicAt(segment, a);
    const end = cubicAt(segment, b);
    const third = (b - a) / 3;
    // The piece as a cubic of its own: its ends, and controls a third of the way along each tangent.
    const q1: Point = [
      start.point[0] + third * start.tangent[0],
      start.point[1] + third * start.tangent[1],
    ];
    const q2: Point = [
      end.point[0] - third * end.tangent[0],
      end.point[1] - third * end.tangent[1],
    ];
    const control: Point = [
      (3 * (q1[0] + q2[0]) - (start.point[0] + end.point[0])) / 4,
      (3 * (q1[1] + q2[1]) - (start.point[1] + end.point[1])) / 4,
    ];
    quadratics.push([start.point, control, end.point]);
  }
  return quadratics;
}

/**
 * Tessellates a glyph's outline for a non-zero stencil fill: per contour, a fan from
 * its start through the end of every segment, each corner at u, v = (0, 1), and per quadratic its
 * control triangle at (0, 0), (½, 0), (1, 1); a cubic is first split into quadratics within the
 * tolerance (at most 64). Counted by orientation, front faces up and back faces down, with curve
 * triangles kept only where u² − v < 0, the triangles cover each point as many times as the
 * outline winds round it. The input is never changed.
 *
 * @param outline - The glyph's outline, in em, y up.
 * @param cubicToleranceEm - How far a cubic's quadratics may stray from it, in em.
 * @returns The triangles.
 */
export function tessellateGlyph(
  outline: GlyphOutline,
  cubicToleranceEm = DEFAULT_CUBIC_TOLERANCE_EM,
): GlyphGeometry {
  const floats: number[] = [];
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const corner = ([x, y]: Point, u: number, v: number): void => {
    floats.push(x, y, u, v);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const contour of outline.contours) {
    const first = contour[0];
    if (first === undefined) continue;
    const anchor: Point = [first.x0, first.y0];
    let last: Point = anchor;
    const fanTo = (end: Point): void => {
      corner(anchor, ...FAN_UV);
      corner(last, ...FAN_UV);
      corner(end, ...FAN_UV);
      last = end;
    };
    const curve = ([start, control, end]: GlyphQuadratic): void => {
      corner(start, 0, 0);
      corner(control, 0.5, 0);
      corner(end, 1, 1);
    };
    for (const segment of contour) {
      if (segment.kind === 'line') {
        fanTo([segment.x1, segment.y1]);
      } else if (segment.kind === 'quadratic') {
        const end: Point = [segment.x1, segment.y1];
        fanTo(end);
        curve([[segment.x0, segment.y0], [segment.cx, segment.cy], end]);
      } else {
        for (const quadratic of cubicToQuadratics(segment, cubicToleranceEm)) {
          fanTo(quadratic[2]);
          curve(quadratic);
        }
      }
    }
  }
  const vertices = Float32Array.from(floats);
  const vertexCount = vertices.length / FLOATS_PER_VERTEX;
  return {
    vertices,
    vertexCount,
    bounds: vertexCount === 0 ? undefined : { minX, minY, maxX, maxY },
  };
}

/**
 * Glyph geometry by the caller's key (face, variation coordinates and glyph), least
 * recently used first, within a byte budget; the entry just set is always kept.
 */
export class GlyphGeometryCache {
  private readonly entries = new Map<string, GlyphGeometry>();
  private retained = 0;

  /**
   * Starts empty.
   *
   * @param maxBytes - The most vertex bytes kept.
   */
  constructor(private readonly maxBytes: number) {}

  /**
   * The vertex bytes kept.
   *
   * @returns The bytes.
   */
  get bytes(): number {
    return this.retained;
  }

  /**
   * A kept geometry, now the most recently used.
   *
   * @param key - Its key.
   * @returns It, or `undefined`.
   */
  get(key: string): GlyphGeometry | undefined {
    const geometry = this.entries.get(key);
    if (geometry === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, geometry);
    return geometry;
  }

  /**
   * Keeps a geometry, dropping the least recently used others until the rest fit.
   *
   * @param key - Its key.
   * @param geometry - The geometry.
   */
  set(key: string, geometry: GlyphGeometry): void {
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.entries.delete(key);
      this.retained -= bytesOf(previous);
    }
    this.entries.set(key, geometry);
    this.retained += bytesOf(geometry);
    for (const [keptKey, kept] of this.entries) {
      if (this.retained <= this.maxBytes || keptKey === key) break;
      this.entries.delete(keptKey);
      this.retained -= bytesOf(kept);
    }
  }
}

/**
 * A geometry's vertex bytes, its edge hulls included.
 *
 * @param geometry - The geometry.
 * @returns The bytes.
 */
function bytesOf(geometry: GlyphGeometry): number {
  return geometry.vertices.byteLength + (geometry.edges?.vertices.byteLength ?? 0);
}
