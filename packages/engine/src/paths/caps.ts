import type { CapShape } from '@canvas/schema';

import { writeSector } from './stroke-caps.js';
import { writeStroke } from './stroke-mesh.js';
import type { TriangleWriter } from './triangle-writer.js';

export {
  capLength,
  capLengthOn,
  capReach,
  capShaftInset,
  capShaftStyle,
  capShapeOf,
} from '@canvas/schema';
export type { CapShape } from '@canvas/schema';

/**
 * Writes a cap's triangles: a stroked shape with the line's width and round joins and caps, a
 * polygon as a fan from its first corner (it is convex), a disc as a full sector.
 *
 * @param writer - Where the triangles go.
 * @param shape - The cap's shape (`capShapeOf`).
 * @param width - The line's stroke width.
 * @param tolerance - The largest allowed deviation from the exact outline, world units.
 */
export function writeCapShape(
  writer: TriangleWriter,
  shape: CapShape,
  width: number,
  tolerance: number,
): void {
  switch (shape.kind) {
    case 'stroke':
      writeStroke(writer, shape.points, width, false, 'round', tolerance);
      return;
    case 'polygon': {
      const [first, ...rest] = shape.points;
      if (!first) return;
      for (let index = 1; index < rest.length; index += 1) {
        const b = rest[index - 1];
        const c = rest[index];
        if (b && c) writer.triangle(first.x, first.y, b.x, b.y, c.x, c.y);
      }
      return;
    }
    case 'disc':
      // A multiple of four sides puts vertices on both axes, so the disc's bounds are exact.
      writeSector(writer, shape.centre, shape.radius, 0, 2 * Math.PI, tolerance, 4);
  }
}
