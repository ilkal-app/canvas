import type { ObjectId } from '@canvas/schema';

import { isSameCamera, type Camera } from '../camera/camera.js';
import type { ImagePreviewEvidence } from '../images/image-preview-evidence.js';
import {
  imagePreviewManagerOf,
  isImagePreviewEvidenceCurrent,
  isImagePreviewPass,
  readImagePreviewEvidence,
} from '../images/image-preview-registry.js';
import { isPaintTablePass } from '../paint/gradient-records.js';
import { isPathPreviewReady } from '../paths/path-preview-readiness.js';
import { SDF_SHAPE_PASS_NAME } from '../shapes/shape-pass.js';
import { isTextPreviewReady } from '../text/scene/text-preview-readiness.js';
import { isTextVectorPreviewReady } from '../text/scene/text-vector-pass.js';

import { FRAME_SHADOW_PASS } from './frame-shadow-pass.js';
import { FRAME_STROKE_PASS } from './frame-stroke-pass.js';
import type { Frame } from './frame.js';
import { IMAGE_BORDER_PASS } from './image-border-pass.js';
import { isLayerCompositePass } from './layers/layer-composite-pass.js';
import { ROUNDED_RECT_PASS } from './rounded-rect-pass.js';
import type { ScenePassResources } from './scene-pass-resources.js';
import { SOLID_RECT_PASS } from './solid-rect-pass.js';

/** Resource evidence for a completed built-in frame; scene identity is checked by the host. */
export interface ScenePreviewResources {
  /** Successful renderer frame, starting at zero. */
  readonly frameIndex: number;
  /** Rechecks captured contributors after callbacks without admitting replacement evidence. */
  readonly isCurrent: () => boolean;
  /** Image plans and actual resident bindings, scoped to this frame. */
  readonly images: readonly ImagePreviewEvidence[];
}

/** A renderer's preview evidence: its resources and the frame's level-of-detail plan. */
export interface CertifiedPreviewResources extends ScenePreviewResources {
  /** Exact settled LOD decisions for the certified frame, over the objects a preview holds. */
  readonly lodPlanKey: string;
}

/**
 * Requires every installed pass to be a recognized, currently ready built-in contributor.
 *
 * @param passes - This renderer's resources, not same-name replacement passes.
 * @param camera - The completed frame's camera.
 * @param frameIndex - Its index.
 * @param fontSetKey - Expected immutable font catalogue.
 * @param candidates - The objects the preview holds, which text readiness covers; default all.
 * @returns Complete contributors, or undefined if any pass refuses.
 */
export function readScenePreviewResources(
  passes: readonly ScenePassResources[],
  camera: Camera,
  frameIndex: number,
  fontSetKey: string,
  candidates?: readonly ObjectId[],
): ScenePreviewResources | undefined {
  const held = candidates === undefined ? undefined : new Set(candidates);
  const images: ImagePreviewEvidence[] = [];
  const checks: (() => boolean)[] = [];
  /** The managers whose evidence is in `images`: the image passes share one. */
  const managers = new Set<object>();
  for (const resource of passes) {
    const pass = resource.pass;
    // Stateless built-ins: their records are the frame, with no resource to wait for. A frame's
    // drop shadow is one, and its outline; left out, either refused every
    // preview of the standard passes. So is a rounded frame's solid background; its
    // gradient one is a paint table pass. So is the layer composite: every layer
    // is rendered and composited within the frame it is drawn in. So is an image's border:
    // left out, it refused every preview of the standard passes, as the shadow did.
    if (
      pass === SOLID_RECT_PASS ||
      isLayerCompositePass(pass) ||
      // By name: a renderer builds its own shape pass (its level of detail).
      pass.name === SDF_SHAPE_PASS_NAME ||
      pass === FRAME_SHADOW_PASS ||
      pass === FRAME_STROKE_PASS ||
      pass === IMAGE_BORDER_PASS ||
      pass === ROUNDED_RECT_PASS ||
      isPaintTablePass(pass)
    ) {
      continue;
    }
    if (isTextPreviewReady(pass, fontSetKey, held)) {
      checks.push(() => isTextPreviewReady(pass, fontSetKey, held));
      continue;
    }
    // The text pass's vector companion: its geometry jobs settled.
    if (isTextVectorPreviewReady(pass)) {
      checks.push(() => isTextVectorPreviewReady(pass));
      continue;
    }
    if (isPathPreviewReady(pass, resource.instances)) {
      checks.push(() => isPathPreviewReady(pass, resource.instances));
      continue;
    }
    if (!isImagePreviewPass(pass)) return undefined;
    const manager = imagePreviewManagerOf(pass);
    if (manager === undefined) {
      // An image-fill pass before any image: it tracks and draws nothing.
      checks.push(() => imagePreviewManagerOf(pass) === undefined);
      continue;
    }
    const image = readImagePreviewEvidence(pass);
    if (image?.frameIndex !== frameIndex || !isSameCamera(image.camera, camera)) return undefined;
    if (!managers.has(manager)) images.push(image);
    managers.add(manager);
    checks.push(() => isImagePreviewEvidenceCurrent(pass, image));
  }
  return { frameIndex, images, isCurrent: () => checks.every((check) => check()) };
}

const STRUCTURES = new WeakMap<object, () => boolean>();

/**
 * Captures trusted built-in installation before arbitrary host overlay extensions run.
 *
 * @param renderer - Renderer identity.
 * @param frame - Its completed built-in frame structure.
 */
export function captureScenePreviewStructure(renderer: object, frame: Frame): void {
  STRUCTURES.set(renderer, frame.captureContentStructure());
}

/**
 * Refuses extensions installed after the trusted capture.
 *
 * @param renderer - Renderer identity.
 * @returns Whether the exact captured content pipeline is still installed.
 */
export function isScenePreviewStructureCurrent(renderer: object): boolean {
  return STRUCTURES.get(renderer)?.() ?? false;
}
