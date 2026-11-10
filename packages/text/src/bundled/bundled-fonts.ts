import type { FontWeight } from '@canvas/schema';

import type { FontMetrics } from '../font/font-metrics.js';

import type { FontCategory } from './encoded-family.js';
import { decodeFaceMetrics } from './face-encoding.js';
import { BUNDLED_FAMILIES } from './generated/index.js';

/**
 * The family the app starts with and falls back to: the first face it loads, so a style naming
 * no loaded face is laid out in it (`resolveFontFace`).
 */
export const DEFAULT_FONT_FAMILY = 'Liberation Sans';

/**
 * The families whose fonts the app bundles (Liberation Sans and the curated library,
 * `packages/app/assets/fonts/library/catalogue.json`), the default first: the families text can
 * be measured in without the font files.
 */
export const BUNDLED_FONT_FAMILIES: readonly string[] = BUNDLED_FAMILIES.map(
  ({ family }) => family,
);

const decoded = new Map<string, readonly FontMetrics[]>();

/**
 * A bundled family's metrics: every face it supplies, exactly as the app's font library measures
 * them once the family's files are loaded. Each family is decoded once, when first asked for.
 *
 * @param family - The family name, as a text style names it.
 * @returns The faces' metrics, or `undefined` for a family the app does not bundle.
 */
export function bundledFamilyMetrics(family: string): readonly FontMetrics[] | undefined {
  let faces = decoded.get(family);
  if (faces === undefined) {
    const encoded = BUNDLED_FAMILIES.find((entry) => entry.family === family);
    if (encoded === undefined) return undefined;
    faces = encoded.faces.map(({ weight, isItalic, metrics }) =>
      decodeFaceMetrics({ family, weight, isItalic }, metrics),
    );
    decoded.set(family, faces);
  }
  return faces;
}

/** One face a bundled family supplies: the app synthesizes no other weight or slant. */
export interface BundledFontFace {
  /** 100 to 900 (400 regular, 700 bold). */
  readonly weight: FontWeight;
  /** Whether the face is italic. */
  readonly isItalic: boolean;
}

/** One family of the bundled font catalogue. */
export interface BundledFontFamily {
  /** The family name, exactly as a text style names it. */
  readonly family: string;
  /** The app picker's category. */
  readonly category: FontCategory;
  /** The faces it supplies, as generated. */
  readonly faces: readonly BundledFontFace[];
}

/**
 * The bundled font catalogue: every family the app bundles, the default first, with
 * its category and the faces it supplies, from the same generated tables text is measured with.
 * What `list_fonts` reports, in generated order (the default, then the library catalogue's); the
 * app's picker offers the same families, ordering them its own way (a contract test in
 * `packages/app/src/text-input` keeps them equal).
 */
export const BUNDLED_FONT_CATALOGUE: readonly BundledFontFamily[] = BUNDLED_FAMILIES.map(
  ({ family, category, faces }) => ({
    family,
    category,
    faces: faces.map(({ weight, isItalic }) => ({ weight, isItalic })),
  }),
);
