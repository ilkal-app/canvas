/**
 * The line breaking and bidi rules layout follows: UAX #14 of Unicode 17.0.0, with
 * Thai, Lao, Khmer and Myanmar broken at dictionary word boundaries, and UAX #9 of Unicode 17.0.0,
 * each bidi level shaped in its own direction. `BUNDLED_FONTS_FINGERPRINT` hashes it, so a size
 * measured under other rules is stale.
 */
export const LINE_BREAKING_VERSION = 'uax14@17.0.0+dictionary;uax9@17.0.0';
