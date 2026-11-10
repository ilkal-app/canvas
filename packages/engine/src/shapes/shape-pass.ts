import type { BoardObject } from '@canvas/schema';

import { SDF_SHAPE_MOVE_SHADER } from '../gpu/shaders/sdf-shape-move.generated.js';
import { SDF_SHAPE_SHADER } from '../gpu/shaders/sdf-shape.generated.js';
import { paletteOf } from '../paint/color-palette.js';
import { readSolid } from '../paint/paint-reading.js';
import { resolveSceneInstanceLayout } from '../scene/instance-layout.js';
import type { ScenePass, ScenePassFactory, SceneObject } from '../scene/scene-pass.js';
import type { WorldTransform } from '../scene/world-transform.js';

import {
  linkCardRecordCount,
  linkCardRecordPlacement,
  writeLinkCardRecord,
} from './link-card-records.js';
import { createFlatFormPass } from './shape-flat-form.js';
import { SHAPE_INSTANCE_VERTEX_LAYOUT, SHAPE_QUAD_VERTEX_LAYOUT } from './shape-instance-layout.js';
import type { ShapeColor } from './shape-instance.js';
import {
  isPaintedGradientShape,
  isPaintedImageShape,
  isPaintedShapeObject,
  writeShapeRecord,
} from './shape-object-record.js';
import { SHAPE_QUAD_VERTEX_COUNT, SHAPE_QUAD_VERTICES } from './shape-pipeline.js';
import {
  drawnShadowsOf,
  shadowPlacementOf,
  shadowSilhouetteOf,
  writeObjectShadowRecord,
} from './shape-shadow.js';
import { NOTE_CORNER_RADIUS, NOTE_SHADOW } from './sticky-note.js';

/** The shape pass's name: the key of its instance buffer and draw list entries. */
export const SDF_SHAPE_PASS_NAME = 'sdf-shape';

/**
 * Whether a shape paints and its fill is neither a gradient nor an image: this pass's (a gradient-
 * or image-filled shape is the gradient or image shape pass's, with its outline).
 *
 * @param object - The object.
 * @returns True when this pass draws it.
 */
function isSolidPaintedShape(object: BoardObject): boolean {
  return (
    isPaintedShapeObject(object) && !isPaintedGradientShape(object) && !isPaintedImageShape(object)
  );
}

/** Records a sticky note draws with: its shadow, then its fill (`noteInstances`). */
const NOTE_RECORD_COUNT = 2;

/**
 * Writes where one rounded box of a note goes into a record (the layout of
 * `SHAPE_INSTANCE_FLOATS`): a box given in the note's own frame, placed in the world by the
 * note's transform, so it turns with the note, and the turn as the record's axis. Field by field:
 * it runs for every changed note, so it allocates nothing.
 *
 * @param record - The record, zero-filled.
 * @param transform - The note's frame to the world.
 * @param left - The box's left edge in the note's frame, world units.
 * @param top - Its top edge.
 * @param width - Its width.
 * @param height - Its height.
 */
function writeNoteBox(
  record: Float32Array,
  transform: WorldTransform,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  const { cos, sin } = transform;
  record[0] = transform.x + cos * left - sin * top;
  record[1] = transform.y + sin * left + cos * top;
  record[2] = width;
  record[3] = height;
  // Floats 4–10 are the look, written by the caller; 10, the kind, stays 0: a rounded box.
  record[11] = cos;
  record[12] = sin;
}

/**
 * Writes a box's look into a record: its straight-alpha colour, corner radius and softness.
 *
 * @param record - The record.
 * @param color - The colour.
 * @param radius - The corner radius, world units.
 * @param softness - The edge's blur half-width, world units.
 */
function writeLook(
  record: Float32Array,
  color: ShapeColor,
  radius: number,
  softness: number,
): void {
  record[4] = color[0];
  record[5] = color[1];
  record[6] = color[2];
  record[7] = color[3];
  record[8] = radius;
  record[9] = softness;
}

/**
 * The SDF shape pass: the shape shader of `sdf-shape.wgsl` as a scene pass, one
 * instanced unit quad per record (`SHAPE_QUAD_VERTICES`, the record `SHAPE_INSTANCE_BYTES`),
 * through the engine's camera uniform. It draws sticky notes, each as `noteInstances` does, two
 * records turned with the note: the lifted shadow, then the fill with its rounded corners; a note
 * is an opaque occluder, so the z-order segments hide what is under it, the text of a note below
 * included. It draws shape objects too, every kind, filled rectangles included
 * (`writeShapeRecord`): one record each with a fill or an outline that paints (`isPaintedShape`),
 * and before it, for a painted shape with a drop shadow (`drawnShadowOf`), the shadow's
 * soft record (`writeObjectShadowRecord`), a gradient-filled shape's included, whose body the
 * gradient pass draws. Within the pass records draw in paint order, so a shadow lands over every
 * shape below its shape and under every shape above it, and the z-order segments order it against
 * other passes' content by the shape's bounds, which take the shadow in (`worldBoundsOf`). Every
 * painted shape is flagged to the z-order segments, translucent and unfilled ones too: what it
 * paints must land over the content below it, even text or an image a later pass draws
 * (`ScenePass.isOccluder`). The value itself is stateless and draws every object in full; a
 * renderer builds it through `create`, which adds the level of detail: an object under 4 device
 * pixels draws flat in its average colour (`createFlatFormPass`).
 */
