import type { BoardObject } from '@canvas/schema';

import { SDF_SHAPE_MOVE_SHADER } from '../gpu/shaders/sdf-shape-move.generated.js';
import { SHAPE_QUAD_CORNER_VERTEX_LAYOUT } from '../shapes/shape-instance-layout.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { SHAPE_QUAD_CORNERS } from '../shapes/shape-pipeline.js';
import {
  drawnShadowOf,
  drawnShadowsOf,
  shadowPlacementOf,
  shadowSilhouetteOf,
  writeObjectShadowRecord,
} from '../shapes/shape-shadow.js';

import { FRAME_SHAPE_INSTANCE_LAYOUT } from './frame-shape-record.js';
import type { ScenePass, SceneObject } from './scene-pass.js';
import type { WorldTransform } from './world-transform.js';

/** The frame shadow pass's name: the key of its instance buffer and draw list entries. */
export const FRAME_SHADOW_PASS_NAME = 'frame-shadow';

/**
 * Whether this pass draws an object: a frame whose background paints and which has a drop shadow
 * (`drawnShadowOf`).
 *
 * @param object - The object.
 * @returns True for a shadowed frame.
 */
function isShadowedFrame(object: BoardObject): boolean {
  return object.type === 'frame' && drawnShadowOf(object) !== undefined;
}

/**
 * The frame shadow pass: a frame's drop shadow, one soft SDF record of its box
 * (`writeObjectShadowRecord`), rounded as the frame is, drawn with the shape pass's
 * shader (`sdf-shape.wgsl`, the frame SDF record, `FRAME_SHAPE_INSTANCE_LAYOUT`). It is
 * registered first, before the frame backgrounds (`SOLID_RECT_PASS`, `RECT_GRADIENT_PASS`):
 * passes draw in registered order within a z-order segment, so a shadow
 * drawn by the shape pass would land over its own frame's background. Drawn first, a frame's
 * shadow lands under its background and everything else in its segment; it is flagged to the
 * z-order segments (`isOccluder`), so where the shadowed frame's bounds (which take the shadow
 * in, `worldBoundsOf`) meet content of the segment below it in any pass, it starts a segment and
 * its shadow covers that content. Content above the frame (its children, later siblings) shares
 * its segment only when a pass order keeps it on top, else starts its own. A frame's own `clip`
 * never cuts its shadow (the clip is its descendants'); its ancestors' clips do, as they
 * cut the frame. A board without a shadowed frame gives the pass no record. Stateless.
 */
export const FRAME_SHADOW_PASS: ScenePass = {
  isRootMoveOrderStable: true,
  isRootMoveEmpty: true,
  name: FRAME_SHADOW_PASS_NAME,
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
    return object.type === 'frame' ? drawnShadowsOf(object).length : 0;
  },
  // The shadow paints over whatever lies under the frame, whatever pass drew it.
  isOccluder: isShadowedFrame,
  // Each layer sits where `writeObjectShadowRecord` puts it, for a retained move.
  movePlacement({ object, transform }: SceneObject, recordIndex: number): WorldTransform {
    const shadow = drawnShadowsOf(object)[recordIndex];
    const silhouette = shadow === undefined ? undefined : shadowSilhouetteOf(object);
    return shadow === undefined || silhouette === undefined
      ? transform
      : shadowPlacementOf(shadow, silhouette, transform);
  },
  prepare(record: Float32Array, { object, transform }: SceneObject, recordIndex: number): void {
    // One record per drawn layer, the first lowest.
    writeObjectShadowRecord(record, object, transform, recordIndex);
  },
};
