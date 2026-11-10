import type { FontWeight } from '@canvas/schema';

/** The categories the app's font picker groups families into. */
export const FONT_CATEGORIES = ['sans', 'serif', 'mono', 'display', 'handwriting'] as const;

/** One of {@link FONT_CATEGORIES}. */
export type FontCategory = (typeof FONT_CATEGORIES)[number];

/** One face of a bundled family, its metrics encoded by `encodeFaceMetrics`. */
export interface EncodedFace {
  /** 100 to 900 (400 regular, 700 bold). */
  readonly weight: FontWeight;
  /** Whether this is the italic face. */
  readonly isItalic: boolean;
  /** The face's metrics table, encoded. */
  readonly metrics: string;
}

/** A bundled family's faces, as a generated module under `generated/` exports it. */
export interface EncodedFamily {
  /** The family name text styles use. */
  readonly family: string;
  /** The app picker's category, from the library catalogue; the default is sans. */
  readonly category: FontCategory;
  /** Only the faces the family supplies. */
  readonly faces: readonly EncodedFace[];
}