const FULL_SHAPE_PASS: ScenePass = {
  isRootMoveOrderStable: true,
  name: SDF_SHAPE_PASS_NAME,
  layout: resolveSceneInstanceLayout(SHAPE_INSTANCE_VERTEX_LAYOUT.attributes),
  pipelineSpec: {
    shader: SDF_SHAPE_SHADER,
    moveShader: SDF_SHAPE_MOVE_SHADER,
    vertexLayout: SHAPE_QUAD_VERTEX_LAYOUT,
    vertices: new Float32Array(SHAPE_QUAD_VERTICES),
    vertexCount: SHAPE_QUAD_VERTEX_COUNT,
    blend: 'premultiplied',
  },
  recordCount(object: BoardObject): number {
    if (object.type === 'shape') {
      return (isSolidPaintedShape(object) ? 1 : 0) + drawnShadowsOf(object).length;
    }
    if (object.type === 'link') return linkCardRecordCount(object);
    return object.type === 'sticky' ? NOTE_RECORD_COUNT : 0;
  },
  // A note's paper, or anything a shape paints (a translucent fill, an outline alone), must draw
  // over what is below it, whatever pass drew that.
  isOccluder(object: BoardObject): boolean {
    return object.type === 'sticky' || object.type === 'link' || isSolidPaintedShape(object);
  },
  movePlacement(target: SceneObject, recordIndex: number): WorldTransform {
    const { object, transform } = target;
    if (object.type === 'link') {
      return linkCardRecordPlacement(object, transform, paletteOf(target), recordIndex);
    }
    if (object.type === 'shape') {
      // Each drawn shadow layer is a record under the body, the first lowest.
      const shadow = drawnShadowsOf(object)[recordIndex];
      const silhouette = shadow === undefined ? undefined : shadowSilhouetteOf(object);
      return shadow === undefined || silhouette === undefined
        ? transform
        : shadowPlacementOf(shadow, silhouette, transform);
    }
    if (object.type !== 'sticky') return transform;
    const left = recordIndex === 0 ? NOTE_SHADOW.insetX : 0;
    const top = recordIndex === 0 ? NOTE_SHADOW.offsetTop : 0;
    const { cos, sin } = transform;
    // Same f64 arithmetic as writeNoteBox, before the table/record float32 boundary.
    return {
      x: transform.x + cos * left - sin * top,
      y: transform.y + sin * left + cos * top,
      cos,
      sin,
    };
  },
  prepare(record: Float32Array, target: SceneObject, recordIndex: number): void {
    const { object, transform } = target;
    if (object.type === 'shape') {
      // Its drop shadow layers are the shape's first records, under its body.
      if (recordIndex < drawnShadowsOf(object).length) {
        writeObjectShadowRecord(record, object, transform, recordIndex);
      } else writeShapeRecord(record, object, transform, paletteOf(target));
      return;
    }
    if (object.type === 'link') {
      writeLinkCardRecord(record, object, transform, paletteOf(target), recordIndex);
      return;
    }
    if (object.type !== 'sticky') return;
    const { width, height } = object;
    if (recordIndex === 0) {
      // The shadow: inset at the sides and dropped below the note (`noteInstances`).
      const { insetX, offsetTop, offsetBottom } = NOTE_SHADOW;
      const shadowWidth = Math.max(0, width - 2 * insetX);
      const shadowHeight = Math.max(0, height - offsetTop + offsetBottom);
      writeNoteBox(record, transform, insetX, offsetTop, shadowWidth, shadowHeight);
      writeLook(record, NOTE_SHADOW.color, NOTE_SHADOW.radius, NOTE_SHADOW.softness);
      return;
    }
    writeNoteBox(record, transform, 0, 0, width, height);
    writeLook(record, readSolid(object.color, paletteOf(target)), NOTE_CORNER_RADIUS, 0);
  },
};

/**
 * Whether a shape pass record is a shadow: a shape's drawn drop shadows come first, and a note's
 * lifted shadow is its record 0.
 *
 * @param object - The object.
 * @param recordIndex - Its record.
 * @returns True for a shadow record.
 */
function isShadowRecord(object: BoardObject, recordIndex: number): boolean {
  if (object.type === 'shape') return recordIndex < drawnShadowsOf(object).length;
  return object.type === 'sticky' && recordIndex === 0;
}

/**
 * The SDF shape pass: as a value, the stateless pass drawing every object in full; as a factory,
 * what a renderer builds, the same pass with its level of detail.
 */
export const SDF_SHAPE_PASS: ScenePass & ScenePassFactory = {
  ...FULL_SHAPE_PASS,
  create: (environment) => createFlatFormPass(FULL_SHAPE_PASS, isShadowRecord, environment),
};
