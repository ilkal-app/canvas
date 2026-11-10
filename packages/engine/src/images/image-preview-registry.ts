import type { ScenePass } from '../scene/scene-pass.js';

import type { ImagePreviewEvidence } from './image-preview-evidence.js';
import type { ImagePreviewTracker } from './image-preview-tracker.js';

const MANAGERS = new WeakMap<object, ImagePreviewTracker>();
const PASSES = new WeakMap<
  ScenePass,
  { managerOf: () => object | undefined; isFull: () => boolean }
>();

/**
 * Registers internal manager evidence; no host certificate is enabled.
 *
 * @param manager - Owner identity.
 * @param tracker - Its evidence tracker.
 */
export function registerImagePreview(manager: object, tracker: ImagePreviewTracker): void {
  MANAGERS.set(manager, tracker);
}

/**
 * Gets an internal manager tracker.
 *
 * @param manager - Owner identity.
 * @returns Its tracker, if registered.
 */
export function imagePreviewOf(manager: object): ImagePreviewTracker | undefined {
  return MANAGERS.get(manager);
}

/**
 * Connects a built-in pass to its manager and actual LOD binding guard. The passes that share a
 * renderer's manager (the image pass and the image-fill passes) each register; an
 * image-fill pass's manager may not exist yet (`managerOf` gives undefined until a pass uses it).
 *
 * @param pass - Built-in pass.
 * @param managerOf - Its manager, once created.
 * @param isFull - Whether records use full bindings, not the average-color substitute.
 */
export function registerImagePassPreview(
  pass: ScenePass,
  managerOf: () => object | undefined,
  isFull: () => boolean,
): void {
  PASSES.set(pass, { managerOf, isFull });
}

/**
 * Tells whether a pass is a built-in image contributor.
 *
 * @param pass - The rendered pass.
 * @returns True when it registered.
 */
export function isImagePreviewPass(pass: ScenePass): boolean {
  return PASSES.has(pass);
}

/**
 * The manager a built-in image contributor draws from, once created: passes sharing one give
 * the same, so their evidence is counted once.
 *
 * @param pass - The rendered pass.
 * @returns Its manager, or undefined (unknown pass, or no manager yet: nothing tracked).
 */
export function imagePreviewManagerOf(pass: ScenePass): object | undefined {
  return PASSES.get(pass)?.managerOf();
}

/**
 * The tracker of a registered pass's manager.
 *
 * @param pass - The rendered pass.
 * @returns The pass's guard and tracker, or undefined.
 */
function entryOf(
  pass: ScenePass,
): { readonly tracker: ImagePreviewTracker; readonly isFull: () => boolean } | undefined {
  const entry = PASSES.get(pass);
  const manager = entry?.managerOf();
  const tracker = manager === undefined ? undefined : imagePreviewOf(manager);
  return entry === undefined || tracker === undefined
    ? undefined
    : { tracker, isFull: entry.isFull };
}

/**
 * Reads built-in image evidence after a successful full frame; custom passes refuse.
 *
 * @param pass - The rendered pass.
 * @returns Complete image evidence or undefined, never a whole preview certificate.
 */
export function readImagePreviewEvidence(pass: ScenePass): ImagePreviewEvidence | undefined {
  const entry = entryOf(pass);
  return entry?.isFull() === true ? entry.tracker.read() : undefined;
}

/**
 * Rechecks previously issued evidence against current frame/resources.
 *
 * @param pass - The rendered pass.
 * @param evidence - Evidence returned by this pass.
 * @returns Whether it still matches; unknown/edited evidence refuses.
 */
export function isImagePreviewEvidenceCurrent(
  pass: ScenePass,
  evidence: ImagePreviewEvidence,
): boolean {
  const entry = entryOf(pass);
  return entry?.isFull() === true && entry.tracker.isCurrent(evidence);
}
