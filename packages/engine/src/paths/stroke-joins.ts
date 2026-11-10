import { DEFAULT_STROKE_MITER_LIMIT, type Point, type StrokeJoin } from '@canvas/schema';

import { writeSector } from './stroke-caps.js';
import type { TriangleWriter } from './triangle-writer.js';

/**
 * A shared mitre is used only below this turn: 120°, where the mitre reaches twice the
 * half-width. Past it, the two segments keep their own normals and the join fills the outer side,
 * so the inner side never folds back over a short segment.
 */
const MIN_MITRE_COS_HALF = 0.5;

/** An offset from a polyline point to a side of the stroke. */
export interface Offset {
  /** Its x, world units. */
  readonly x: number;
  /** Its y, world units. */
  readonly y: number;
}

/** How a join is drawn: the style, and the miter limit of a miter join. */
export interface JoinStyle {
  /** The join; absent for the round join of earlier builds. */
  readonly join?: StrokeJoin | undefined;
  /** The miter limit, at least 1; absent for 4. */
  readonly miterLimit?: number | undefined;
}

/**
 * The left normal of a unit direction, scaled.
 *
 * @param direction - The unit direction.
 * @param scale - The normal's length.
 * @returns The normal.
 */
export function normalOf(direction: Point, scale: number): Offset {
  return { x: -direction.y * scale, y: direction.x * scale };
}

/**
 * Fills the outer side of a turn between two segments that keep their own normals: a bevel
 * triangle, and for a miter within its limit the miter's tip beyond it (SVG: the miter's length
 * over the stroke's width is 1 / cos(turn / 2); past the limit the join is bevelled).
 *
 * @param writer - Where the triangles go.
 * @param point - The point the segments share.
 * @param outerIn - The incoming segment's offset to the outer side.
 * @param outerOut - The outgoing segment's offset to the outer side.
 * @param cosHalf - The cosine of half the turn.
 * @param style - The join and its miter limit.
 */
function writeCorner(
  writer: TriangleWriter,
  point: Point,
  outerIn: Offset,
  outerOut: Offset,
  cosHalf: number,
  style: JoinStyle,
): void {
  const a = { x: point.x + outerIn.x, y: point.y + outerIn.y };
  const b = { x: point.x + outerOut.x, y: point.y + outerOut.y };
  const limit = style.miterLimit ?? DEFAULT_STROKE_MITER_LIMIT;
  if (style.join === 'miter' && cosHalf > 0 && 1 / cosHalf <= limit) {
    // The offsets sum to 2 cos²(θ/2) times the miter along the bisector.
    const scale = 1 / (2 * cosHalf * cosHalf);
    const tipX = point.x + (outerIn.x + outerOut.x) * scale;
    const tipY = point.y + (outerIn.y + outerOut.y) * scale;
    writer.triangle(point.x, point.y, a.x, a.y, tipX, tipY);
    writer.triangle(point.x, point.y, tipX, tipY, b.x, b.y);
    return;
  }
  writer.triangle(point.x, point.y, a.x, a.y, b.x, b.y);
}

/**
 * Whether a join is drawn as one mitre the two segments share: at a gentle turn, where the mitre
 * stays within the tolerance of a round join (between the pieces of a flattened curve), for a
 * round join or none, as every earlier build drew it, and for a miter join only while the miter
 * is within its limit. A bevel, or a miter past its limit, is never shared: even at a
 * gentle turn it is cut on the chord, as SVG draws it.
 *
 * @param cosHalf - The cosine of half the turn.
 * @param halfWidth - Half the stroke's width.
 * @param tolerance - The largest allowed deviation from the round join.
 * @param style - The join and its miter limit.
 * @returns True when the segments share the mitre.
 */
function isSharedMitre(
  cosHalf: number,
  halfWidth: number,
  tolerance: number,
  style: JoinStyle,
): boolean {
  const isGentle = cosHalf > MIN_MITRE_COS_HALF && halfWidth * (1 / cosHalf - 1) <= tolerance;
  if (!isGentle || style.join === 'bevel') return false;
  return style.join !== 'miter' || 1 / cosHalf <= (style.miterLimit ?? DEFAULT_STROKE_MITER_LIMIT);
}

/**
 * The offsets at an interior point where the segment `incoming` ends and `outgoing` starts, with
 * the join's triangles. A gentle turn shares the mitre for a round join, none, or a miter within
 * its limit (`isSharedMitre`). Elsewhere each segment keeps its own normal and
 * the outer side of the turn is filled: a sector of the half-width for a round join (and for an
 * absent style, as every earlier build drew it), a triangle for a bevel, and for a miter the
 * miter, or a bevel past the miter limit.
 *
 * @param writer - Where the join's triangles go.
 * @param point - The point the segments share.
 * @param incoming - The unit direction of the segment ending there.
 * @param outgoing - The unit direction of the segment starting there.
 * @param halfWidth - Half the stroke's width.
 * @param tolerance - The largest allowed deviation from the round join.
 * @param style - The join and its miter limit.
 * @returns The offset the incoming segment ends with and the outgoing one starts with.
 */
export function writeJoin(
  writer: TriangleWriter,
  point: Point,
  incoming: Point,
  outgoing: Point,
  halfWidth: number,
  tolerance: number,
  style: JoinStyle,
): [Offset, Offset] {
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  const cosHalf = Math.sqrt(Math.max(0, (1 + dot) / 2));
  const normalIn = normalOf(incoming, halfWidth);
  const normalOut = normalOf(outgoing, halfWidth);
  if (isSharedMitre(cosHalf, halfWidth, tolerance, style)) {
    // The two normals sum to 2 cos(θ/2) × half-width along the bisector; the mitre is
    // half-width / cos(θ/2) long along it.
    const scale = 1 / (2 * cosHalf * cosHalf);
    const mitre = { x: (normalIn.x + normalOut.x) * scale, y: (normalIn.y + normalOut.y) * scale };
    return [mitre, mitre];
  }
  // The outer side is right of a left turn and left of a right turn (or of a turn back); the
  // side's offset turns with the direction, by the turn's angle.
  const isLeftTurn = cross > 0;
  if (style.join === 'miter' || style.join === 'bevel') {
    const side = isLeftTurn ? -1 : 1;
    const outerIn = { x: normalIn.x * side, y: normalIn.y * side };
    const outerOut = { x: normalOut.x * side, y: normalOut.y * side };
    writeCorner(writer, point, outerIn, outerOut, cosHalf, style);
    return [normalIn, normalOut];
  }
  const turn = Math.abs(Math.atan2(cross, dot));
  const startAngle = isLeftTurn
    ? Math.atan2(-normalIn.y, -normalIn.x)
    : Math.atan2(normalIn.y, normalIn.x);
  // An even step count puts a vertex on the bisector, where the join reaches furthest.
  writeSector(writer, point, halfWidth, startAngle, isLeftTurn ? turn : -turn, tolerance, 2);
  return [normalIn, normalOut];
}
