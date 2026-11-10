import {
  isPaintVisible,
  isTokenRef,
  strokeOutsideFraction,
  type BoardObject,
  type ShapeObject,
  type Stroke,
} from '@canvas/schema';

import { LIGHT_PALETTE, type ColorPalette } from '../paint/color-palette.js';
import {
  drawnColor,
  readFill,
  readGradient,
  readImagePaint,
  readInkable,
} from '../paint/paint-reading.js';
import type { WorldTransform } from '../scene/world-transform.js';

import { SHAPE_KIND_CODES } from './shape-instance-layout.js';
import type { ShapeKind } from './shape-instance.js';

/**
 * The distance function each schema shape kind draws with: a rectangle
 * is the rounded box (its `cornerRadius` the radius, 0 sharp), the others their own.
 */
export const SHAPE_KIND_OF: Readonly<Record<ShapeObject['kind'], ShapeKind>> = Object.freeze({
  rectangle: 'rounded-box',
  ellipse: 'ellipse',
  diamond: 'diamond',
  polygon: 'polygon',
  star: 'star',
});

/**
 * Whether a shape paints any pixel of its own: a fill with alpha above 0 (a solid with alpha above
 * 0, or a gradient with any stop's alpha above 0), or an outline with a width
 * and alpha above 0, where `'ink'` counts as alpha 1 (and an unreadable colour as the base
 * colour's). (Its label is the text pass's.) A painted shape has one record in the
 * shape pass and is flagged to the z-order segments (`ScenePass.isOccluder`), whatever its
 * alpha: anything it paints must land over the content below it, even content a later pass
 * draws, so a half-transparent highlight or an unfilled outline over text or an image draws over
 * it. Pure.
 *
 * @param shape - The shape.
 * @returns True when its fill or its outline can cover a pixel.
 */
export function isPaintedShape(shape: ShapeObject): boolean {
  // A token fill paints whatever it resolves to, so the record count never depends on its value.
  return (
    isTokenRef(shape.fill) || isPaintVisible(readFill(shape.fill)) || isOutlineVisible(shape.stroke)
  );
}

/**
 * Whether an outline paints any pixel: a width above 0 and a colour with alpha above 0, where
 * `'ink'` and a token count as alpha 1 (and an unreadable colour as the base colour's). A shape's
 * (`isPaintedShape`) and a frame's. Pure.
 *
 * @param stroke - The outline, or `null` or absent for none.
 * @returns True when it can cover a pixel.
 */
export function isOutlineVisible(stroke: Stroke | null | undefined): boolean {
  if (stroke === null || stroke === undefined || !(stroke.width > 0)) return false;
  const color = readInkable(stroke.color);
  // `'ink'` and a token count as alpha 1, so the record count never depends on a token's value.
  return !Array.isArray(color) || color[3] > 0;
}

/**
 * Whether an object is a shape that paints ({@link isPaintedShape}): the shape pass's flag to
 * the z-order segments. Pure.
 *
 * @param object - The object.
 * @returns True for a painted shape.
 */
export function isPaintedShapeObject(object: BoardObject): boolean {
  return object.type === 'shape' && isPaintedShape(object);
}

/**
 * Whether an object is a painted shape whose fill is a gradient the schema accepts: the gradient
 * shape pass's, not the solid SDF shape pass's. Pure.
 *
 * @param object - The object.
 * @returns True for a painted gradient-filled shape.
 */
export function isPaintedGradientShape(object: BoardObject): boolean {
  return (
    isPaintedShapeObject(object) && 'fill' in object && readGradient(object.fill) !== undefined
  );
}

/**
 * Whether an object is a painted shape whose fill is an image paint the schema accepts: the
 * image shape pass's, not the solid SDF shape pass's. Pure.
 *
 * @param object - The object.
 * @returns True for an image-filled shape.
 */
export function isPaintedImageShape(object: BoardObject): boolean {
  return object.type === 'shape' && readImagePaint(object.fill) !== undefined;
}

/**
 * Writes a shape object's one record (the layout of `SHAPE_INSTANCE_FLOATS`): its box
 * placed and turned by the object's world transform, a solid fill (clear when it has none, a
 * gradient or an image paint, which the gradient and image passes colour), a rectangle's corner
 * radius, the kind's code, the outline (width 0 when it has none; `'ink'` resolved to `ink`) with
 * the fraction of it outside the edge (`strokeAlign`: absent or unreadable is inside)
 * and a polygon's sides or a star's points. Field by field: it runs for every changed shape, so it
 * allocates
 * nothing.
 *
 * @param record - The record, zero-filled.
 * @param shape - The shape.
 * @param transform - Its frame to the world: the box's top-left corner and turn.
 * @param palette - What the outline's and fill's `'ink'` and tokens draw as. Default the light
 *   theme's built-ins.
 */
export function writeShapeRecord(
  record: Float32Array,
  shape: ShapeObject,
  transform: WorldTransform,
  palette: ColorPalette = LIGHT_PALETTE,
): void {
  const { stroke } = shape;
  const fill = readFill(shape.fill, palette);
  record[0] = transform.x;
  record[1] = transform.y;
  record[2] = shape.width;
  record[3] = shape.height;
  if (Array.isArray(fill)) {
    record[4] = fill[0];
    record[5] = fill[1];
    record[6] = fill[2];
    record[7] = fill[3];
  }
  record[8] = shape.kind === 'rectangle' ? shape.cornerRadius : 0;
  // Float 9, the softness, stays 0: a crisp edge.
  record[10] = SHAPE_KIND_CODES[SHAPE_KIND_OF[shape.kind]];
  record[11] = transform.cos;
  record[12] = transform.sin;
  if (stroke !== null) {
    const color = drawnColor(stroke.color, palette);
    record[13] = color[0];
    record[14] = color[1];
    record[15] = color[2];
    record[16] = color[3];
    record[17] = stroke.width;
    record[19] = strokeOutsideFraction(shape.strokeAlign);
  }
  record[18] = shape.sides;
}
