import type { Point } from '@canvas/schema';

import type { DashInterval } from './stroke-dash.js';

/** A polyline with a flag per point: whether the stroke's join style applies there. */
export interface CorneredPolyline {
  /** The points, world units. */
  readonly points: readonly Point[];
  /**
   * Per point, whether it is a corner of the drawn shape (a path's vertex, a line's bend), where
   * the join style applies; elsewhere (inside a flattened curve) the join is round. Absent: every
   * point is a corner.
   */
  readonly corners?: readonly boolean[] | undefined;
}

/** A piece of a dashed polyline: its points and a corner flag per point. */
export interface CorneredPiece extends CorneredPolyline {
  /** Per point, whether the join style applies there; a piece's ends are never corners. */
  readonly corners: readonly boolean[];
}

/** One dash of a stroke: an open piece of the polyline, or a dot where a dash has no length. */
export type DashPiece =
  | {
      readonly kind: 'piece';
      /** The piece, with its corners. */
      readonly line: CorneredPiece;
      /** Whether it starts at the stroke's open start (which takes the stroke's start cap). */
      readonly isAtStart: boolean;
      /** Whether it ends at the stroke's open end (which takes the stroke's end cap). */
      readonly isAtEnd: boolean;
    }
  | {
      readonly kind: 'dot';
      /** Where the dash of length 0 lies. */
      readonly point: Point;
      /** The unit direction of the stroke there, which a square dot is turned along. */
      readonly direction: Point;
    };

/** A polyline measured along its length. */
interface Measured {
  /** The points, a closed polyline's first repeated at the end. */
  readonly ring: readonly Point[];
  /** Each point's corner flag, likewise. */
  readonly flags: readonly boolean[];
  /** The length along the polyline at each point of `ring`. */
  readonly along: readonly number[];
}

/** Where an index past a list's end reads, which callers never ask for. */
const ORIGIN: Point = Object.freeze({ x: 0, y: 0 });

/**
 * A point of a list; the origin past its end (never asked for).
 *
 * @param points - The points.
 * @param index - The index.
 * @returns The point.
 */
function pointOf(points: readonly Point[], index: number): Point {
  return points[index] ?? ORIGIN;
}

/**
 * A number of a list; 0 past its end (never asked for).
 *
 * @param values - The numbers.
 * @param index - The index.
 * @returns The number.
 */
function valueOf(values: readonly number[], index: number): number {
  return values[index] ?? 0;
}

/**
 * Measures a polyline whose consecutive points differ.
 *
 * @param line - The polyline.
 * @param isClosed - Whether it closes back to its first point.
 * @returns Its points and their lengths along it.
 */
function measure(line: CorneredPolyline, isClosed: boolean): Measured {
  const ring = isClosed ? [...line.points, pointOf(line.points, 0)] : [...line.points];
  const flags = ring.map((unused, index) => line.corners?.[index % line.points.length] ?? true);
  const along = [0];
  for (let index = 1; index < ring.length; index += 1) {
    const from = pointOf(ring, index - 1);
    const to = pointOf(ring, index);
    along.push(valueOf(along, index - 1) + Math.hypot(to.x - from.x, to.y - from.y));
  }
  return { ring, flags, along };
}

/**
 * The total length of a polyline whose consecutive points differ.
 *
 * @param points - The points.
 * @param isClosed - Whether it closes back to its first point.
 * @returns The length, world units.
 */
export function polylineLength(points: readonly Point[], isClosed: boolean): number {
  const { along } = measure({ points }, isClosed);
  return valueOf(along, along.length - 1);
}

/**
 * The segment a length along the polyline falls in: the last whose start is at or before it.
 *
 * @param along - The lengths at each point.
 * @param at - The length.
 * @returns The segment's index, from 0 to the segment count less 1.
 */
