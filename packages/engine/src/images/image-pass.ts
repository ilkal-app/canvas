import { fittedImageRect, type ObjectId } from '@canvas/schema';

import { IMAGE_MOVE_SHADER } from '../gpu/shaders/image-move.generated.js';
import { IMAGE_SHADER } from '../gpu/shaders/image.generated.js';
import type { PassLevelOfDetail } from '../lod/level-of-detail.js';
import { IMAGE_LOD_RULE } from '../lod/lod-thresholds.js';
import { resolveSceneInstanceLayout } from '../scene/instance-layout.js';
import { registerRootMoveBatchGuard } from '../scene/root-move-batch-guards.js';
import type {
  SceneObject,
  ScenePass,
  ScenePassEnvironment,
  ScenePassFactory,
  ScenePipelineSpec,
} from '../scene/scene-pass.js';

import { imageRecordCount } from './bind-image.js';
import {
  pageOfPart,
  placeholderBinding,
  writeImageRecord,
  type ImageBinding,
} from './image-binding.js';
import type { ImagePassSupport } from './image-pass-support.js';
import { registerImagePassPreview } from './image-preview-registry.js';
import { SharedImageResidency } from './shared-image-residency.js';
import { IMAGE_SAMPLER_BINDING, IMAGE_TEXTURE_BINDING } from './texture-pages.js';

/** The image pass's name: its instance buffer and draw list entries. */
export const IMAGE_PASS_NAME = 'image';

/** The name of the shared image frame stage, after `collectChanges`. */
export { IMAGE_STAGE_NAME } from './shared-image-residency.js';

/** The unit square as two triangles, corners in [0, 1]². */
const UNIT_QUAD = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);

/**
 * The image pass's record (`image.wgsl`): placement (world origin, cos, sin), the quad in the
 * object's frame (x, y, width, height), the page UVs at its corners, the page rectangle samples
 * stay in, the placeholder colour, (opacity, texture weight), then the clip index the scene
 * writes (`resolveSceneInstanceLayout`). 23 floats, 92 bytes. The opacity float is 1: the image's
 * opacity is the record's trailing transparency, as every object's is.
 */
export const IMAGE_INSTANCE_LAYOUT = resolveSceneInstanceLayout([
  { location: 1, format: 'float32x4' },
  { location: 2, format: 'float32x4' },
  { location: 3, format: 'float32x4' },
  { location: 4, format: 'float32x4' },
  { location: 5, format: 'float32x4' },
  { location: 6, format: 'float32x2' },
]);

/** The image pass's pipeline: the image shader, one unit quad per record, a page per texture. */
const IMAGE_PIPELINE_SPEC: ScenePipelineSpec = {
  shader: IMAGE_SHADER,
  moveShader: IMAGE_MOVE_SHADER,
  vertexLayout: { stepMode: 'vertex', attributes: [{ location: 0, format: 'float32x2' }] },
  vertices: UNIT_QUAD,
  vertexCount: 6,
  blend: 'premultiplied',
  pageBindings: [
    { binding: IMAGE_TEXTURE_BINDING, kind: 'texture', samplerBinding: IMAGE_SAMPLER_BINDING },
    { binding: IMAGE_SAMPLER_BINDING, kind: 'sampler' },
  ],
};

/**
 * The image pass's level-of-detail rule: an image whose fitted longer edge is under 8
 * device pixels draws its average colour, with a 20% band (`IMAGE_LOD_RULE`). The texture manager
 * is not told: it keeps the image's smallest level resident and counts it drawn, so returning to
 * the texture is immediate and the image is never blank.
 */
export const IMAGE_LEVEL_OF_DETAIL: PassLevelOfDetail = {
  rule: IMAGE_LOD_RULE,
  sizeOf: (object) => {
    if (object.type !== 'image') return 0;
    const drawn = fittedImageRect(object);
    return Math.max(drawn.width, drawn.height);
  },
  isSameSize: (previous, next) =>
    previous.type === 'image' &&
    next.type === 'image' &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.crop.width === next.crop.width &&
    previous.crop.height === next.crop.height &&
    previous.naturalSize.width === next.naturalSize.width &&
    previous.naturalSize.height === next.naturalSize.height,
};

/**
 * Builds the image pass for one renderer, on the renderer's shared texture manager
 * (`SharedImageResidency`): the image-fill passes draw from the same one, reading the
 * environment's catalogue (so after a device loss the new renderer restarts at once from the
 * smallest levels) and reporting to its ledger.
 *
 * @param environment - The backend, the host's hooks, the ledger, the budget and images.
 * @returns The pass.
 */
