import { strokeOutsideFraction, type BoardObject, type FrameObject } from '@canvas/schema';

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

import {
  FRAME_SHAPE_INSTANCE_LAYOUT,
  frameRadiiOf,
  writeFrameCornerRadii,
} from './frame-shape-record.js';
import type { ScenePass, SceneObject } from './scene-pass.js';
import type { WorldTransform } from './world-transform.js';

/** The frame stroke pass's name: the key of its instance buffer and draw list entries. */
export const FRAME_STROKE_PASS_NAME = 'frame-stroke';

/**
 * Whether this pass draws an object: a frame whose outline paints (`isOutlineVisible`: a width
 * and a colour with alpha above 0, `'ink'` counting as opaque). Pure.
 *
 * @param object - The object.
 * @returns True for a stroked frame.
 */
export function isStrokedFrame(object: BoardObject): object is FrameObject {
  return object.type === 'frame' && isOutlineVisible(object.stroke);
}

/**
 * Writes a frame's outline record (the frame SDF record, `FRAME_SHAPE_INSTANCE_LAYOUT`): its box,
 * placed and turned by the frame's transform, as a rounded box with its corner radii (
 * zeros for a sharp frame, `frameRadiiOf`) with a clear fill and the
 * outline's colour (`'ink'` and a colour token resolved by the palette), width and alignment (`strokeOutsideFraction`: a
 * sharp corner's outline outside the edge keeps it sharp and mitred, a rounded one's radius
 * grows with it, as the shader draws it). A frame without an outline
 * that paints leaves the record clear, which draws nothing. Field by field: it allocates nothing.
 *
 * @param record - The record, zero-filled.
 * @param frame - The frame.
 * @param transform - Its frame to the world.
 * @param palette - What the outline's `'ink'` and tokens draw as. Default the light theme's
 *   built-ins.
 */
export function writeFrameStrokeRecord(
  record: Float32Array,
  frame: FrameObject,
  transform: WorldTransform,
  palette: ColorPalette = LIGHT_PALETTE,
): void {
  const { stroke } = frame;
  if (stroke === null || stroke === undefined || !isOutlineVisible(stroke)) return;
  record[0] = transform.x;
  record[1] = transform.y;
  record[2] = frame.width;
  record[3] = frame.height;
  // Floats 4–9, the fill, radius and softness, stay 0: a clear, sharp, crisp box.
  record[10] = SHAPE_KIND_CODES['rounded-box'];
  record[11] = transform.cos;
  record[12] = transform.sin;
  const color = drawnColor(stroke.color, palette);
  record[13] = color[0];
  record[14] = color[1];
  record[15] = color[2];
  record[16] = color[3];
  record[17] = stroke.width;
  record[19] = strokeOutsideFraction(frame.strokeAlign);
  writeFrameCornerRadii(record, frameRadiiOf(frame));
}

/**
 * The frame stroke pass: a frame's outline, one stroke-only SDF record of its box
 * (`writeFrameStrokeRecord`), drawn with the shape pass's pipeline (`sdf-shape.wgsl`, the same
 * record, with the frame's corner radii), so it is antialiased, rounded as the frame
 * is, and aligned inside, centred or outside the edge as a shape's outline is. As in Figma, the outline paints over the frame's whole subtree: the pass is drawn
 * after descendants (`isDrawnAfterDescendants`), so the z-order segments give a stroked frame a
 * closing paint rank after its last descendant and before its next sibling, and the record sits
 * there; a nested frame's outline closes inside its parent's, so the outer outline is over it.
 * It is registered after the frame backgrounds and shadows and before every other pass, and it
 * is flagged to the z-order segments (`isOccluder`, at the closing rank), so it lands over its
 * subtree's content of later passes (shapes, images, paths, text) and over lower content an
 * outline outside the frame reaches, while a later sibling's background or shadow, flagged as
 * well, lands over it. A frame's own `clip` never cuts its outline (the clip is its
 * descendants'); its ancestors' clips do, as they cut the frame. A board without a stroked frame
 * gives the pass no record and the paint order no closing rank, so its plans are unchanged.
 * Stateless.
 */
export const FRAME_STROKE_PASS: ScenePass = {
  isRootMoveOrderStable: true,
  isRootMoveEmpty: true,
  name: FRAME_STROKE_PASS_NAME,
  isDrawnAfterDescendants: true,
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
    return isStrokedFrame(object) ? 1 : 0;
  },
  // The outline paints over whatever lies under it, its own subtree included, whatever pass drew
  // it (at the frame's closing rank).
  isOccluder: isStrokedFrame,
  prepare(record: Float32Array, target: SceneObject): void {
    const { object, transform } = target;
    if (object.type !== 'frame') return;
    writeFrameStrokeRecord(record, object, transform, paletteOf(target));
  },
};
