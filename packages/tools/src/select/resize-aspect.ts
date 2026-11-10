import { croppedImageAspect, type ObjectId } from '@canvas/schema';

import { nearIds } from './far-objects.js';
import type { SelectionSource } from './selection-geometry.js';

/**
 * How a resize of the selection treats its aspect ratio (fix round 2, controller ruling;
 * the owner may change it): images resize proportionally by default and Shift frees them, the
 * reverse of other objects, as most whiteboards do for images; a selection holding an image
 * (directly or inside a selected group) follows its strictest member.
 */
export interface ResizeAspect {
  /** Whether a plain drag keeps the aspect and Shift frees it (true when an image is resized). */
  readonly isProportionalByDefault: boolean;
  /**
   * The aspect, width over height in the frame's own axes, a proportional resize keeps: a lone
   * image's drawn aspect (`croppedImageAspect`), so a box a merge or a Shift resize left off it
   * is brought back to it and the image fills its box again; undefined to keep the frame's own.
   */
  readonly aspect: number | undefined;
}

/** Other objects' rule: free, proportional with Shift, at the frame's own aspect. */
export const FREE_RESIZE: ResizeAspect = Object.freeze({
  isProportionalByDefault: false,
  aspect: undefined,
});

/**
 * Whether an object is an image, or a group with an image anywhere below it (its resize scales
 * the image). A parent cycle ends the walk.
 *
 * @param id - The object.
 * @param source - The document.
 * @returns True when resizing it resizes an image.
 */
function holdsImage(id: ObjectId, source: SelectionSource): boolean {
  const seen = new Set<ObjectId>();
  const pending = [id];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    const object = source.get(next);
    if (object?.type === 'image') return true;
    if (object?.type === 'group') pending.push(...source.childrenOf(next));
  }
  return false;
}

/**
 * The aspect rule of a resize of the selection ({@link ResizeAspect}): proportional by default
 * when any object it would resize is an image or a group holding one; at a lone image's drawn
 * aspect when the selection is that image. O(the selected groups' subtrees); the controller
 * caches it with the frame (`SelectionFrameCache`). Pure.
 *
 * @param ids - The selected ids.
 * @param source - The document.
 * @param near - The objects a transform changes (`SelectionScope.near`), when the caller has
 *   them already; `nearIds` otherwise.
 * @returns The rule.
 */
export function resizeAspectOf(
  ids: readonly ObjectId[],
  source: SelectionSource,
  near?: readonly ObjectId[],
): ResizeAspect {
  const movable = near ?? nearIds(ids, source);
  if (!movable.some((id) => holdsImage(id, source))) return FREE_RESIZE;
  const [only] = ids;
  const image = ids.length === 1 && only !== undefined ? source.get(only) : undefined;
  const aspect = image?.type === 'image' ? croppedImageAspect(image) : undefined;
  return {
    isProportionalByDefault: true,
    aspect: aspect !== undefined && Number.isFinite(aspect) && aspect > 0 ? aspect : undefined,
  };
}

/**
 * Whether a resize keeps the aspect: Shift frees an image's and constrains any other's.
 *
 * @param rule - The selection's rule.
 * @param isShiftPressed - Whether Shift is held.
 * @returns True for a proportional resize.
 */
export function isProportionalResize(rule: ResizeAspect, isShiftPressed: boolean): boolean {
  return rule.isProportionalByDefault ? !isShiftPressed : isShiftPressed;
}
