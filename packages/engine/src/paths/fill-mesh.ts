import type { Point } from '@canvas/schema';

import { TriangleWriter } from './triangle-writer.js';

/**
 * Writes a polygon's triangle fan from its first point into a writer; {@link fanMesh} without
 * the copy.
 *
 * @param writer - Where the triangles go.
 * @param polygon - The polygon's points in order, not repeating the first at the end.
 */
export function writeFan(writer: TriangleWriter, polygon: readonly Point[]): void {
  const [origin] = polygon;
  if (!origin) return;
  for (let index = 1; index + 1 < polygon.length; index += 1) {
    const b = polygon[index];
    const c = polygon[index + 1];
    if (b && c) writer.triangle(origin.x, origin.y, b.x, b.y, c.x, c.y);
  }
}

/**
 * A polygon's triangle fan from its first point (the prototype's `fanMesh`,
 * `webgl-whiteboard/src/vector/stroke.ts`). The fan is not a triangulation: its triangles overlap
 * and stray outside a concave polygon, but each point inside is covered an odd number of times
 * and each point outside an even number, so inverting the stencil once per triangle fills the
 * polygon exactly by the even-odd rule. Pure.
 *
 * @param polygon - The polygon's points in order, not repeating the first at the end.
 * @returns The triangle list, `x, y` per vertex; empty for fewer than three points.
 */
export function fanMesh(polygon: readonly Point[]): Float32Array<ArrayBuffer> {
  const writer = new TriangleWriter(Math.max(6, (polygon.length - 2) * 6));
  writeFan(writer, polygon);
  return writer.toFloat32Array();
}

/**
 * The stencil mesh of a path's fill: one fan per closed loop, concatenated. Drawn into one
 * stencil with `invert`, loops combine by the even-odd rule, so a loop inside another is a hole
 * and the overlap of two loops is unfilled. Pure.
 *
 * @param loops - Each closed loop's flattened polygon, not repeating its first point.
 * @returns The triangle list, `x, y` per vertex.
 */
export function fillMesh(loops: readonly (readonly Point[])[]): Float32Array<ArrayBuffer> {
  const writer = new TriangleWriter();
  for (const loop of loops) writeFan(writer, loop);
  return writer.toFloat32Array();
}
