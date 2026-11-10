import { applyTransform } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';
import { boundsAround, unionBounds } from '../../spatial/bounds.js';

import type { OrderedGlyphQuads } from './ordered-glyph-quads.js';
import type { TextObjectEntry } from './text-object-entry.js';

// Quads are immutable between rebuilds. Weak keys release the cached union with the entry's
// old quads; a move transforms four corners regardless of the number of glyphs in the label.
const LOCAL_BOUNDS = new WeakMap<OrderedGlyphQuads, WorldBounds | undefined>();

/**
 * Bounds the quads actually drawn, including glyph overhang, overflow, and rotation. The
 * local union is cached per quad rebuild; rotating it is conservative between separated quads.
 * Greek/glyph and atlas tier changes intentionally replace the union: their drawn extents
 * differ, and culling/occlusion must follow the form actually rendered.
 *
 * @param entry - The current text quads and object transform.
 * @returns Their world-space union, or undefined before anything draws.
 */
export function drawnTextBounds(entry: TextObjectEntry): WorldBounds | undefined {
  const local = localQuadBounds(entry);
  return local === undefined ? undefined : placedBounds(entry, local);
}

/**
 * The union of an entry's drawn quads in its object's frame, in the pass's layout units, cached
 * per quad rebuild.
 *
 * @param entry - The entry.
 * @returns The union, or `undefined` before anything draws.
 */
export function localQuadBounds(entry: TextObjectEntry): WorldBounds | undefined {
  const { quads } = entry;
  if (quads === undefined) return undefined;
  if (!LOCAL_BOUNDS.has(quads)) LOCAL_BOUNDS.set(quads, localBounds(quads));
  return LOCAL_BOUNDS.get(quads);
}

/**
 * A rectangle in an entry's object frame, placed on the board: the world bounds of its four
 * corners under the object's transform.
 *
 * @param entry - The entry, for its transform.
 * @param local - The rectangle, world units in the object's frame.
 * @returns Its world bounds (`boundsAround` of the corners).
 */
export function placedBounds(entry: TextObjectEntry, local: WorldBounds): WorldBounds | undefined {
  const { minX, minY, maxX, maxY } = local;
  return boundsAround([
    applyTransform(entry.target.transform, { x: minX, y: minY }),
    applyTransform(entry.target.transform, { x: maxX, y: minY }),
    applyTransform(entry.target.transform, { x: maxX, y: maxY }),
    applyTransform(entry.target.transform, { x: minX, y: maxY }),
  ]);
}

function localBounds(quads: OrderedGlyphQuads): WorldBounds | undefined {
  // Runs drawn from their outlines have no quads but reach as far as theirs would.
  let result: WorldBounds | undefined = quads.vectorBounds;
  for (const item of quads.quads) {
    if (item === undefined) continue;
    const { x, y, width, height } = item.quad;
    const bounds = { minX: x, minY: y, maxX: x + width, maxY: y + height };
    result = result === undefined ? bounds : unionBounds(result, bounds);
  }
  return result;
}
