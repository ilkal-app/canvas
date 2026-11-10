import type { BoardObject, ObjectId } from '@canvas/schema';

import type { PassLevelOfDetail } from '../lod/lod-pass-state.js';
import { SHAPE_LOD_RULE } from '../lod/lod-thresholds.js';
import type { SceneObject, ScenePass, ScenePassEnvironment } from '../scene/scene-pass.js';

import { SHAPE_FLAT_KIND_CODE, SHAPE_KIND_CODES } from './shape-instance-layout.js';

/**
 * The SDF shape pass's level of detail: shapes and sticky notes measured by the longer
 * side of their box, flat in their average colour below `SHAPE_FLAT_EDGE_PX` (`SHAPE_LOD_RULE`).
 */
export const SHAPE_LEVEL_OF_DETAIL: PassLevelOfDetail = {
  rule: SHAPE_LOD_RULE,
  sizeOf: (object) =>
    object.type === 'shape' || object.type === 'sticky' ? Math.max(object.width, object.height) : 0,
  isSameSize: (previous, next) =>
    'width' in previous &&
    'width' in next &&
    previous.width === next.width &&
    previous.height === next.height,
};

/**
 * One float of a record; a record shorter than the layout reads 0 past its end.
 *
 * @param record - The record.
 * @param index - The float's index.
 * @returns Its value.
 */
function floatAt(record: Float32Array, index: number): number {
  return record[index] ?? 0;
}

/**
 * How much of its box a shape of a kind covers, so that its flat form keeps its average tone: a
 * rounded box all of it less its corners, an ellipse π/4, the pointed kinds about half.
 *
 * @param kind - The record's kind code (`SHAPE_KIND_CODES`).
 * @param width - The box's width, world units.
 * @param height - The box's height, world units.
 * @param radius - A rounded box's corner radius, world units.
 * @returns The fraction, 0 to 1.
 */
function areaFractionOf(kind: number, width: number, height: number, radius: number): number {
  if (kind === SHAPE_KIND_CODES['rounded-box']) {
    if (width <= 0 || height <= 0) return 1;
    const corner = Math.min(radius, width / 2, height / 2);
    return 1 - ((4 - Math.PI) * corner * corner) / (width * height);
  }
  return kind === SHAPE_KIND_CODES.ellipse ? Math.PI / 4 : 0.5;
}

/**
 * How much of its box an outline alone covers: the box less what lies more than the outline's
 * width inside its edge.
 *
 * @param width - The box's width, world units.
 * @param height - The box's height, world units.
 * @param outline - The outline's width, world units.
 * @returns The fraction, 0 to 1.
 */
function ringFractionOf(width: number, height: number, outline: number): number {
  if (width <= 0 || height <= 0) return 1;
  const inner = Math.max(0, width - 2 * outline) * Math.max(0, height - 2 * outline);
  return 1 - inner / (width * height);
}

/**
 * Turns a full shape record into its flat form in place: kind `SHAPE_FLAT_KIND_CODE`,
 * no radius, softness or outline, the box and turn kept. A body takes its fill's colour at its
 * alpha times its kind's area fraction, or, when only the outline paints, the outline's colour
 * at its alpha times that fraction and the ring's share of the box; a shadow is made clear, so it
 * draws nothing.
 *
 * @param record - A record `writeShapeRecord`, `writeObjectShadowRecord` or the note writers
 *   filled; rewritten in place.
 * @param isShadow - Whether the record is a shadow (a shape's drop shadow, a note's lifted one).
 */
export function writeFlatShapeRecord(record: Float32Array, isShadow: boolean): void {
  const fraction = areaFractionOf(
    floatAt(record, 10),
    floatAt(record, 2),
    floatAt(record, 3),
    floatAt(record, 8),
  );
  const isFillPainted = floatAt(record, 7) > 0;
  const isOutlinePainted = floatAt(record, 17) > 0 && floatAt(record, 16) > 0;
  if (!isFillPainted && isOutlinePainted) record.copyWithin(4, 13, 17);
  const alpha = isShadow || (!isFillPainted && !isOutlinePainted) ? 0 : floatAt(record, 7);
  const ring = isFillPainted
    ? 1
    : ringFractionOf(floatAt(record, 2), floatAt(record, 3), floatAt(record, 17));
  record[7] = alpha * fraction * ring;
  record[8] = 0;
  record[9] = 0;
  record[10] = SHAPE_FLAT_KIND_CODE;
  record[17] = 0;
}

/**
 * Builds a renderer's SDF shape pass with its level of detail: the stateless pass's
 * records, flat for an object in `average-color`, and a rewrite of every object whose form changed
 * before the frame's upload.
 *
 * @param base - The stateless pass, which writes the full records.
 * @param isShadowRecord - Whether an object's record is one of its shadows.
 * @param environment - The renderer's environment, whose level of detail gives each form.
 * @returns The pass.
 */
export function createFlatFormPass(
  base: ScenePass,
  isShadowRecord: (object: BoardObject, recordIndex: number) => boolean,
  environment: ScenePassEnvironment,
): ScenePass {
  const { levelOfDetail } = environment;
  /** Each drawn object's last target, to rewrite it when its form changes. */
  const targets = new Map<ObjectId, SceneObject>();
  const rewrites = new Set<SceneObject>();
  return {
    ...base,
    levelOfDetail: SHAPE_LEVEL_OF_DETAIL,
    prepare(record, target, recordIndex) {
      base.prepare(record, target, recordIndex);
      const { object } = target;
      if (levelOfDetail === undefined) return;
      if (recordIndex === 0) targets.set(object.id, target);
      if (levelOfDetail.formOf(base.name, object.id) !== 'average-color') return;
      writeFlatShapeRecord(record, isShadowRecord(object, recordIndex));
    },
    retainMoveTarget(target) {
      if (targets.has(target.object.id)) targets.set(target.object.id, target);
    },
    install(frame) {
      if (levelOfDetail === undefined) return;
      frame.wrapStage('uploadDirtyRanges', (inner) => ({
        name: inner.name,
        run: (context) => {
          for (const id of levelOfDetail.changedIn(base.name)) {
            const target = targets.get(id);
            if (target !== undefined) rewrites.add(target);
          }
          if (rewrites.size > 0) context.scene.rewriteRecords(base.name, rewrites);
          rewrites.clear();
          inner.run(context);
        },
      }));
    },
    forget(id) {
      targets.delete(id);
    },
  };
}
