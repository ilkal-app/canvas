import { COVERAGE_FONTS_0 } from './coverage-fonts-0.js';
import { COVERAGE_FONTS_1 } from './coverage-fonts-1.js';
import { COVERAGE_FONTS_2 } from './coverage-fonts-2.js';
import { COVERAGE_FONTS_3 } from './coverage-fonts-3.js';
import { COVERAGE_FONTS_4 } from './coverage-fonts-4.js';
import { COVERAGE_FONTS_5 } from './coverage-fonts-5.js';
import { COVERAGE_FONTS_6 } from './coverage-fonts-6.js';
import { CJK_SLICE_FONT_FAMILIES } from './coverage-fonts-cjk.js';
import { SYMBOL_COVERAGE_FONTS } from './coverage-fonts-symbols.js';
import type { FontFamilyEntry } from './font-catalogue.js';

/** Hidden script and symbol coverage families, loaded on demand. */
export const COVERAGE_FONT_FAMILIES: readonly FontFamilyEntry[] = [
  ...COVERAGE_FONTS_0,
  ...COVERAGE_FONTS_1,
  ...COVERAGE_FONTS_2,
  ...COVERAGE_FONTS_3,
  ...COVERAGE_FONTS_4,
  ...COVERAGE_FONTS_5,
  ...COVERAGE_FONTS_6,
  // The CJK families by slice.
  ...CJK_SLICE_FONT_FAMILIES,
  ...SYMBOL_COVERAGE_FONTS,
];
