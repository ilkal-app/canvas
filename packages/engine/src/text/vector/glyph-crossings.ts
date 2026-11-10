// Where a glyph's outline pieces cross: the vector tier keeps only the outline's
// boundary under non-zero winding, so pieces are split where they cross one another, and the
// parts inside the filled area are then left out (`glyphEdges`). The pieces' shared geometry
// lives here too. Pure: no DOM, no GPU.

/** A point, `[x, y]`. */
export type Point = readonly [x: number, y: number];
/** A quadratic's start, control point and end. */
export type Quadratic = readonly [start: Point, control: Point, end: Point];
/** A line's ends, or a quadratic's points. */
export type Shape = readonly [Point, Point] | Quadratic;

/** How near a crossing may lie to a piece's end and still split it, in its parameter. */
const SPLIT_EPSILON = 1e-9;
/** How flat a piece must be before a crossing with it is solved as a line's, em. */
const FLAT_EM = 1e-10;
/** The most halvings while looking for one crossing. */
export const MAX_CROSSING_DEPTH = 48;

/**
 * The pieces split at every crossing between two of them, and wherever one's end lies on
 * another's middle: each crossing is found by halving both pieces while their boxes overlap,
 * until both are flat enough to be met as lines. Both sides of a split take the same point, the
 * first piece's own at the crossing, so the outline stays joined end to end.
 *
 * @param pieces - The outline's lines and quadratics, in order.
 * @returns The pieces after splitting, in order, and the points they were split at (as
 *   {@link pointKey}s): where the boundary may turn from one contour onto another.
 */
export function splitAtCrossings(pieces: readonly Shape[]): {
  readonly pieces: Shape[];
  readonly crossings: ReadonlySet<string>;
} {
  const points = new Set<string>();
  const boxes = pieces.map(boxOf);
  const splits: { t: number; point: Point }[][] = pieces.map(() => []);
  for (let i = 0; i < pieces.length; i += 1) {
    for (let j = i + 1; j < pieces.length; j += 1) {
      const [a, b, boxA, boxB] = [pieces[i], pieces[j], boxes[i], boxes[j]];
      if (a === undefined || b === undefined || boxA === undefined || boxB === undefined) continue;
      if (!boxesMeet(boxA, boxB)) continue;
      for (const [ta, tb] of crossings(a, b)) {
        const point = shapeAt(a, ta);
        const isInsideA = ta > SPLIT_EPSILON && ta < 1 - SPLIT_EPSILON;
        const isInsideB = tb > SPLIT_EPSILON && tb < 1 - SPLIT_EPSILON;
        // Ends that meet (consecutive pieces, contours touching at a point) split nothing.
        const shared = isInsideA && isInsideB ? point : isInsideA ? endNear(b, tb) : endNear(a, ta);
        if (isInsideA) splits[i]?.push({ t: ta, point: shared });
        if (isInsideB) splits[j]?.push({ t: tb, point: shared });
        if (isInsideA || isInsideB) points.add(pointKey(shared));
      }
    }
  }
  return {
    pieces: pieces.flatMap((piece, index) => splitShape(piece, splits[index] ?? [])),
    crossings: points,
  };
}

/**
 * A point as a key: its coordinates exactly.
 *
 * @param point - The point.
 * @returns The key.
 */
export function pointKey(point: Point): string {
  return `${String(point[0])},${String(point[1])}`;
}

/**
 * The end of a piece its parameter is at, when a crossing falls on it.
 *
 * @param shape - The piece.
 * @param t - A parameter at 0 or 1 within the split tolerance.
 * @returns That end.
 */
function endNear(shape: Shape, t: number): Point {
  return t < 0.5 ? shape[0] : shape.length === 2 ? shape[1] : shape[2];
}

/**
 * A piece split at parameters, each piece of it ending at the given point.
 *
 * @param shape - The piece.
 * @param splits - Where to split it, and the point each split takes.
 * @returns The parts, in order.
 */
function splitShape(shape: Shape, splits: readonly { t: number; point: Point }[]): Shape[] {
  if (splits.length === 0) return [shape];
  const sorted = [...splits].sort((p, q) => p.t - q.t);
  const parts: Shape[] = [];
  let rest = shape;
  let done = 0;
  for (const { t, point } of sorted) {
    if (t - done <= SPLIT_EPSILON) continue;
    const local = (t - done) / (1 - done);
    const [head, tail] = halvesAt(rest, local);
    parts.push(withEnd(head, point));
    rest = withStart(tail, point);
    done = t;
  }
  parts.push(rest);
  return parts;
}

/**
 * A piece split at a parameter (de Casteljau for a quadratic).
 *
 * @param shape - The piece.
 * @param t - The parameter, 0 to 1.
 * @returns The part before and the part after.
 */
export function halvesAt(shape: Shape, t: number): [Shape, Shape] {
  if (shape.length === 2) {
    const point = shapeAt(shape, t);
    return [
      [shape[0], point],
      [point, shape[1]],
    ];
  }
  const [start, control, end] = shape;
  const left = lerp(start, control, t);
  const right = lerp(control, end, t);
  const middle = lerp(left, right, t);
  return [
    [start, left, middle],
    [middle, right, end],
  ];
}

function withEnd(shape: Shape, point: Point): Shape {
  return shape.length === 2 ? [shape[0], point] : [shape[0], shape[1], point];
}

function withStart(shape: Shape, point: Point): Shape {
  return shape.length === 2 ? [point, shape[1]] : [point, shape[1], shape[2]];
}

