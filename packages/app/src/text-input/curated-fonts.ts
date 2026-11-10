import { DISPLAY_FONTS } from './curated-display.js';
import { HANDWRITING_FONTS } from './curated-handwriting.js';
import { MONO_FONTS } from './curated-mono.js';
import { SANS_FONTS } from './curated-sans.js';
import { SERIF_FONTS } from './curated-serif.js';
import type { FontFamilyEntry } from './font-catalogue.js';

/** Bundled curated families; only requested families are fetched. */
export const CURATED_FONT_FAMILIES: readonly FontFamilyEntry[] = [
  ...SANS_FONTS,
  ...SERIF_FONTS,
  ...MONO_FONTS,
  ...DISPLAY_FONTS,
  ...HANDWRITING_FONTS,
];
