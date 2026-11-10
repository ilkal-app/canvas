/**
 * A canonical key for normalised coordinates, for caches of layouts and glyphs: the
 * tags sorted, each as `tag=value`, joined by `;`. Equal coordinates give equal keys whatever the
 * order they were listed in; the default instance (no coordinates) gives the empty string, so a
 * static face's keys are unchanged.
 *
 * @param normalised - Coordinates from `normaliseVariations`.
 * @returns The key.
 */
export function variationKey(normalised: Readonly<Record<string, number>>): string {
  return Object.keys(normalised)
    .sort()
    .map((tag) => `${tag}=${String(normalised[tag])}`)
    .join(';');
}
