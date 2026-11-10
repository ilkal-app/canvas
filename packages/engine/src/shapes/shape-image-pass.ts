import type { BoardObject, ImagePaint } from '@canvas/schema';

import type { GpuBindingLayoutEntry } from '../gpu/gpu-pipeline.js';
import { SDF_SHAPE_IMAGE_MOVE_SHADER } from '../gpu/shaders/sdf-shape-image-move.generated.js';
import { SDF_SHAPE_IMAGE_SHADER } from '../gpu/shaders/sdf-shape-image.generated.js';
import {
  IMAGE_FILL_LEVEL_OF_DETAIL,
  IMAGE_FILL_TAIL_ATTRIBUTES,
} from '../images/image-fill-record.js';
import { ImageFillRecords } from '../images/image-fill-records.js';
import { IMAGE_SAMPLER_BINDING, IMAGE_TEXTURE_BINDING } from '../images/texture-pages.js';
import { paletteOf } from '../paint/color-palette.js';
import { readImagePaint } from '../paint/paint-reading.js';
import { resolveSceneInstanceLayout } from '../scene/instance-layout.js';
import type { ScenePass, ScenePassEnvironment, ScenePassFactory } from '../scene/scene-pass.js';

import {
  SHAPE_INSTANCE_FLOATS,
  SHAPE_INSTANCE_VERTEX_LAYOUT,
  SHAPE_QUAD_VERTEX_LAYOUT,
} from './shape-instance-layout.js';
import { isPaintedImageShape, writeShapeRecord } from './shape-object-record.js';
import { SHAPE_QUAD_VERTEX_COUNT, SHAPE_QUAD_VERTICES } from './shape-pipeline.js';

/** The image shape pass's name. */
export const SDF_SHAPE_IMAGE_PASS_NAME = 'sdf-shape-image';

/**
 * The image-fill record (`sdf-shape-image`): the SDF shape record (`SHAPE_INSTANCE_FLOATS`), its
 * placeholder colour at floats 4 to 7, then the image-fill tail (`writeImageFillTail`) at
 * locations 8 to 11, then the clip index the scene writes (`resolveSceneInstanceLayout`).
 */
export const SHAPE_IMAGE_INSTANCE_LAYOUT = resolveSceneInstanceLayout([
  ...SHAPE_INSTANCE_VERTEX_LAYOUT.attributes,
  ...IMAGE_FILL_TAIL_ATTRIBUTES,
]);

/** The image-fill passes' page bindings: the image pass's texture and sampler. */
export const IMAGE_FILL_PAGE_BINDINGS: readonly GpuBindingLayoutEntry[] = [
  { binding: IMAGE_TEXTURE_BINDING, kind: 'texture', samplerBinding: IMAGE_SAMPLER_BINDING },
  { binding: IMAGE_SAMPLER_BINDING, kind: 'sampler' },
];

/**
 * A shape's image paint, or undefined when the object is not a shape with one the schema accepts.
 *
 * @param object - The object.
 * @returns The paint, or undefined.
 */
function shapeImageOf(object: BoardObject): ImagePaint | undefined {
  return object.type === 'shape' ? readImagePaint(object.fill) : undefined;
}

/**
 * Builds the pass for one renderer.
 *
 * @param environment - The renderer's environment: its backend, level of detail and images.
 * @returns The pass.
 */
function createShapeImagePass(environment: ScenePassEnvironment): ScenePass {
  const records = new ImageFillRecords(SDF_SHAPE_IMAGE_PASS_NAME, environment, shapeImageOf);
  const pass: ScenePass = {
    isRootMoveOrderStable: true,
    name: SDF_SHAPE_IMAGE_PASS_NAME,
    layout: SHAPE_IMAGE_INSTANCE_LAYOUT,
    pipelineSpec: {
      shader: SDF_SHAPE_IMAGE_SHADER,
      moveShader: SDF_SHAPE_IMAGE_MOVE_SHADER,
      vertexLayout: SHAPE_QUAD_VERTEX_LAYOUT,
      vertices: new Float32Array(SHAPE_QUAD_VERTICES),
      vertexCount: SHAPE_QUAD_VERTEX_COUNT,
      blend: 'premultiplied',
      pageBindings: IMAGE_FILL_PAGE_BINDINGS,
    },
    // Overlapping fills on different pages must stay in z order.
    isPaintOrderedAcrossPages: true,
    recordCount: (object) => (isPaintedImageShape(object) ? 1 : 0),
    // As the SDF shape pass: anything a shape paints lands over later-pass content below it.
    isOccluder: isPaintedImageShape,
    levelOfDetail: IMAGE_FILL_LEVEL_OF_DETAIL,
    // Residency keeps each image's world bounds: it follows a translating move.
    shouldFollowTranslatedTargets: true,
    retainMoveTarget: (target) => {
      records.retain(target);
    },
    prepare(record, target) {
      const { object, transform } = target;
      if (object.type !== 'shape' || shapeImageOf(object) === undefined) return;
      writeShapeRecord(record, object, transform, paletteOf(target));
      records.write(record, target, SHAPE_INSTANCE_FLOATS);
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
  };
  return records.registerPreview(records.guardRootMoves(pass));
}

/**
 * The image variant of the SDF shape pass: shapes whose fill is an
 * image paint the schema accepts, each one record of the SDF shape record and its image-fill
 * tail, drawn by `sdf-shape-image` (the solid shader's SDF, corners and coverage, with the fill's
 * colour from the image's resident level at the fragment's point of the box, laid in by the
 * paint's fit); the outline as the solid pass draws it. It draws from the renderer's shared
 * texture manager (`SharedImageResidency`), so fills and image objects share one budget. Until a
 * level is resident, and below the level-of-detail threshold (`IMAGE_FILL_LEVEL_OF_DETAIL`), a
 * fill draws its image's average colour. List it right after `SDF_SHAPE_GRADIENT_PASS`; a board
 * without an image fill gives it no record.
 */
export const SDF_SHAPE_IMAGE_PASS: ScenePassFactory = {
  name: SDF_SHAPE_IMAGE_PASS_NAME,
  create: createShapeImagePass,
};