function createImagePass(environment: ScenePassEnvironment): ScenePass {
  const { levelOfDetail } = environment;
  /** Each image's last target, to rewrite it when its level of detail changes. */
  const targets = new Map<ObjectId, SceneObject>();
  const holder = { passName: IMAGE_PASS_NAME, targets };
  const residency = SharedImageResidency.join(environment, holder);
  // Created now, as before: a host hears of the manager when its renderer is built.
  const { manager } = residency;
  /**
   * What an image draws: its binding, or its average colour in the cheap form.
   *
   * @param id - The image.
   * @returns The binding to write.
   */
  const bindingOf = (id: ObjectId): ImageBinding => {
    const binding = manager.bindingOf(id);
    const isAverage = levelOfDetail?.formOf(IMAGE_PASS_NAME, id) === 'average-color';
    return isAverage ? placeholderBinding(binding.color) : binding;
  };
  const pass: ScenePass = {
    isRootMoveOrderStable: true,

    name: IMAGE_PASS_NAME,
    layout: IMAGE_INSTANCE_LAYOUT,
    pipelineSpec: IMAGE_PIPELINE_SPEC,
    // Overlapping images on different textures must stay in z order.
    isPaintOrderedAcrossPages: true,
    recordCount: (object) => (object.type === 'image' ? imageRecordCount(object) : 0),
    // Flagged at any opacity above 0: a half-transparent image still paints, and must land over
    // text or a line below it that a later pass draws (`ScenePass.isOccluder`).
    isOccluder: (object) => object.type === 'image' && object.opacity > 0,
    levelOfDetail: IMAGE_LEVEL_OF_DETAIL,
    // Residency keeps each image's world bounds: it follows a translating move.
    shouldFollowTranslatedTargets: true,
    retainMoveTarget: (target) => {
      retainImageTarget(target, residency, holder);
    },
    prepare(record, target, recordIndex) {
      if (recordIndex === 0) {
        residency.track(holder, target);
        targets.set(target.object.id, target);
      }
      writeImageRecord(record, target, bindingOf(target.object.id), recordIndex);
    },
    // The average colour samples nothing, so it stays on its level's page: the form's changes
    // move no record between pages, and so no image starts a z-order segment.
    pageOf: (target, recordIndex) => pageOfPart(manager.bindingOf(target.object.id), recordIndex),
    pageEntries: (page) => manager.pageEntries(page),
    install(frame) {
      residency.install(frame);
    },
    forget: (id) => {
      residency.forget(holder, id);
      targets.delete(id);
    },
    destroy: () => {
      residency.leave(holder);
    },
  };
  registerImagePassPreview(
    pass,
    () => manager,
    () =>
      [...targets.keys()].every(
        (id) => levelOfDetail?.formOf(IMAGE_PASS_NAME, id) !== 'average-color',
      ),
  );
  return guardImageRootMoves(pass, targets, residency.support.catalogue);
}

/**
 * The image pass: one record per image object, or one per visible tile of an image large
 * enough to be tiled, drawn with the level the texture manager has resident: from its own texture
 * or an atlas page (`pageOf`), cropped by the object's `crop` and faded by its opacity through the
 * record's trailing transparency. Its frame stage (`images`, after `collectChanges`)
 * updates the texture manager and rewrites the records whose level changed. A visible image of a
 * ready asset with no texture draws its average colour and counts in `FrameStats.blankImages`,
 * which must stay 0. An image under 8 device pixels on its longer edge draws its average colour on
 * purpose (`IMAGE_LEVEL_OF_DETAIL`), which is not blank: its level stays resident. Flagged
 * to the z-order segments at any opacity above 0. Listed in `STANDARD_SCENE_PASSES` after the
 * solid-rect pass; the host gives it assets and a decode pool through the pass environment's
 * `images`.
 */
export const IMAGE_PASS: ScenePassFactory = {
  name: IMAGE_PASS_NAME,
  create: createImagePass,
};

function retainImageTarget(
  target: SceneObject,
  residency: SharedImageResidency,
  holder: { readonly passName: string; readonly targets: Map<ObjectId, SceneObject> },
): void {
  if (target.object.type !== 'image') return;
  residency.track(holder, target);
  holder.targets.set(target.object.id, target);
}

/**
 * Refuses snapshots while a moved image can synchronously call external asset hooks.
 *
 * @param pass - The image pass instance.
 * @param targets - Objects already tracked by its texture manager.
 * @param catalogue - The shared resource state.
 * @returns The same pass with its private host admission guard registered.
 */
function guardImageRootMoves(
  pass: ScenePass,
  targets: ReadonlyMap<ObjectId, SceneObject>,
  catalogue: ImagePassSupport['catalogue'],
): ScenePass {
  registerRootMoveBatchGuard(pass, (objects) =>
    objects.every((object) => {
      if (object.type !== 'image') return true;
      const previous = targets.get(object.id)?.object;
      return (
        previous?.type === 'image' &&
        previous.assetId === object.assetId &&
        catalogue.peek(object.assetId)?.status === 'described'
      );
    }),
  );
  return pass;
}
