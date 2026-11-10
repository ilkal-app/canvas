import type { BoardObject, ImageObject } from '@canvas/schema';

import { SDF_SHAPE_MOVE_SHADER } from '../gpu/shaders/sdf-shape-move.generated.js';
import { LIGHT_PALETTE, paletteOf, type ColorPalette } from '../paint/color-palette.js';
import { drawnColor } from '../paint/paint-reading.js';
import {
  SHAPE_KIND_CODES,
  SHAPE_QUAD_CORNER_VERTEX_LAYOUT,
} from '../shapes/shape-instance-layout.js';
import { isOutlineVisible } from '../shapes/shape-object-record.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { SHAPE_QUAD_CORNERS } from '../shapes/shape-pipeline.js';

import { FRAME_SHAPE_INSTANCE_LAYOUT } from './frame-shape-record.js';
import type { ScenePass, SceneObject } from './scene-pass.js';
import type { WorldTransform } from './world-transform.js';

/** The image border pass's name: the key of its instance buffer and draw list entries. */
export const IMAGE_BORDER_PASS_NAME = 'image-border';

/**
 * Whether this pass draws an object: an image whose border paints (`isOutlineVisible`: a width
 * and a colour with alpha above 0, `'ink'` counting as opaque). Pure.
 *
 * @param object - The object.
 * @returns True for a bordered image.
 */
export function isBorderedImage(object: BoardObject): object is ImageObject {
  return object.type === 'image' && isOutlineVisible(object.border);
}

/**
 * Writes an image's border record (the frame SDF record, `FRAME_SHAPE_INSTANCE_LAYOUT`, with
 * sharp corners): its box, placed and turned by the image's transform, as a box with a clear fill
 * and the border's colour (`'ink'` and a colour token resolved by the palette), width and
 * alignment wholly inside the edge, so the image keeps its size. An image without a border that
 * paints leaves the record clear, which draws nothing. Field by field: it allocates nothing.
 *
 * @param record - The record, zero-filled.
 * @param image - The image.
 * @param transform - Its frame to the world.
 * @param palette - What the border's `'ink'` and tokens draw as. Default the light theme's
 *   built-ins.
 */
export function writeImageBorderRecord(
  record: Float32Array,
  image: ImageObject,
  transform: WorldTransform,
  palette: ColorPalette = LIGHT_PALETTE,
): void {
  const { border } = image;
  if (border === null || border === undefined || !isOutlineVisible(border)) return;
  record[0] = transform.x;
  record[1] = transform.y;
  record[2] = image.width;
  record[3] = image.height;
  // Floats 4–9, the fill, radius and softness, stay 0: a clear, sharp, crisp box.
  record[10] = SHAPE_KIND_CODES['rounded-box'];
  record[11] = transform.cos;
  record[12] = transform.sin;
  const color = drawnColor(border.color, palette);
  record[13] = color[0];
  record[14] = color[1];
  record[15] = color[2];
  record[16] = color[3];
  record[17] = border.width;
  // Float 19, the share outside the edge, stays 0: the border lies inside the image's box, and
  // the corner radii stay 0 (an image is sharp).
}

/**
 * The image border pass: an image's border, one stroke-only SDF record of its box
 * (`writeImageBorderRecord`), drawn with the shape pass's pipeline (`sdf-shape.wgsl`, the frame
 * stroke's record), so it is antialiased and lies inside the edge as a shape's inside outline
 * does. It is registered right after the image pass and flagged to the z-order segments
 * (`isOccluder`), so the border lands over its own image and under anything later in paint
 * order. An image has no descendants, so the record sits at the image's own rank. A board
 * without a bordered image gives the pass no record, so its plans are unchanged. Stateless.
 */
export const IMAGE_BORDER_PASS: ScenePass = {
  isRootMoveOrderStable: true,
  isRootMoveEmpty: true,
  name: IMAGE_BORDER_PASS_NAME,
  layout: FRAME_SHAPE_INSTANCE_LAYOUT,
  pipelineSpec: {
    shader: SDF_SHAPE_PASS.pipelineSpec.shader,
    moveShader: SDF_SHAPE_MOVE_SHADER,
    vertexLayout: SHAPE_QUAD_CORNER_VERTEX_LAYOUT,
    vertices: new Float32Array(SHAPE_QUAD_CORNERS),
    vertexCount: SDF_SHAPE_PASS.pipelineSpec.vertexCount,
    blend: 'premultiplied',
  },
  recordCount(object: BoardObject): number {
    return isBorderedImage(object) ? 1 : 0;
  },
  // The border paints over its image, whatever pass drew it.
  isOccluder: isBorderedImage,
  prepare(record: Float32Array, target: SceneObject): void {
    const { object, transform } = target;
    if (object.type !== 'image') return;
    writeImageBorderRecord(record, object, transform, paletteOf(target));
  },
};
