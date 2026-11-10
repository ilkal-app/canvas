import type { BoardObject, ImagePaint, Rgba } from '@canvas/schema';

import { SDF_SHAPE_IMAGE_MOVE_SHADER } from '../gpu/shaders/sdf-shape-image-move.generated.js';
import { SDF_SHAPE_IMAGE_SHADER } from '../gpu/shaders/sdf-shape-image.generated.js';
import {
  IMAGE_FILL_LEVEL_OF_DETAIL,
  IMAGE_FILL_TAIL_ATTRIBUTES,
} from '../images/image-fill-record.js';
import { ImageFillRecords } from '../images/image-fill-records.js';
import { readImagePaint } from '../paint/paint-reading.js';
import { IMAGE_FILL_PAGE_BINDINGS } from '../shapes/shape-image-pass.js';
import { SHAPE_QUAD_CORNER_VERTEX_LAYOUT } from '../shapes/shape-instance-layout.js';
import { SHAPE_QUAD_CORNERS, SHAPE_QUAD_VERTEX_COUNT } from '../shapes/shape-pipeline.js';

import {
  FRAME_SHAPE_ATTRIBUTES,
  FRAME_SHAPE_FLOATS,
  writeFrameBackgroundRecord,
} from './frame-shape-record.js';
import { resolveSceneInstanceLayout } from './instance-layout.js';
import type { ScenePass, ScenePassEnvironment, ScenePassFactory } from './scene-pass.js';

/** The frame-background image pass's name. */
export const RECT_IMAGE_PASS_NAME = 'rect-image';

/**
 * A frame's image background, or undefined when the object is not a frame with one the schema
 * accepts.
 *
 * @param object - The object.
 * @returns The paint, or undefined.
 */
function backgroundImageOf(object: BoardObject): ImagePaint | undefined {
  return object.type === 'frame' ? readImagePaint(object.background) : undefined;
}

/** No colour: an image background's fill, which the image tail colours. */
const CLEAR = Object.freeze([0, 0, 0, 0]) as unknown as Rgba;

/**
 * The frame image background record: the frame SDF record (its box and corner radii,
 * `FRAME_SHAPE_ATTRIBUTES`), then the image-fill tail, then the clip index the scene writes.
 */
const RECT_IMAGE_INSTANCE_LAYOUT = resolveSceneInstanceLayout([
  ...FRAME_SHAPE_ATTRIBUTES,
  ...IMAGE_FILL_TAIL_ATTRIBUTES,
]);

/**
 * Builds the pass for one renderer.
 *
 * @param environment - The renderer's environment: its backend, level of detail and images.
 * @returns The pass.
 */
function createRectImagePass(environment: ScenePassEnvironment): ScenePass {
  const records = new ImageFillRecords(RECT_IMAGE_PASS_NAME, environment, backgroundImageOf);
  return records.registerPreview({
    isRootMoveOrderStable: true,
    isRootMoveEmpty: true,
    name: RECT_IMAGE_PASS_NAME,
    layout: RECT_IMAGE_INSTANCE_LAYOUT,
    pipelineSpec: {
      shader: SDF_SHAPE_IMAGE_SHADER,
      moveShader: SDF_SHAPE_IMAGE_MOVE_SHADER,
      vertexLayout: SHAPE_QUAD_CORNER_VERTEX_LAYOUT,
      vertices: new Float32Array(SHAPE_QUAD_CORNERS),
      vertexCount: SHAPE_QUAD_VERTEX_COUNT,
      blend: 'premultiplied',
      pageBindings: IMAGE_FILL_PAGE_BINDINGS,
    },
    // Overlapping backgrounds on different pages must stay in z order.
    isPaintOrderedAcrossPages: true,
    recordCount: (object) => (backgroundImageOf(object) === undefined ? 0 : 1),
    // A frame background hides what is below it, as the solid-rect pass flags one.
    isOccluder: (object) => backgroundImageOf(object) !== undefined,
    levelOfDetail: IMAGE_FILL_LEVEL_OF_DETAIL,
    // Residency keeps each image's world bounds: it follows a translating move.
    shouldFollowTranslatedTargets: true,
    retainMoveTarget: (target) => {
      records.retain(target);
    },
    prepare(record, target) {
      const { object, transform } = target;
      if (object.type !== 'frame' || backgroundImageOf(object) === undefined) return;
      writeFrameBackgroundRecord(record, object, transform, CLEAR);
      records.write(record, target, FRAME_SHAPE_FLOATS);
    },
    pageOf: (target) => records.pageOf(target),
    pageEntries: (page) => records.pageEntries(page),
    install: (frame) => {
      records.install(frame);
    },
    forget: (id) => {
      records.forget(id);
    },
    destroy: () => {
      records.destroy();
    },
  });
}

/**
 * The image variant of the solid-rect pass: frame backgrounds that
 * are an image paint the schema accepts, each drawn as a box, rounded as the frame is, by
 * `sdf-shape-image` from the
 * renderer's shared texture manager, laid in by the paint's fit. Until a level is resident, and
 * below the level-of-detail threshold, a background draws its image's average colour. List it
 * right after `RECT_GRADIENT_PASS`; a board without an image background gives it no record.
 */
export const RECT_IMAGE_PASS: ScenePassFactory = {
  name: RECT_IMAGE_PASS_NAME,
  create: createRectImagePass,
};