function segmentAt(along: readonly number[], at: number): number {
  let low = 0;
  let high = along.length - 2;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (valueOf(along, middle) <= at) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * The point at a length along a segment, and the segment's unit direction.
 *
 * @param measured - The measured polyline.
 * @param segment - The segment.
 * @param at - The length along the whole polyline.
 * @returns The point and direction.
 */
function pointAt(
  measured: Measured,
  segment: number,
  at: number,
): { readonly point: Point; readonly direction: Point } {
  // Consecutive points differ, so every segment has a length.
  const from = pointOf(measured.ring, segment);
  const to = pointOf(measured.ring, segment + 1);
  const start = valueOf(measured.along, segment);
  const length = valueOf(measured.along, segment + 1) - start;
  const t = Math.min(1, Math.max(0, (at - start) / length));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return {
    point: { x: from.x + dx * t, y: from.y + dy * t },
    direction: { x: dx / length, y: dy / length },
  };
}

/**
 * The part of a measured polyline between two lengths along it: the point at each end, and every
 * point strictly between them with its corner flag.
 *
 * @param measured - The measured polyline.
 * @param start - Where the part starts.
 * @param end - Where it ends, above `start`.
 * @returns The part; its ends are not corners.
 */
function slice(measured: Measured, start: number, end: number): CorneredPiece {
  const first = segmentAt(measured.along, start);
  const points = [pointAt(measured, first, start).point];
  const corners = [false];
  let index = first + 1;
  for (; index < measured.ring.length - 1 && valueOf(measured.along, index) < end; index += 1) {
    points.push(pointOf(measured.ring, index));
    corners.push(measured.flags[index] === true);
  }
  points.push(pointAt(measured, index - 1, end).point);
  corners.push(false);
  return { points, corners };
}

/**
 * The pieces a dashed stroke draws: the polyline cut at each dash's ends, the corners
 * inside a dash kept, so joins follow the stroke's join style across segments; a dash of length 0
 * is a dot. On a closed polyline a dash that runs over the closing point is one piece joined
 * there, not two capped ones (a single dash over the whole of it is left as it is: the caller
 * draws the closed polyline instead). Pure.
 *
 * @param line - The polyline (consecutive points differ, at least two) and its corners; not
 *   mutated.
 * @param isClosed - Whether it closes back to its first point.
 * @param dashes - The dashes along it (`dashIntervals` of its length), in order.
 * @returns The pieces, in order; on a closed polyline the merged piece first.
 */
export function dashPieces(
  line: CorneredPolyline,
  isClosed: boolean,
  dashes: readonly DashInterval[],
): DashPiece[] {
  const measured = measure(line, isClosed);
  const length = valueOf(measured.along, measured.along.length - 1);
  const pieces: DashPiece[] = [];
  for (const [start, end] of dashes) {
    if (end > start) {
      pieces.push({
        kind: 'piece',
        line: slice(measured, start, end),
        isAtStart: start <= 0,
        isAtEnd: end >= length,
      });
    } else {
      pieces.push({ kind: 'dot', ...pointAt(measured, segmentAt(measured.along, start), start) });
    }
  }
  return isClosed ? joinedAtClose(pieces, line) : pieces;
}

/**
 * On a closed polyline, the dash that ends at the closing point and the one that starts there
 * made one piece, joined at the closing point with its corner flag.
 *
 * @param pieces - The pieces, in order along the polyline.
 * @param line - The polyline.
 * @returns The pieces; the merged one first.
 */
function joinedAtClose(pieces: readonly DashPiece[], line: CorneredPolyline): DashPiece[] {
  const first = pieces[0];
  const last = pieces.at(-1);
  if (first?.kind !== 'piece' || last?.kind !== 'piece' || !first.isAtStart || !last.isAtEnd) {
    return [...pieces];
  }
  // One dash over the whole loop is the caller's to draw closed.
  if (first === last) return [...pieces];
  const merged: CorneredPiece = {
    points: [...last.line.points, ...first.line.points.slice(1)],
    corners: [
      ...last.line.corners.slice(0, -1),
      line.corners?.[0] ?? true,
      ...first.line.corners.slice(1),
    ],
  };
  return [
    { kind: 'piece', line: merged, isAtStart: false, isAtEnd: false },
    ...pieces.slice(1, -1),
  ];
}
