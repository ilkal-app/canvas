import type { BoardObject, Rgba } from '@canvas/schema';

import { SOLID_RECT_MOVE_SHADER } from '../gpu/shaders/solid-rect-move.generated.js';
import { SOLID_RECT_SHADER } from '../gpu/shaders/solid-rect.generated.js';
import type { GpuVertexAttribute } from '../gpu/vertex-layout.js';
import { paletteOf, type ColorPalette } from '../paint/color-palette.js';
import { readFill } from '../paint/paint-reading.js';

import { isRoundedFrame } from './frame-shape-record.js';
import { resolveSceneInstanceLayout } from './instance-layout.js';
import type { ScenePass, SceneObject } from './scene-pass.js';
import type { WorldTransform } from './world-transform.js';

/** The unit square as two triangles, corners in [0, 1]². */
const UNIT_QUAD = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);

/**
 * The colour a solid rectangle is drawn with, or null when this pass does not draw the object:
 * a frame's solid background (a gradient one is the rect-gradient pass's, and
 * one the schema refuses is no background). Every shape, filled rectangles included, is the SDF
 * shape pass's, so a shape draws once, with its outline and corners; a frame with a
 * rounded corner is the rounded-rect pass's. A colour token
 * background is its value in the palette; whether there is one does not depend on it.
 *
 * @param object - The object.
 * @param palette - What tokens draw as; default the light theme's built-ins.
 * @returns The straight-alpha colour, or null.
 */
function solidColorOf(object: BoardObject, palette?: ColorPalette): Rgba | null {
  if (object.type !== 'frame' || isRoundedFrame(object)) return null;
  const paint = readFill(object.background, palette);
  return Array.isArray(paint) ? paint : null;
}

/**
 * Writes a solid-rect record, field by field (it runs for every changed object, so it allocates
 * nothing): the box's origin and size, its turn and its straight-alpha colour.
 *
 * @param record - The record, zero-filled.
 * @param box - The box's size, world units.
 * @param box.width - Its width.
 * @param box.height - Its height.
 * @param transform - Its frame to the world.
 * @param color - The colour.
 */
export function writeRectRecord(
  record: Float32Array,
  box: { readonly width: number; readonly height: number },
  transform: WorldTransform,
  color: Rgba,
): void {
  record[0] = transform.x;
  record[1] = transform.y;
  record[2] = box.width;
  record[3] = box.height;
  record[4] = transform.cos;
  record[5] = transform.sin;
  record[6] = color[0];
  record[7] = color[1];
  record[8] = color[2];
  record[9] = color[3];
}

/**
 * The solid-rect record's own attributes, before the clip index the scene appends: origin
 * (`@location(1)`), size (`@location(2)`), rotation axis (`@location(3)`) and straight-alpha
 * colour (`@location(4)`), 10 floats; the rect-gradient record starts with them.
 */
export const SOLID_RECT_ATTRIBUTES: readonly GpuVertexAttribute[] = Object.freeze([
  { location: 1, format: 'float32x2' },
  { location: 2, format: 'float32x2' },
  { location: 3, format: 'float32x2' },
  { location: 4, format: 'float32x4' },
]);

/**
 * The solid-rect pass: flat-colour quads for frame backgrounds, one instance each, placed by the
 * object's world transform (the prototype's `rectRenderer.ts`, with rotation and a persistent
 * buffer). Record: origin (float32x2, world units), size (float32x2, world units), rotation axis
 * (cos, sin), straight-alpha colour (float32x4), then the clip index the scene writes.
 */
export const SOLID_RECT_PASS: ScenePass = {
  isRootMoveOrderStable: true,
  name: 'solid-rect',
  isRootMoveEmpty: true,
  layout: resolveSceneInstanceLayout(SOLID_RECT_ATTRIBUTES),
  pipelineSpec: {
    shader: SOLID_RECT_SHADER,
    moveShader: SOLID_RECT_MOVE_SHADER,
    vertexLayout: { stepMode: 'vertex', attributes: [{ location: 0, format: 'float32x2' }] },
    vertices: UNIT_QUAD,
    vertexCount: 6,
    blend: 'premultiplied',
  },
  recordCount(object: BoardObject): number {
    return solidColorOf(object) === null ? 0 : 1;
  },
  // A frame background hides what is below it: each is an occluder.
  isOccluder(object: BoardObject): boolean {
    return solidColorOf(object) !== null;
  },
  prepare(record: Float32Array, target: SceneObject): void {
    const { object, transform } = target;
    const color = solidColorOf(object, paletteOf(target));
    if (object.type !== 'frame' || color === null) return;
    writeRectRecord(record, object, transform, color);
  },
};
