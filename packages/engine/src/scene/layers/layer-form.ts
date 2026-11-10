import { layerOpacityOf, type BoardObject } from '@canvas/schema';

import { pathLayersOf } from '../../paths/path-layers.js';
import { isOutlineVisible } from '../../shapes/shape-object-record.js';
import { drawnShadowsOf } from '../../shapes/shape-shadow.js';
import { textRecordCount } from '../../text/scene/text-record-count.js';

/**
 * An object's own layer opacity: its stored `opacity`, absent or refused being opaque.
 * An image's own opacity counts too. Pure.
 *
 * @param object - The object.
 * @returns Its own opacity, from 0 to 1.
 */
export function ownOpacityOf(object: BoardObject): number {
  return 'opacity' in object ? layerOpacityOf(object.opacity) : 1;
}

/**
 * Whether an object draws more than one part that can overlap, so multiplying each part's
 * alpha would double up where they overlap ("hybrid compositing"): a
 * shape with a label or a drop shadow, a sticky (paper, shadow and text), a path with both a
 * fill and a stroke, a connector with a label, an image with a border. Containers (groups, frames, mains, instances)
 * always composite. Pure.
 *
 * @param object - The object.
 * @returns True for a multi-part leaf.
 */
function isMultiPartLeaf(object: BoardObject): boolean {
  switch (object.type) {
    case 'sticky':
    case 'link':
      return true;
    case 'shape':
      return textRecordCount(object) > 0 || drawnShadowsOf(object).length > 0;
    case 'path':
      return pathLayersOf(object).length > 1;
    case 'connector':
      return textRecordCount(object) > 0;
    case 'image':
      return isOutlineVisible(object.border);
    default:
      return false;
  }
}

/**
 * Whether an object draws in layer form: its own opacity is below 1 and it is a
 * container (group, frame, main or instance) or a multi-part leaf, so its parts draw into an
 * offscreen layer that composites once at that opacity. Every other translucent object, and
 * every object without a layer-composite pass, multiplies its records' alpha instead (the
 * multiply form, `SceneOpacity`), which is exact for a single part. At opacity 0 it is still in
 * layer form: nothing of it is drawn, and it stays hittable. Pure; reads only the object.
 *
 * @param object - The object.
 * @returns True for layer form.
 */
export function isLayerForm(object: BoardObject): boolean {
  if (ownOpacityOf(object) >= 1) return false;
  switch (object.type) {
    case 'group':
    case 'frame':
    case 'component':
    case 'instance':
      return true;
    default:
      return isMultiPartLeaf(object);
  }
}
