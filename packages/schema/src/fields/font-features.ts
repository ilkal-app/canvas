import { z } from 'zod';

/** The most features a run may set. */
export const MAX_FONT_FEATURES = 32;

/** The greatest feature value: an alternate's index, as OpenType's `uint16` holds. */
const MAX_FEATURE_VALUE = 65535;

/** An OpenType feature tag: four printable ASCII characters (U+0020 to U+007E). */
const FEATURE_TAG = /^[ -~]{4}$/u;

/**
 * Validates a run's OpenType features: feature tag to value, `0` off, `1` on and above
 * `1` an alternate's index (`aalt`, `salt`), such as `{ liga: 0 }` or `{ tnum: 1, smcp: 1 }`. At
 * most {@link MAX_FONT_FEATURES} tags; a tag the font lacks does nothing. Empty is the same as
 * none: the shaper's defaults (ligatures and kerning on).
 */
export const fontFeaturesSchema = z
  .record(z.string().regex(FEATURE_TAG), z.number().int().min(0).max(MAX_FEATURE_VALUE))
  .refine((features) => Object.keys(features).length <= MAX_FONT_FEATURES, {
    message: `At most ${String(MAX_FONT_FEATURES)} features.`,
  });

/** A run's OpenType features, by tag. */
export type FontFeatures = z.output<typeof fontFeaturesSchema>;

/**
 * Tells whether two runs' features are the same: equal values for the same tags, whatever their
 * order; absent and empty are the same (the defaults).
 *
 * @param first - One run's features, or undefined for none.
 * @param second - The other's.
 * @returns True when they are the same.
 */
export function isSameFontFeatures(
  first: FontFeatures | undefined,
  second: FontFeatures | undefined,
): boolean {
  const entries = Object.entries(first ?? {});
  const other = second ?? {};
  return (
    entries.length === Object.keys(other).length &&
    entries.every(([tag, value]) => other[tag] === value)
  );
}
