// Quadratics halved where another edge runs through their hulls: the edge pass paints
// a quadratic's whole hull by that curve's distance, so no other edge of the boundary may cross
// it. Pure: no DOM, no GPU.
import {
  boxesMeet,
  boxOf,
  bulgeOf,
  halvesAt,
  isSame,
  MAX_CROSSING_DEPTH,
  type Box,
  type Point,
  type Quadratic,
  type Shape,
} from './glyph-crossings.js';

/** The thinnest a quadratic is halved to while another edge runs through its hull, em. */
const MIN_ISOLATED_BULGE_EM = 1 / 16384;

/**
 * Edges halved until no other edge runs through a quadratic's hull. The edge pass
 * paints a quadratic's whole hull, the chord-aligned box of its control triangle, by that curve's
 * distance alone; where another edge of the boundary crosses the box (a stem ending a bowl, the
 * far side of a thin stroke), pixels past that edge took the curve's coverage and showed as dark
 * wedges. A quadratic is halved while an edge that does not share one of its ends passes through
 * its box, down to {@link MIN_ISOLATED_BULGE_EM}; elsewhere nothing changes. The halves share
 * their middle point, so the boundary stays joined end to end.
 *
 * @param edges - The boundary's pieces and their inside sides, in order.
 * @returns The pieces after halving, in order.
 */
export function isolatedHulls<T extends { readonly shape: Shape }>(edges: readonly T[]): T[] {
  const boxes = edges.map(({ shape }) => boxOf(shape));
  const isolate = (edge: T, depth: number): T[] => {
    const { shape } = edge;
    if (shape.length === 2 || depth >= MAX_CROSSING_DEPTH) return [edge];
    if (bulgeOf(shape) <= MIN_ISOLATED_BULGE_EM) return [edge];
    // The hull's corners reach past the control triangle: its box, not the curve's, is the test.
    const own = hullBoxOf(shape);
    const isCrossed = edges.some((other, index) => {
      const box = boxes[index];
      if (other === edge || box === undefined || !boxesMeet(own, box)) return false;
      if (sharesAnEnd(shape, other.shape)) return false;
      return passesThroughHull(other.shape, shape);
    });
    if (!isCrossed) return [edge];
    const [head, tail] = halvesAt(shape, 0.5);
    return [
      ...isolate({ ...edge, shape: head }, depth + 1),
      ...isolate({ ...edge, shape: tail }, depth + 1),
    ];
  };
  return edges.flatMap((edge) => isolate(edge, 0));
}

/**
 * The axis-aligned box around a quadratic's hull: the chord-aligned box of its control triangle.
 *
 * @param quadratic - The quadratic.
 * @returns The box.
 */
function hullBoxOf(quadratic: Quadratic): Box {
  const [start, control, end] = quadratic;
  const chord: Point = [end[0] - start[0], end[1] - start[1]];
  const length = Math.hypot(chord[0], chord[1]);
  const along: Point = length > 0 ? [chord[0] / length, chord[1] / length] : [1, 0];
  const left: Point = [-along[1], along[0]];
  const [dx, dy] = [control[0] - start[0], control[1] - start[1]];
  const [cx, cy] = [dx * along[0] + dy * along[1], dx * left[0] + dy * left[1]];
  const corners = [
    [Math.min(0, cx), Math.min(0, cy)],
    [Math.max(length, cx), Math.min(0, cy)],
    [Math.max(length, cx), Math.max(0, cy)],
    [Math.min(0, cx), Math.max(0, cy)],
  ].map(([x = 0, y = 0]): Point => [
    start[0] + along[0] * x + left[0] * y,
    start[1] + along[1] * x + left[1] * y,
  ]);
  return [
    Math.min(...corners.map(([x]) => x)),
    Math.min(...corners.map(([, y]) => y)),
    Math.max(...corners.map(([x]) => x)),
    Math.max(...corners.map(([, y]) => y)),
  ];
}

/**
 * Whether two pieces share an end.
 *
 * @param a - One piece.
 * @param b - The other.
 * @returns True when an end of one is an end of the other.
 */
function sharesAnEnd(a: Shape, b: Shape): boolean {
  const endsA = [a[0], a.length === 2 ? a[1] : a[2]];
  const endsB = [b[0], b.length === 2 ? b[1] : b[2]];
  return endsA.some((p) => endsB.some((q) => isSame(p, q)));
}

/**
 * Whether a piece passes through a quadratic's hull: the chord-aligned box of its control
 * triangle, as the edge shader builds it (before its reach). The piece is halved until its box
 * in the hull's frame misses the hull, lies within it, or it is flat enough to be met as a line.
 *
 * @param piece - The piece.
 * @param quadratic - The quadratic.
 * @returns True when some of the piece lies within the hull.
 */
function passesThroughHull(piece: Shape, quadratic: Quadratic): boolean {
  const [start, control, end] = quadratic;
  const chord: Point = [end[0] - start[0], end[1] - start[1]];
  const length = Math.hypot(chord[0], chord[1]);
  const along: Point = length > 0 ? [chord[0] / length, chord[1] / length] : [1, 0];
  const frame = (p: Point): Point => {
    const [dx, dy] = [p[0] - start[0], p[1] - start[1]];
    return [dx * along[0] + dy * along[1], -dx * along[1] + dy * along[0]];
  };
  const [cx, cy] = frame(control);
  const hull: Box = [Math.min(0, cx), Math.min(0, cy), Math.max(length, cx), Math.max(0, cy)];
  const visit = (shape: Shape, depth: number): boolean => {
    const box = boxOf(shape.map(frame) as unknown as Shape);
    if (!boxesMeet(box, hull)) return false;
    const isWithin =
      box[0] >= hull[0] && box[2] <= hull[2] && box[1] >= hull[1] && box[3] <= hull[3];
    if (isWithin) return true;
    if (shape.length === 2 || depth >= MAX_CROSSING_DEPTH) {
      const [a, b] = [frame(shape[0]), frame(shape.length === 2 ? shape[1] : shape[2])];
      return segmentMeetsBox(a, b, hull);
    }
    const [head, tail] = halvesAt(shape, 0.5);
    return visit(head, depth + 1) || visit(tail, depth + 1);
  };
  return visit(piece, 0);
}

/**
 * Whether a segment meets a box (Liang–Barsky clipping).
 *
 * @param a - One end.
 * @param b - The other.
 * @param box - The box.
 * @returns True when some of the segment lies within the box.
 */
function segmentMeetsBox(a: Point, b: Point, box: Box): boolean {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  let [from, to] = [0, 1];
  const edges: [number, number][] = [
    [-dx, a[0] - box[0]],
    [dx, box[2] - a[0]],
    [-dy, a[1] - box[1]],
    [dy, box[3] - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) from = Math.max(from, r);
    else to = Math.min(to, r);
    if (from > to) return false;
  }
  return true;
}
