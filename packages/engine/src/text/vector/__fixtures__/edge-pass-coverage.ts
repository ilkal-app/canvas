// glyph-edge.wgsl's per-pixel coverage on the CPU: a straight edge's exact box-filter
// coverage, and a corner's, from the pixel square clipped by both edges' half-planes.

/** A point or vector, px. */
export type Vec = readonly [number, number];

const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1];
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * glyph-edge.wgsl's `boxCoverage`: a pixel's exact coverage by the far side of a straight edge.
 *
 * @param distance - The signed distance from the pixel's centre, px, positive outside.
 * @param normal - The edge's unit normal.
 * @returns The coverage, 0..1.
 */
export function boxCoverage(distance: number, normal: Vec): number {
  const a = Math.max(Math.abs(normal[0]), Math.abs(normal[1]));
  const b = Math.min(Math.abs(normal[0]), Math.abs(normal[1]));
  const inside = -distance;
  const half = 0.5 * (a + b);
  const middle = 0.5 * (a - b);
  const linear = 0.5 + inside / Math.max(a, 1e-6);
  const twoAb = Math.max(2 * a * b, 1e-6);
  const upper = 1 - ((half - inside) * (half - inside)) / twoAb;
  const lower = ((half + inside) * (half + inside)) / twoAb;
  const tail = inside > 0 ? upper : lower;
  const curved = Math.abs(inside) <= middle ? linear : tail;
  const profile = b < 1e-4 ? clamp01(0.5 + inside) : curved;
  return clamp01(Math.abs(inside) >= half ? (inside > 0 ? 1 : 0) : profile);
}

/**
 * A convex polygon clipped by a half-plane, as glyph-edge.wgsl's `clipped`: what lies where
 * `distance + p · normal` is not positive.
 *
 * @param polygon - The polygon, about the pixel's centre.
 * @param normal - The half-plane's outward unit normal.
 * @param distance - Its edge's distance from the pixel's centre, positive outside.
 * @returns The clipped polygon.
 */
function clipped(polygon: readonly Vec[], normal: Vec, distance: number): Vec[] {
  const out: Vec[] = [];
  polygon.forEach((p, index) => {
    const q = polygon[(index + 1) % polygon.length] ?? p;
    const [dp, dq] = [distance + dot(p, normal), distance + dot(q, normal)];
    if (dp <= 0) out.push(p);
    if (dp <= 0 !== dq <= 0) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  });
  return out;
}

/**
 * A polygon's area (the shoelace formula).
 *
 * @param polygon - The polygon.
 * @returns Its area.
 */
function areaOf(polygon: readonly Vec[]): number {
  let twice = 0;
  polygon.forEach((p, index) => {
    const q = polygon[(index + 1) % polygon.length] ?? p;
    twice += p[0] * q[1] - q[0] * p[1];
  });
  return Math.abs(twice / 2);
}

/** The pixel square about its centre. */
const SQUARE: readonly Vec[] = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

/**
 * glyph-edge.wgsl's `joined`: the pixel square clipped by both half-planes, their intersection at
 * a convex join and their union at a reflex one.
 *
 * @param own - This edge's coverage.
 * @param edge - Its outward normal and distance.
 * @param neighbour - The neighbour's.
 * @param join - +1 convex, −1 reflex, 0 straight.
 * @returns The corner's coverage.
 */
export function joined(
  own: number,
  edge: readonly [Vec, number],
  neighbour: readonly [Vec, number],
  join: number,
): number {
  if (Math.abs(join) < 0.5) return own;
  const neighbourShare = clipped(SQUARE, neighbour[0], neighbour[1]);
  const both = areaOf(clipped(neighbourShare, edge[0], edge[1]));
  return clamp01(join > 0.5 ? both : own + areaOf(neighbourShare) - both);
}
