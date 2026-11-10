import { glyphCellSide } from '../atlas/glyph-cell.js';
import type { GlyphKey } from '../atlas/glyph-key.js';

/**
 * A batch is sized as if its glyphs were packed into a square of this side, as the prototype's
 * msdfgen atlas was, which bounds one job's memory and running time.
 */
export const MAX_BATCH_SIDE_PX = 2048;

/**
 * Splits the glyphs to generate at a tier into `msdf` job batches (the prototype's
 * `planBatches`, `src/atlas/msdfSource.ts`): each batch holds as many conservative glyph cells
 * (`glyphCellSide`) as fit a square of the atlas's page side ({@link MAX_BATCH_SIDE_PX} by
 * default), so a batch is about one page's worth: at 2048, a base-tier batch holds 400 and a
 * top-tier one nine (smaller pages on a small budget, smaller batches). The cell is an
 * estimate, so a batch of unusually tall glyphs may spill onto a second page.
 *
 * @param keys - The glyphs ({@link GlyphKey}s), in request order.
 * @param tier - Texels per em.
 * @param pageSize - The side of the atlas's pages, px.
 * @returns The batches, in order; empty for no glyphs.
 */
export function planGlyphBatches(
  keys: readonly GlyphKey[],
  tier: number,
  pageSize: number = MAX_BATCH_SIDE_PX,
): GlyphKey[][] {
  const cell = glyphCellSide(tier);
  const perSide = Math.max(1, Math.floor(pageSize / cell));
  const perBatch = perSide * perSide;
  const batches: GlyphKey[][] = [];
  for (let start = 0; start < keys.length; start += perBatch) {
    batches.push(keys.slice(start, start + perBatch));
  }
  return batches;
}
