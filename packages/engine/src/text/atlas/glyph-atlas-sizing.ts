// The glyph atlases' share of the device budget: the scene's text pass and the
// frame-title pass each keep their own atlas, sized from the `atlases` category of the device's
// budget (`budgetForDevice`), their pages smaller where the budget is small, so a phone's 16 MiB
// still holds pages for both.

import type { DeviceMemoryBudget } from '../../memory/device-budget.js';

import { GlyphAtlas, type GlyphAtlasOptions } from './glyph-atlas.js';

/** The scene text pass's share of the `atlases` budget. */
export const TEXT_ATLAS_SHARE = 7 / 8;

/** The frame-title pass's share of the `atlases` budget. */
export const FRAME_TITLE_ATLAS_SHARE = 1 / 8;

/**
 * The sticky author pass's share of the `atlases` budget, beyond the text and frame
 * titles' whole: one caption face's glyphs, its pages allocated only while authors are shown,
 * so a board without them costs nothing.
 */
export const STICKY_AUTHOR_ATLAS_SHARE = 1 / 32;

/**
 * Each link card text pass's share of the `atlases` budget, beyond the others: the
 * cards' two faces at three sizes, its pages allocated only while a card's text draws.
 */
export const LINK_CARD_TEXT_ATLAS_SHARE = 1 / 32;

/** The page sides an atlas may use, largest first. */
const PAGE_SIZES = [2048, 1024, 512] as const;

/** An atlas's budget and page side. */
export interface GlyphAtlasSizing {
  /** Its resident byte budget. */
  readonly budgetBytes: number;
  /** The side of its square pages, px. */
  readonly pageSize: number;
}

/**
 * Sizes a glyph atlas from a share of the atlases budget: the bytes of the share, and the largest
 * page side (2048, 1024 or 512) of which two RGBA pages fit it, else 512.
 *
 * @param atlasesBytes - The device budget's `atlases` bytes.
 * @param share - The atlas's share of them.
 * @returns The budget and page side.
 */
export function glyphAtlasSizing(atlasesBytes: number, share: number): GlyphAtlasSizing {
  const budgetBytes = Math.floor(atlasesBytes * share);
  const pageSize = PAGE_SIZES.find((size) => 2 * size * size * 4 <= budgetBytes) ?? 512;
  return { budgetBytes, pageSize };
}

/**
 * A text pass's atlas options: an explicit byte budget wins (with today's pages); else its share
 * of the device budget, never under one page; else the atlas's defaults.
 *
 * @param budget - The device budget, if the environment has one.
 * @param explicitBytes - `TextPassResources.atlasBudgetBytes`, if set.
 * @param share - The pass kind's share of the atlases budget.
 * @returns The options.
 */
export function textAtlasOptions(
  budget: DeviceMemoryBudget | undefined,
  explicitBytes: number | undefined,
  share: number,
): GlyphAtlasOptions {
  if (explicitBytes !== undefined) return { budgetBytes: explicitBytes };
  if (budget === undefined) return {};
  const sizing = glyphAtlasSizing(budget.bytesByCategory.atlases, share);
  // At least one page, or the atlas could place nothing: a share under one 512² RGBA page
  // (1 MiB; the frame titles' on a device with under 8 MiB of atlases) is raised to one.
  const onePage = sizing.pageSize * sizing.pageSize * 4;
  return { ...sizing, budgetBytes: Math.max(sizing.budgetBytes, onePage) };
}

/**
 * A text pass's atlas, sized by {@link textAtlasOptions}.
 *
 * @param budget - The device budget, if the environment has one.
 * @param explicitBytes - `TextPassResources.atlasBudgetBytes`, if set.
 * @param share - The pass kind's share of the atlases budget.
 * @returns The atlas.
 */
export function createTextAtlas(
  budget: DeviceMemoryBudget | undefined,
  explicitBytes: number | undefined,
  share: number,
): GlyphAtlas {
  return new GlyphAtlas(textAtlasOptions(budget, explicitBytes, share));
}
