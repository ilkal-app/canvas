import type { Point, StrokeCapStyle } from '@canvas/schema';

import type { TriangleWriter } from './triangle-writer.js';

export { resolveCaps } from '@canvas/schema';
export type { StrokeCapOption, StrokeCaps, StrokeCapStyle } from '@canvas/schema';

/** The coarsest arc step: a full circle has at least 8 sides (the prototype's minimum). */
const MAX_ARC_STEP = Math.PI / 4;

/** The finest arc step: a full circle has at most 64 sides (the prototype's maximum). */
const MIN_ARC_STEP = (2 * Math.PI) / 64;

/**
 * How many straight pieces approximate an arc so that each piece's chord stays within the
 * tolerance of the arc: a step `2 acos(1 − tolerance / radius)`, kept between a circle of 8
 * and one of 64 sides (the prototype's `discSteps`).
 *
 * @param sweep - The arc's angle, radians; its sign is ignored.
 * @param radius - The arc's radius, world units.
 * @param tolerance - The largest allowed chord deviation, world units.
 * @param multiple - Round the count up to a multiple of this, so chosen angles fall on
 *   vertices (2 puts one mid-arc, 4 puts a full circle's on both axes). Default 1.
 * @returns At least `multiple`.
 */
export function arcSteps(sweep: number, radius: number, tolerance: number, multiple = 1): number {
  const exactStep = radius > tolerance ? 2 * Math.acos(1 - tolerance / radius) : MAX_ARC_STEP;
  const step = Math.min(MAX_ARC_STEP, Math.max(MIN_ARC_STEP, exactStep));
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / step));
  return Math.ceil(steps / multiple) * multiple;
}

/**
 * Writes a circular sector as a fan of triangles from its centre.
 *
 * @param writer - Where the triangles go.
 * @param centre - The sector's centre.
 * @param radius - Its radius, world units.
 * @param startAngle - The angle of its first edge, radians.
 * @param sweep - Its signed angle, radians.
 * @param tolerance - The largest allowed chord deviation, world units.
 * @param stepMultiple - Divide the arc into a multiple of this many pieces (see `arcSteps`).
 */
export function writeSector(
  writer: TriangleWriter,
  centre: Point,
  radius: number,
  startAngle: number,
  sweep: number,
  tolerance: number,
  stepMultiple = 1,
): void {
  const steps = arcSteps(sweep, radius, tolerance, stepMultiple);
  let previousX = centre.x + Math.cos(startAngle) * radius;
  let previousY = centre.y + Math.sin(startAngle) * radius;
  for (let step = 1; step <= steps; step += 1) {
    const angle = startAngle + (sweep * step) / steps;
    const x = centre.x + Math.cos(angle) * radius;
    const y = centre.y + Math.sin(angle) * radius;
    writer.triangle(centre.x, centre.y, previousX, previousY, x, y);
    previousX = x;
    previousY = y;
  }
}

/**
 * Writes the cap at one open end of a stroke.
 *
 * @param writer - Where the triangles go.
 * @param style - The cap's style.
 * @param point - The end point.
 * @param outward - The unit direction pointing out of the stroke at that end.
 * @param halfWidth - Half the stroke's width, world units.
 * @param tolerance - The largest allowed chord deviation, world units.
 */
export function writeCap(
  writer: TriangleWriter,
  style: StrokeCapStyle,
  point: Point,
  outward: Point,
  halfWidth: number,
  tolerance: number,
): void {
  if (style === 'butt') return;
  if (style === 'square') {
    // The end's two corners, pushed out by half the width along the stroke.
    const nx = -outward.y * halfWidth;
    const ny = outward.x * halfWidth;
    const ox = outward.x * halfWidth;
    const oy = outward.y * halfWidth;
    const [lx, ly, rx, ry] = [point.x + nx, point.y + ny, point.x - nx, point.y - ny];
    writer.triangle(lx, ly, rx, ry, rx + ox, ry + oy);
    writer.triangle(lx, ly, rx + ox, ry + oy, lx + ox, ly + oy);
    return;
  }
  // From the left normal, a half turn clockwise through the outward direction to the right one;
  // an even step count puts a vertex on the outward direction, so the cap's reach is exact.
  const normalAngle = Math.atan2(outward.x, -outward.y);
  writeSector(writer, point, halfWidth, normalAngle, -Math.PI, tolerance, 2);
}

/**
 * Writes a stroke of no length at a point: a disc of the stroke's width for a round
 * cap, a square of its width turned along `direction` for a square cap (both caps of a dash of
 * length 0, as SVG draws them), nothing for butt.
 *
 * @param writer - Where the triangles go.
 * @param style - The cap's style.
 * @param point - The point.
 * @param direction - The unit direction of the stroke there; the x axis where it has none.
 * @param halfWidth - Half the stroke's width, world units.
 * @param tolerance - The largest allowed chord deviation, world units.
 */
export function writeDot(
  writer: TriangleWriter,
  style: StrokeCapStyle,
  point: Point,
  direction: Point,
  halfWidth: number,
  tolerance: number,
): void {
  if (style === 'round') {
    // A multiple of four sides puts vertices on both axes, so the dot's bounds are exact.
    writeSector(writer, point, halfWidth, 0, 2 * Math.PI, tolerance, 4);
  } else if (style === 'square') {
    writeCap(writer, 'square', point, direction, halfWidth, tolerance);
    writeCap(writer, 'square', point, { x: -direction.x, y: -direction.y }, halfWidth, tolerance);
  }
}
