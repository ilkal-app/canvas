import type { AtlasGlyph } from './glyph-atlas-types.js';
import type { GlyphBitmap } from './glyph-bitmap.js';
import { GLYPH_ATLAS_GUTTER } from './glyph-cell.js';
import type { GlyphTier } from './glyph-tiers.js';
import type { ShelfAllocation } from './shelf-allocator.js';

/**
 * Where a glyph lands on its page, as the atlas returns it: the page rectangle its quad samples
 * (inside the cell's gutter, normalised to the page's side) and its metrics.
 *
 * @param bitmap - The glyph's bitmap.
 * @param tier - Its tier.
 * @param pageId - Its page; none for a glyph without texels.
 * @param allocation - Its cell; none for a glyph without texels.
 * @param pageSize - Its page's side, texels.
 * @returns The placed glyph.
 */
export function placedGlyph(
  bitmap: GlyphBitmap,
  tier: GlyphTier,
  pageId: number | undefined,
  allocation: ShelfAllocation | undefined,
  pageSize: number,
): AtlasGlyph {
  const x = (allocation?.x ?? 0) + GLYPH_ATLAS_GUTTER;
  const y = (allocation?.y ?? 0) + GLYPH_ATLAS_GUTTER;
  const { field, width, height, left, top, advance } = bitmap;
  return {
    pageId,
    field,
    u0: x / pageSize,
    v0: y / pageSize,
    u1: (x + width) / pageSize,
    v1: (y + height) / pageSize,
    width,
    height,
    left,
    top,
    advance,
    tier,
  };
}
