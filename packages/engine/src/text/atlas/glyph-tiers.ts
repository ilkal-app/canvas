/**
 * A glyph raster tier: the em size, in texels, glyphs are generated at. Text picks the tier from
 * its on-screen em size so no tier is magnified much more than 2× (the prototype's tier cascade,
 * `src/atlas/tiers.ts`).
 */
export type GlyphTier = 64 | 256 | 512;

/** The tier everything small is drawn from. */
export const BASE_TIER: GlyphTier = 64;
/** The tier for text shown between 128 and 512 device px per em. */
export const HIGH_TIER: GlyphTier = 256;
/** The tier for text shown above 512 device px per em (the 32× zoom cap). */
export const MAX_TIER: GlyphTier = 512;

/** Every tier, ascending. */
export const GLYPH_TIERS: readonly GlyphTier[] = [BASE_TIER, HIGH_TIER, MAX_TIER];

/**
 * How far past a tier boundary the on-screen size must go before a tier that is already in use
 * switches, as a fraction of the boundary (tiers change with hysteresis, so continuous zooming does
 * not thrash the atlas).
 */
export const TIER_HYSTERESIS = 0.1;

/** The on-screen em sizes each tier serves, in device px: `(lower, upper]`. */
const TIER_RANGES: Readonly<Record<GlyphTier, readonly [lower: number, upper: number]>> = {
  64: [0, 128],
  256: [128, 512],
  512: [512, Infinity],
};

/**
 * Picks the raster tier for glyphs shown at `screenEm` device px per em. Each tier serves up to
 * 2× magnification of its texels before the next takes over; the base tier serves everything
 * smaller. With the previous tier given, it is kept while the size stays within
 * {@link TIER_HYSTERESIS} of its range.
 *
 * @param screenEm - The on-screen em size: font size × zoom × device pixel ratio.
 * @param previousTier - The tier the text was drawn with last, if any.
 * @returns The tier to draw with.
 */
export function pickTier(screenEm: number, previousTier?: GlyphTier): GlyphTier {
  const plain = screenEm > 512 ? MAX_TIER : screenEm > 128 ? HIGH_TIER : BASE_TIER;
  if (previousTier === undefined || plain === previousTier) return plain;
  const [lower, upper] = TIER_RANGES[previousTier];
  const isWithinMargin =
    screenEm >= lower * (1 - TIER_HYSTERESIS) && screenEm <= upper * (1 + TIER_HYSTERESIS);
  return isWithinMargin ? previousTier : plain;
}

/**
 * What a run of text draws with: an atlas tier, or `'vector'`, its glyphs' outlines
 * filled as geometry, sharp at any size.
 */
export type TextTier = GlyphTier | 'vector';

/** The tier that draws glyphs from their outlines instead of the atlas. */
export const VECTOR_TIER = 'vector';

/** Options for {@link pickTextTier}. */
export interface TextTierOptions {
  /** Whether text may draw from its outlines; default false, the atlas tiers alone. */
  readonly isVectorEnabled?: boolean;
}

/**
 * The atlas tier a text tier draws from while it cannot draw itself: the vector tier's glyphs
 * draw from the {@link MAX_TIER}, or an atlas's highest tier below it, while their
 * geometry is pending; an atlas tier is itself.
 *
 * @param tier - The text tier.
 * @param maxTier - The atlas's highest tier (`GlyphAtlas.maxTier`); none, the {@link MAX_TIER}.
 * @returns The atlas tier.
 */
export function atlasTierOf(tier: TextTier, maxTier?: GlyphTier): GlyphTier {
  return tier === VECTOR_TIER ? (maxTier ?? MAX_TIER) : tier;
}

/**
 * A text tier capped at an atlas's highest tier: an atlas tier above it is that tier;
 * the vector tier, which is not the atlas's, stays.
 *
 * @param tier - The tier picked.
 * @param maxTier - The atlas's highest tier; none, no cap.
 * @returns The tier to draw with.
 */
export function cappedTextTier(tier: TextTier, maxTier: GlyphTier | undefined): TextTier {
  return tier === VECTOR_TIER || maxTier === undefined || tier <= maxTier ? tier : maxTier;
}

/**
 * Picks what a run shown at `screenEm` device px per em draws with: {@link pickTier}'s
 * answer, with the vector tier, when enabled, in place of the {@link MAX_TIER}. So text goes to
 * its outlines above 512 px per em, with the same hysteresis as the atlas tiers, and
 * `mayChangeTier` still finds every size where the answer can change.
 *
 * @param screenEm - The on-screen em size: font size × zoom × device pixel ratio.
 * @param previous - What the run was drawn with last, if anything.
 * @param options - Whether the vector tier may be picked.
 * @returns The tier to draw with.
 */
export function pickTextTier(
  screenEm: number,
  previous?: TextTier,
  options?: TextTierOptions,
): TextTier {
  const tier = pickTier(screenEm, previous === undefined ? undefined : atlasTierOf(previous));
  return tier === MAX_TIER && options?.isVectorEnabled === true ? VECTOR_TIER : tier;
}

/**
 * The on-screen em sizes where {@link pickTier} can change its answer: each tier boundary and
 * each boundary moved by {@link TIER_HYSTERESIS} either way.
 */
const TIER_EDGES_EM: readonly number[] = [128, 512].flatMap((boundary) => [
  boundary * (1 - TIER_HYSTERESIS),
  boundary,
  boundary * (1 + TIER_HYSTERESIS),
]);

/**
 * Whether a change of on-screen em size can change the tier of text drawn at one of them,
 * whatever tier it had: it crosses (or leaves) a tier boundary or a hysteresis edge. A zoom that
 * crosses none changes no text's tier, so the text pass checks nothing (a zoom frame
 * used to re-check every text object). Pure.
 *
 * @param fromEm - The em size before, device px.
 * @param toEm - The em size after.
 * @returns Whether any tier can change.
 */
export function mayChangeTier(fromEm: number, toEm: number): boolean {
  return TIER_EDGES_EM.some(
    (edge) => fromEm < edge !== toEm < edge || fromEm <= edge !== toEm <= edge,
  );
}

/**
 * The tiers below a tier, highest first: the fallback order while a glyph is missing at the
 * tier it wants (pending generation, or evicted).
 *
 * @param tier - The wanted tier.
 * @returns The lower tiers, highest first.
 */
export function lowerTiers(tier: GlyphTier): GlyphTier[] {
  return GLYPH_TIERS.filter((candidate) => candidate < tier).reverse();
}

/** An entry found by {@link pickAvailable}, with the tier it was found at. */
export interface AvailableEntry<T> {
  /** The entry. */
  readonly entry: T;
  /** The tier it belongs to: scale the glyph's quad by it. */
  readonly tier: GlyphTier;
}

/**
 * Resolves the entry to draw a glyph with: the wanted tier's if present, else the highest lower
 * tier's. The tier actually used comes back so the caller can scale the quad by it.
 *
 * @param tier - The wanted tier.
 * @param lookup - Finds the entry at a tier, or `undefined`.
 * @returns The entry and its tier, or `undefined` when no tier has one.
 */
export function pickAvailable<T>(
  tier: GlyphTier,
  lookup: (tier: GlyphTier) => T | undefined,
): AvailableEntry<T> | undefined {
  for (const candidate of [tier, ...lowerTiers(tier)]) {
    const entry = lookup(candidate);
    if (entry !== undefined) return { entry, tier: candidate };
  }
  return undefined;
}
