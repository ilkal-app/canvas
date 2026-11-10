import { lineShapeOf, type LineShapeInput } from '@canvas/schema';

import { writeCapShape } from './caps.js';
import { writeStroke } from './stroke-mesh.js';
import type { TriangleWriter } from './triangle-writer.js';

export { lineShapeOf } from '@canvas/schema';
export type { LineShape, LineShapeInput } from '@canvas/schema';

/**
 * Writes a line's triangles: its shaft stroked with the outline's joins and dashes,
 * then its heads, solid with round joins.
 *
 * @param writer - Where the triangles go.
 * @param input - The route and caps.
 * @param width - The stroke width, world units, above 0.
 * @param tolerance - The largest allowed deviation from the exact outline, world units.
 */
export function writeLineShape(
  writer: TriangleWriter,
  input: LineShapeInput,
  width: number,
  tolerance: number,
): void {
  const shape = lineShapeOf(input, width);
  writeStroke(writer, shape.shaft, width, false, shape.shaftCaps, tolerance, input.outline);
  for (const head of shape.heads) writeCapShape(writer, head, width, tolerance);
}
