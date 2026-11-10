import type { LineCap } from '../fields/line-cap.js';
import type { Point } from '../fields/point.js';

import type { StrokeCapStyle } from './stroke-caps.js';

/** A cap's length at stroke width 0, world units: thin lines still show their heads. */
const CAP_LENGTH_BASE = 8;

/** How much a cap's length grows per unit of stroke width. */
const CAP_LENGTH_PER_WIDTH = 3;

/** A circle cap's radius, as a share of the cap's length. */
const CIRCLE_RADIUS_SHARE = 0.35;

/** A diamond cap's half-width across the line, as a share of the cap's length. */
const DIAMOND_HALF_WIDTH_SHARE = 0.3;

/**
 * What a line's end cap draws, in the line's own frame (arrowheads are
 * caps): a polyline stroked like the line (an open arrow's barbs), a filled polygon (a triangle,
 * a diamond) or a filled disc (a circle). The path pass meshes it (`writeCapShape`) and hit
 * testing picks it (`objectGeometry`), so a head is picked where it is drawn.
 */
export type CapShape =
  | {
      /** Stroked with the line's width, round joins and caps. */
      readonly kind: 'stroke';
      /** The polyline. */
      readonly points: readonly Point[];
    }
  | {
      /** Filled. */
      readonly kind: 'polygon';
      /** The convex polygon's corners, in order. */
      readonly points: readonly Point[];
    }
  | {
      /** A filled disc. */
      readonly kind: 'disc';
      /** Its centre. */
      readonly centre: Point;
      /** Its radius, world units. */
      readonly radius: number;
    };

/**
 * The length of a cap along the line at a stroke width, world units: `8 + 3 × width`, so heads
 * scale with the stroke and a hairline still gets a visible one. An arrow's or triangle's base is
 * half as wide as it is long. Pure.
 *
 * @param width - The line's stroke width, world units, at least 0.
 * @returns The length.
 */
export function capLength(width: number): number {
  return CAP_LENGTH_BASE + CAP_LENGTH_PER_WIDTH * width;
}

/**
 * A cap's length on a line of a given length: {@link capLength}, but at most half the line, so
 * on a short line each head stays on its own half and never reaches past the far end. Pure.
 *
 * @param width - The line's stroke width, world units, at least 0.
 * @param lineLength - The length of the line's route, world units; unbounded if absent.
 * @returns The length, world units.
 */
export function capLengthOn(width: number, lineLength = Number.POSITIVE_INFINITY): number {
  return Math.min(capLength(width), lineLength / 2);
}

/**
 * The shape a cap draws at one end of a line: an
 * open arrow is two barbs stroked back from the end point; a triangle is filled with its point on
 * the end point; a circle and a diamond are filled and centred on it. Sizes follow
 * {@link capLengthOn}: {@link capLength}, at most half the line. Pure.
 *
 * @param cap - The cap.
 * @param tip - The line's end point.
 * @param outward - The unit direction pointing out of the line at that end.
 * @param width - The line's stroke width, world units.
 * @param lineLength - The length of the line's route, world units; unbounded if absent.
 * @returns The shape, or `undefined` for `none`.
 */
export function capShapeOf(
  cap: LineCap,
  tip: Point,
  outward: Point,
  width: number,
  lineLength?: number,
): CapShape | undefined {
  const length = capLengthOn(width, lineLength);
  // A point `along` the line from the tip (positive outward) and `across` it (the left normal).
  const at = (along: number, across: number): Point => ({
    x: tip.x + outward.x * along - outward.y * across,
    y: tip.y + outward.y * along + outward.x * across,
  });
  switch (cap) {
    case 'none':
      return undefined;
    case 'arrow':
      return {
        kind: 'stroke',
        points: [at(-length, length / 2), at(0, 0), at(-length, -length / 2)],
      };
    case 'triangle':
      return {
        kind: 'polygon',
        points: [at(0, 0), at(-length, length / 2), at(-length, -length / 2)],
      };
    case 'circle':
      return { kind: 'disc', centre: { x: tip.x, y: tip.y }, radius: length * CIRCLE_RADIUS_SHARE };
    case 'diamond': {
      const half = length / 2;
      const across = length * DIAMOND_HALF_WIDTH_SHARE;
      return {
        kind: 'polygon',
        points: [at(half, 0), at(0, across), at(-half, 0), at(0, -across)],
      };
    }
  }
}

/**
 * How far the line's own stroke stops short of the end point under a cap, world units: a filled
 * triangle's shaft stops halfway into the triangle, so its end never pokes past the sharp point;
 * every other cap's shaft runs to the end point. Pure.
 *
 * @param cap - The cap.
 * @param width - The stroke width.
 * @param lineLength - The length of the line's route, world units; unbounded if absent.
 * @returns The inset, at least 0.
 */
export function capShaftInset(cap: LineCap, width: number, lineLength?: number): number {
  return cap === 'triangle' ? capLengthOn(width, lineLength) / 2 : 0;
}

/**
 * The stroke cap of the line's shaft under a cap (`writeStroke`'s `capStyle` hook): round for no
 * cap and under an open arrow (whose barbs meet in round caps too), butt under a filled cap,
 * which covers the shaft's end.
 *
 * @param cap - The cap.
 * @returns The shaft's end style.
 */
export function capShaftStyle(cap: LineCap): StrokeCapStyle {
  return cap === 'none' || cap === 'arrow' ? 'round' : 'butt';
}

/**
 * How far a cap's pixels reach from the end point, world units: bounds and culling grow a line's
 * box by the larger of this and its half-width. Pure.
 *
 * @param cap - The cap.
 * @param width - The stroke width.
 * @returns The reach, at least half the width.
 */
export function capReach(cap: LineCap, width: number): number {
  const length = capLength(width);
  const halfWidth = width / 2;
  switch (cap) {
    case 'none':
      return halfWidth;
    case 'arrow':
      return Math.hypot(length, length / 2) + halfWidth;
    case 'triangle':
      return Math.max(halfWidth, Math.hypot(length, length / 2));
    case 'circle':
      return Math.max(halfWidth, length * CIRCLE_RADIUS_SHARE);
    case 'diamond':
      return Math.max(halfWidth, length / 2);
  }
}