/** An axis-aligned box: min x, min y, max x, max y. */
export type Box = readonly [number, number, number, number];

/**
 * A piece's box: its points' (a quadratic lies within its points' hull).
 *
 * @param shape - The piece.
 * @returns The box.
 */
export function boxOf(shape: Shape): Box {
  const xs = shape.map(([x]) => x);
  const ys = shape.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Whether two boxes overlap, edges included.
 *
 * @param a - One box.
 * @param b - The other.
 * @returns True when they meet.
 */
export function boxesMeet(a: Box, b: Box): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/**
 * Where two pieces cross: by halving whichever is larger while their boxes overlap, until both are
 * flat enough to be met as their chords. Crossings found twice (at a halving's seam) are merged.
 *
 * @param a - One piece.
 * @param b - The other.
 * @returns The crossings' parameters on each, `[ta, tb]`.
 */
function crossings(a: Shape, b: Shape): [number, number][] {
  const found: [number, number][] = [];
  const visit = (
    pa: Shape,
    a0: number,
    a1: number,
    pb: Shape,
    b0: number,
    b1: number,
    depth: number,
  ): void => {
    const [boxA, boxB] = [boxOf(pa), boxOf(pb)];
    if (!boxesMeet(boxA, boxB)) return;
    const isFlatA = pa.length === 2 || bulgeOf(pa) <= FLAT_EM;
    const isFlatB = pb.length === 2 || bulgeOf(pb) <= FLAT_EM;
    if ((isFlatA && isFlatB) || depth >= MAX_CROSSING_DEPTH) {
      const hit = chordsCross(pa, pb);
      if (hit === undefined) return;
      const [ta, tb] = [a0 + (a1 - a0) * hit[0], b0 + (b1 - b0) * hit[1]];
      if (!found.some(([x, y]) => Math.abs(x - ta) < 1e-7 && Math.abs(y - tb) < 1e-7))
        found.push([ta, tb]);
      return;
    }
    const sizeA = Math.max(boxA[2] - boxA[0], boxA[3] - boxA[1]);
    const sizeB = Math.max(boxB[2] - boxB[0], boxB[3] - boxB[1]);
    if (!isFlatA && (isFlatB || sizeA >= sizeB)) {
      const [head, tail] = halvesAt(pa, 0.5);
      const middle = (a0 + a1) / 2;
      visit(head, a0, middle, pb, b0, b1, depth + 1);
      visit(tail, middle, a1, pb, b0, b1, depth + 1);
    } else {
      const [head, tail] = halvesAt(pb, 0.5);
      const middle = (b0 + b1) / 2;
      visit(pa, a0, a1, head, b0, middle, depth + 1);
      visit(pa, a0, a1, tail, middle, b1, depth + 1);
    }
  };
  visit(a, 0, 1, b, 0, 1, 0);
  return found;
}

/**
 * Where two pieces' chords cross, ends included; parallel chords never cross.
 *
 * @param a - One piece.
 * @param b - The other.
 * @returns The parameters along each chord, or undefined.
 */
function chordsCross(a: Shape, b: Shape): readonly [number, number] | undefined {
  const [p, q] = [a[0], a.length === 2 ? a[1] : a[2]];
  const [r, s] = [b[0], b.length === 2 ? b[1] : b[2]];
  const d1: Point = [q[0] - p[0], q[1] - p[1]];
  const d2: Point = [s[0] - r[0], s[1] - r[1]];
  const denominator = d1[0] * d2[1] - d1[1] * d2[0];
  if (denominator === 0) return undefined;
  const w: Point = [r[0] - p[0], r[1] - p[1]];
  const ta = (w[0] * d2[1] - w[1] * d2[0]) / denominator;
  const tb = (w[0] * d1[1] - w[1] * d1[0]) / denominator;
  return ta >= 0 && ta <= 1 && tb >= 0 && tb <= 1 ? [ta, tb] : undefined;
}

/**
 * A point of a piece.
 *
 * @param shape - The piece.
 * @param t - The parameter, 0 to 1.
 * @returns The point.
 */
function shapeAt(shape: Shape, t: number): Point {
  return shape.length === 2 ? lerp(shape[0], shape[1], t) : quadraticAt(shape, t);
}

function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * How far a quadratic's control point lies from its chord (from its start, when its ends meet).
 *
 * @param quadratic - The quadratic.
 * @returns The distance, em.
 */
export function bulgeOf(quadratic: Quadratic): number {
  const [start, control, end] = quadratic;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  const cx = control[0] - start[0];
  const cy = control[1] - start[1];
  return length === 0 ? Math.hypot(cx, cy) : Math.abs(dx * cy - dy * cx) / length;
}

/**
 * A point of a quadratic.
 *
 * @param quadratic - The quadratic.
 * @param t - The parameter, 0 to 1.
 * @returns The point.
 */
export function quadraticAt(quadratic: Quadratic, t: number): Point {
  const [start, control, end] = quadratic;
  const s = 1 - t;
  return [
    s * s * start[0] + 2 * s * t * control[0] + t * t * end[0],
    s * s * start[1] + 2 * s * t * control[1] + t * t * end[1],
  ];
}

/**
 * The point halfway between two.
 *
 * @param a - One point.
 * @param b - The other.
 * @returns The midpoint.
 */
export function midpoint(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/**
 * Whether two points are the same.
 *
 * @param a - One point.
 * @param b - The other.
 * @returns True when both coordinates are equal.
 */
export function isSame(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
