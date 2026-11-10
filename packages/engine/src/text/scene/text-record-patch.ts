import type { ScenePass } from '../../scene/scene-pass.js';
import type { WorldTransform } from '../../scene/world-transform.js';

import type { OrderedGlyphQuads } from './ordered-glyph-quads.js';

// Both glyph builders publish new immutable arrays when glyph residency changes.
const firstMissingByQuads = new WeakMap<OrderedGlyphQuads, number>();

/**
 * Reuses identical ordered quads: their local geometry, colours, residency and pages stayed
 * unchanged. The caller has already updated the entry's target and shape-label bounds.
 *
 * @param before - Previously prepared glyphs.
 * @param after - Glyphs after checking current content, layout, atlas and level of detail.
 * @param transform - Their new world transform.
 * @param recordCount - Currently reserved records; an older layout may hold more glyphs.
 * @param values - Four floats borrowed from this pass, consumed before its next call.
 * @returns The shared transform slice, or undefined when full preparation is needed.
 */
export function retainedTextPatch(
  before: OrderedGlyphQuads | undefined,
  after: OrderedGlyphQuads | undefined,
  transform: WorldTransform,
  recordCount: number,
  values: Float32Array,
): ReturnType<NonNullable<ScenePass['preparePatch']>> {
  if (before === undefined || after !== before) return undefined;
  const count = Math.min(after.quads.length, recordCount);
  let firstMissing = firstMissingByQuads.get(after);
  if (firstMissing === undefined) {
    const index = after.quads.findIndex((quad) => quad === undefined);
    firstMissing = index < 0 ? after.quads.length : index;
    firstMissingByQuads.set(after, firstMissing);
  }
  // Full preparation leaves missing glyphs completely zero, including their transform.
  if (firstMissing < count) return undefined;
  const { x, y, cos, sin } = transform;
  values[0] = x;
  values[1] = y;
  values[2] = cos;
  values[3] = sin;
  return {
    recordCount: count,
    firstFloat: 0,
    values,
  };
}
