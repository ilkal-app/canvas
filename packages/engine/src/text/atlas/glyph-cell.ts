// A glyph's room on an atlas page: the cell MSDF batches are planned with, and the
// highest tier whose cells fit a page, so an atlas with small pages never asks for glyphs it
// cannot place.

import { GLYPH_PADDING_PX } from './glyph-bitmap.js';
import { BASE_TIER, GLYPH_TIERS, type GlyphTier } from './glyph-tiers.js';

/** Cleared texels around every glyph cell, so linear filtering never reads a neighbour. */
export const GLYPH_ATLAS_GUTTER = 1;

/**
 * The conservative side of a glyph's cell at a tier, texels: the em box with room for tall
 * glyphs (1.25 em), plus the field padding and the atlas gutter on both sides. An estimate:
 * most glyphs fit it, a rare taller one needs more.
 *
 * @param tier - Texels per em.
 * @returns The cell side.
 */
export function glyphCellSide(tier: number): number {
  return Math.ceil(tier * 1.25) + 2 * GLYPH_PADDING_PX + 2 * GLYPH_ATLAS_GUTTER;
}

/**
 * The highest tier whose cells fit a page of `pageSize`: 512 from a 1024 page up, 256 on a 512
 * page; never below the base tier.
 *
 * @param pageSize - The page side, texels.
 * @returns The tier.
 */
export function maxTierForPage(pageSize: number): GlyphTier {
  const fitting = GLYPH_TIERS.filter((tier) => glyphCellSide(tier) <= pageSize);
  return fitting.at(-1) ?? BASE_TIER;
}

/**
 * A wanted tier capped at an atlas's highest tier.
 *
 * @param tier - The wanted tier.
 * @param maxTier - The atlas's highest tier; none, no cap.
 * @returns The tier to ask for.
 */
export function cappedTier(tier: GlyphTier, maxTier: GlyphTier | undefined): GlyphTier {
  return maxTier !== undefined && tier > maxTier ? maxTier : tier;
}
