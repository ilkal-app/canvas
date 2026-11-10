import { isPaintVisible, strokeOutsetOf, type Point, type ShapeObject } from '@canvas/schema';

import { LIGHT_PALETTE, type ColorPalette } from '../paint/color-palette.js';
import { readFill } from '../paint/paint-reading.js';
import { outlineOuterDistance, shapeDistance } from '../shapes/shape-distance.js';
import { SHAPE_KIND_OF } from '../shapes/shape-object-record.js';
import { shapeLabelBox } from '../text/scene/shape-label-box.js';

/**
 * Whether a point in a shape's own frame hits it, by its kind's outline rather than its box:
 * the signed distance of the kind the shape pass draws (`shapeDistance`, the shader's
 * functions on the CPU, polygons and stars stretched to the box as drawn). A shape whose fill
 * paints is hit inside its outline, the part of its stroke outside the edge included,
 * ending where the shader ends it (`outlineOuterDistance`: a rectangle's sharp corner mitred, a
 * rounded one's radius grown); one without is hit on its outline, the band of its stroke's width
 * where it lies about the edge (inside, centred or outside), give or take the tolerance, so a click
 * inside an unfilled shape reaches what shows through it. A shape with a label but no fill is also
 * hit inside its label's box (`shapeLabelBox`), where its text is. The caller maps the point into
 * the shape's frame, so a turned shape is tested as drawn. A token fill is judged by its value in
 * the palette: one transparent there is no fill, as drawn. Pure.
 *
 * @param shape - The shape.
 * @param point - The point, in the shape's frame (its box's top-left at the origin), world units.
 * @param tolerance - How far outside an outline a pick still hits it, world units, at least 0.
 * @param palette - What the shape's tokens resolve to; default the light theme's built-ins.
 * @returns True for a hit.
 */
export function isPointOnShape(
  shape: ShapeObject,
  point: Point,
  tolerance: number,
  palette: ColorPalette = LIGHT_PALETTE,
): boolean {
  const { width, height, stroke } = shape;
  const halfSize = { x: width / 2, y: height / 2 };
  const radius =
    shape.kind === 'rectangle' ? Math.min(shape.cornerRadius, halfSize.x, halfSize.y) : 0;
  const local = { x: point.x - halfSize.x, y: point.y - halfSize.y };
  const kind = SHAPE_KIND_OF[shape.kind];
  const distance = shapeDistance(kind, local, halfSize, radius, shape.sides);
  const outset = strokeOutsetOf(stroke, shape.strokeAlign);
  // Where the outline ends, as drawn: a box's sharp corner mitred, a rounded one's radius grown.
  const outer = outlineOuterDistance(kind, local, halfSize, radius, distance, outset);
  if (isPaintVisible(readFill(shape.fill, palette))) return outer <= 0;
  const outlineWidth = stroke?.width ?? 0;
  const isOnOutline = outer <= tolerance && distance >= outset - outlineWidth - tolerance;
  if (isOnOutline) return true;
  if (shape.label === null || shape.label.text.length === 0) return false;
  const box = shapeLabelBox(shape);
  return (
    point.x >= box.x &&
    point.y >= box.y &&
    point.x <= box.x + box.width &&
    point.y <= box.y + box.height
  );
}
