// Whether a nonzero fill differs from the board's even-odd one. SVG's default fill rule
// is nonzero; a path object fills even-odd. They differ exactly where the winding number is 2 or
// more in magnitude: subpaths overlapping in the same direction, a self-crossing star. Every such
// region is bounded by edges, so sampling both sides of every edge, between the points where other
// edges cross it, finds one if any exists. Curves are flattened coarsely: this decides whether to
// report the difference, not how to draw it. Pure.
import type { Point } from '../fields/point.js';

import type { Subpath } from './svg-geometry.js';

/** Steps a cubic is flattened into. */
const CUBIC_STEPS = 8;
/** The most edges checked; above it the check gives up. */
const MAX_EDGES = 2_000;
/** The most sample points tested; above it the check gives up. */
const MAX_SAMPLES = 20_000;

/** An edge of a flattened outline. */
interface Edge {
  readonly from: Point;
  readonly to: Point;
}

/**
 * Flattens closed subpaths into edges: each a polygon closed back to its start.
 *
 * @param subpaths - The subpaths, each treated as closed.
 * @returns The edges.
 */
function flatten(subpaths: readonly Subpath[]): Edge[] {
  const edges: Edge[] = [];
  for (const subpath of subpaths) {
    let from = subpath.start;
    const add = (to: Point): void => {
      if (to.x !== from.x || to.y !== from.y) edges.push({ from, to });
      from = to;
    };
    for (const piece of subpath.pieces) {
      if (piece.kind === 'line') {
        add(piece.to);
        continue;
      }
      const p0 = from;
      for (let step = 1; step <= CUBIC_STEPS; step += 1) {
        const t = step / CUBIC_STEPS;
        const s = 1 - t;
        const blend = (a: number, b: number, c: number, d: number): number =>
          s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
        add({
          x: blend(p0.x, piece.c1.x, piece.c2.x, piece.to.x),
          y: blend(p0.y, piece.c1.y, piece.c2.y, piece.to.y),
        });
      }
    }
    add(subpath.start);
  }
  return edges;
}

/**
 * The winding number of the edges around a point (Sunday's crossing test with direction).
 *
 * @param edges - Closed polygons' edges.
 * @param point - The point.
 * @returns The winding number.
 */
function windingAt(edges: readonly Edge[], point: Point): number {
  let winding = 0;
  for (const { from, to } of edges) {
    const side = (to.x - from.x) * (point.y - from.y) - (point.x - from.x) * (to.y - from.y);
    if (from.y <= point.y) {
      if (to.y > point.y && side > 0) winding += 1;
    } else if (to.y <= point.y && side < 0) {
      winding -= 1;
    }
  }
  return winding;
}

/**
 * Where along `edge` another edge crosses it, as a parameter in (0, 1).
 *
 * @param edge - The edge.
 * @param other - Another edge.
 * @returns The parameter, or undefined when they do not cross inside both.
 */
function crossing(edge: Edge, other: Edge): number | undefined {
  const rx = edge.to.x - edge.from.x;
  const ry = edge.to.y - edge.from.y;
  const sx = other.to.x - other.from.x;
  const sy = other.to.y - other.from.y;
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return undefined;
  const qx = other.from.x - edge.from.x;
  const qy = other.from.y - edge.from.y;
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : undefined;
}

/**
 * Tells whether filling closed subpaths nonzero would differ from filling them even-odd: whether
 * some region has a winding number of magnitude 2 or more.
 *
 * @param subpaths - The subpaths, each treated as closed (as a fill closes them).
 * @param budget - The edge operations the check may spend, shared by every check of an import:
 *   edges² for the crossings, then edges per sample.
 * @param budget.remaining - What is left; spent as the check goes, never reset.
 * @returns True when the fills differ, false when they agree, undefined when the outline is too
 *   complex to check or the budget runs out.
 */
export function nonzeroDiffersFromEvenOdd(
  subpaths: readonly Subpath[],
  budget: { remaining: number } = { remaining: Infinity },
): boolean | undefined {
  const edges = flatten(subpaths);
  const crossingWork = edges.length * edges.length;
  if (edges.length > MAX_EDGES || crossingWork > budget.remaining) return undefined;
  budget.remaining -= crossingWork;
  const points = edges.flatMap(({ from, to }) => [from, to]);
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const offset = diagonal * 1e-5;
  let samples = 0;
  for (const edge of edges) {
    const cuts = [0, 1];
    for (const other of edges) {
      const t = other === edge ? undefined : crossing(edge, other);
      if (t !== undefined) cuts.push(t);
    }
    cuts.sort((p, q) => p - q);
    const dx = edge.to.x - edge.from.x;
    const dy = edge.to.y - edge.from.y;
    const length = Math.hypot(dx, dy);
    const nx = (-dy / length) * offset;
    const ny = (dx / length) * offset;
    let previous = 0;
    for (const cut of cuts.slice(1)) {
      const t = (previous + cut) / 2;
      previous = cut;
      const mid = { x: edge.from.x + t * dx, y: edge.from.y + t * dy };
      samples += 2;
      budget.remaining -= 2 * edges.length;
      if (samples > MAX_SAMPLES || budget.remaining < 0) return undefined;
      for (const sign of [1, -1]) {
        const sample = { x: mid.x + sign * nx, y: mid.y + sign * ny };
        if (Math.abs(windingAt(edges, sample)) >= 2) return true;
      }
    }
  }
  return false;
}
