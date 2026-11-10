// OpenType feature settings as HarfBuzz features.

import type * as HarfBuzzModule from 'harfbuzzjs';

/**
 * A run's OpenType feature settings as HarfBuzz features over the whole buffer, sorted by tag so
 * equal settings shape alike whatever their order.
 *
 * @param hb - harfbuzzjs.
 * @param features - The settings, tag to value.
 * @returns The features, or `undefined` for none.
 */
export function harfBuzzFeaturesOf(
  hb: typeof HarfBuzzModule,
  features: Readonly<Record<string, number>> | undefined,
): HarfBuzzModule.Feature[] | undefined {
  if (features === undefined) return undefined;
  const tags = Object.keys(features).sort();
  if (tags.length === 0) return undefined;
  return tags.map((tag) => new hb.Feature(tag, features[tag]));
}
