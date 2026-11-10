import type { FontFaceSource } from '@canvas/engine';
import type { TextStyle } from '@canvas/schema';

import { CURATED_FONT_FAMILIES } from './curated-fonts.js';

/** Categories exposed by the font picker. */
export type FontCategory = 'sans' | 'serif' | 'mono' | 'display' | 'handwriting';

/** A font family the text style panel offers: its name and its available face files. */
export interface FontFamilyEntry {
  /** The family name text styles use. */
  readonly family: string;
  /** The picker category, used when selecting a fallback. */
  readonly category: FontCategory;
  /** Only faces actually supplied by the family; no synthetic weight or slant. */
  readonly faces: readonly FontFaceSource[];
}

/**
 * The four faces of a family, from the URLs of their files.
 *
 * @param family - The family name.
 * @param urls - Regular, bold, italic and bold italic.
 * @returns The family.
 */
function familyOf(
  family: string,
  urls: readonly [regular: URL, bold: URL, italic: URL, boldItalic: URL],
): FontFamilyEntry {
  const [regular, bold, italic, boldItalic] = urls;
  return {
    family,
    category: 'sans',
    faces: [
      { family, weight: 400, isItalic: false, url: regular.href },
      { family, weight: 700, isItalic: false, url: bold.href },
      { family, weight: 400, isItalic: true, url: italic.href },
      { family, weight: 700, isItalic: true, url: boldItalic.href },
    ],
  };
}

// The URLs are written inline, `new URL(path, import.meta.url)`, so Vite recognises them and
// serves the font files, and marked `?no-inline` so a build emits them as files beside the
// bundle (as it does the worker scripts) rather than as base64 inside it: library builds inline
// every asset otherwise. They are fetched by URL, once per thread that lays text out.

/**
 * Curated self-hosted fonts, plus Liberation Sans for existing boards and the default.
 * Catalogue metadata and licence files live beside the bundled assets.
 */
export const FONT_FAMILIES: readonly FontFamilyEntry[] = [
  familyOf('Liberation Sans', [
    new URL('../../../engine/assets/fonts/LiberationSans-Regular.ttf?no-inline', import.meta.url),
    new URL('../../../engine/assets/fonts/LiberationSans-Bold.ttf?no-inline', import.meta.url),
    new URL('../../../engine/assets/fonts/LiberationSans-Italic.ttf?no-inline', import.meta.url),
    new URL(
      '../../../engine/assets/fonts/LiberationSans-BoldItalic.ttf?no-inline',
      import.meta.url,
    ),
  ]),
  ...CURATED_FONT_FAMILIES.filter((entry) => entry.family === 'Lora'),
  ...CURATED_FONT_FAMILIES.filter((entry) => entry.family !== 'Lora'),
];

/** Only the default family loads at startup; the rest load when used or previewed. */
export const FONT_FACE_SOURCES: readonly FontFaceSource[] = FONT_FAMILIES[0]?.faces ?? [];

/** The style new text starts in until one is picked: Liberation Sans 24, near-black. */
export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 24,
  color: [0.1, 0.1, 0.12, 1],
  weight: 400,
  italic: false,
};
