import type { BoardObject, Rgba } from '@canvas/schema';

import type { ScenePass, SceneObject } from '../scene-pass.js';
import { SOLID_RECT_PASS } from '../solid-rect-pass.js';

/**
 * The colour a filled rectangle shape or a frame background is drawn with, or null.
 *
 * @param object - The object.
 * @returns The colour, or null when the fixture pass does not draw the object.
 */
function filledColorOf(object: BoardObject): Rgba | null {
  const paint =
    object.type === 'frame'
      ? object.background
      : object.type === 'shape' && object.kind === 'rectangle'
        ? object.fill
        : null;
  return Array.isArray(paint) ? paint : null;
}

/**
 * A pipeline without its retained-move shader variant.
 *
 * @param spec - The pipeline.
 * @returns A copy of it with no `moveShader`.
 */
function withoutMoveShader(spec: ScenePass['pipelineSpec']): ScenePass['pipelineSpec'] {
  const copy: { -readonly [K in keyof typeof spec]: (typeof spec)[K] } = { ...spec };
  delete copy.moveShader;
  return copy;
}

/**
 * The solid-rect pass as it was before moved every shape to the SDF shape pass: one flat
 * quad per frame background or filled rectangle shape, named `solid-rect`, with the solid-rect
 * record and pipeline. The scene's own tests (slots, uploads, culling, draw lists) use it as their
 * simplest pass over shape fixtures; what the real passes draw is tested beside each pass.
 */
export const FILLED_RECT_PASS: ScenePass = {
  ...SOLID_RECT_PASS,
  // A custom pass with no retained-move variant (the real solid-rect pass has one).
  pipelineSpec: withoutMoveShader(SOLID_RECT_PASS.pipelineSpec),
  isRootMoveEmpty: false,
  recordCount(object: BoardObject): number {
    return filledColorOf(object) === null ? 0 : 1;
  },
  isOccluder(object: BoardObject): boolean {
    return filledColorOf(object) !== null;
  },
  prepare(record: Float32Array, { object, transform }: SceneObject): void {
    const color = filledColorOf(object);
    if (color === null || !('width' in object)) return;
    record.set([transform.x, transform.y, object.width, object.height, transform.cos]);
    record.set([transform.sin, color[0], color[1], color[2], color[3]], 5);
  },
};
