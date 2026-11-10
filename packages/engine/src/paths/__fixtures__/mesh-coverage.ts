// Geometry checks for triangle-list meshes (x, y pairs, three vertices per triangle), as the
// prototype's `webgl-whiteboard/src/vector/stroke.test.ts` checked them.
import type { WorldBounds } from '../../camera/camera.js';

/**
 * The bounds of a mesh's vertices.
 *
 * @param mesh - The triangle list.
 * @returns Their box.
 */
export function meshBounds(mesh: Float32Array): WorldBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let at = 0; at + 1 < mesh.length; at += 2) {
    const x = mesh[at] ?? 0;
    const y = mesh[at + 1] ?? 0;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Whether any triangle of a mesh covers a point, edges included.
 *
 * @param mesh - The triangle list.
 * @param x - The point's x.
 * @param y - The point's y.
 * @returns True when covered.
 */
export function covers(mesh: Float32Array, x: number, y: number): boolean {
  return coverCount(mesh, x, y) > 0;
}

/**
 * How many triangles of a mesh cover a point, edges included: the stencil count an even-odd
 * fill inverts once per triangle.
 *
 * @param mesh - The triangle list.
 * @param x - The point's x.
 * @param y - The point's y.
 * @returns The count.
 */
export function coverCount(mesh: Float32Array, x: number, y: number): number {
  let count = 0;
  for (let at = 0; at + 5 < mesh.length; at += 6) {
    const [ax, ay, bx, by, cx, cy] = mesh.subarray(at, at + 6);
    const d1 =
      (x - (bx ?? 0)) * ((ay ?? 0) - (by ?? 0)) - ((ax ?? 0) - (bx ?? 0)) * (y - (by ?? 0));
    const d2 =
      (x - (cx ?? 0)) * ((by ?? 0) - (cy ?? 0)) - ((bx ?? 0) - (cx ?? 0)) * (y - (cy ?? 0));
    const d3 =
      (x - (ax ?? 0)) * ((cy ?? 0) - (ay ?? 0)) - ((cx ?? 0) - (ax ?? 0)) * (y - (ay ?? 0));
    const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(hasNegative && hasPositive)) count += 1;
  }
  return count;
}

/**
 * The area a mesh covers (the union of its triangles), estimated on a grid of cell centres.
 *
 * @param mesh - The triangle list.
 * @param cell - The grid step, world units.
 * @returns The covered area, world units squared.
 */
export function coveredArea(mesh: Float32Array, cell: number): number {
  const { minX, minY, maxX, maxY } = meshBounds(mesh);
  let covered = 0;
  for (let y = minY + cell / 2; y < maxY; y += cell) {
    for (let x = minX + cell / 2; x < maxX; x += cell) {
      if (covers(mesh, x, y)) covered += 1;
    }
  }
  return covered * cell * cell;
}
