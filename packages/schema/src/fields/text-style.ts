import { z } from 'zod';

import { inkableColorSchema, type InkableColor } from './color.js';
import { fontFeaturesSchema, isSameFontFeatures } from './font-features.js';
import { fontVariationsSchema, isSameFontVariations } from './font-variations.js';
import { linkSchema } from './link.js';
import { postScriptNameSchema } from './postscript-name.js';
import { styleIdSchema } from './style-id.js';
import { isTokenRef } from './token-ref.js';

export {
  fontFeaturesSchema,
  isSameFontFeatures,
  MAX_FONT_FEATURES,
  type FontFeatures,
} from './font-features.js';
export {
  fontVariationAxesSchema,
  fontVariationsSchema,
  isSameFontVariations,
  MAX_FONT_VARIATION_AXES,
  mergeFontVariations,
  type FontVariationAxes,
  type FontVariations,
} from './font-variations.js';
export {
  postScriptNameSchema,
  restyledFace,
  withPostScriptName,
  type PostScriptName,
} from './postscript-name.js';

/** The smallest font size, in world px (the prototype's `MIN_FONT_SIZE`). */
export const MIN_FONT_SIZE = 4;

/** The largest font size, in world px (the prototype's `MAX_FONT_SIZE`). */
export const MAX_FONT_SIZE = 400;

/** The range of a value, inclusive. */
export interface ValueRange {
  /** The smallest value. */
  readonly min: number;
  /** The largest value. */
  readonly max: number;
}

/** A value for each unit a spacing may be given in. */
export interface PerUnit<Value> {
  /** In world px. */
  readonly px: Value;
  /** In percent of the run's font size. */
  readonly percent: Value;
}

/**
 * The weights a run may ask for: 100 (thin) to 900 (black) in steps of 100. A family
 * draws a weight it lacks with its nearest face, as CSS matches weights.
 */
export const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** A run's weight: one of {@link FONT_WEIGHTS}. */
export type FontWeight = (typeof FONT_WEIGHTS)[number];

/** Validates a run's weight: 100 to 900 in steps of 100 (400 regular, 700 bold). */
export const fontWeightSchema = z
  .literal(FONT_WEIGHTS)
  .describe(
    'Weight, 100 to 900 in steps of 100 (400 regular, 700 bold); a family without that weight draws its nearest face.',
  );

/**
 * Tells whether a value is a weight a run may ask for.
 *
 * @param value - Any value.
 * @returns True for one of {@link FONT_WEIGHTS}.
 */
export function isFontWeight(value: unknown): value is FontWeight {
  return (FONT_WEIGHTS as readonly unknown[]).includes(value);
}

/** The letter-spacing a run may have, per unit: px, or percent of the font size. */
export const LETTER_SPACING_LIMITS: PerUnit<ValueRange> = Object.freeze({
  px: Object.freeze({ min: -400, max: 400 }),
  percent: Object.freeze({ min: -100, max: 400 }),
});

/** The largest line-height a run may have, per unit; every line-height is above 0. */
export const MAX_LINE_HEIGHT: PerUnit<number> = Object.freeze({ px: 4000, percent: 1000 });

/**
 * Validates a run's letter-spacing: extra space after each character, in world px or
 * in percent of the font size, as Figma has it. The layout trims it after a line's last
 * character, so it does not count toward the line's width or alignment.
 */
export const letterSpacingSchema = z
  .discriminatedUnion('unit', [
    z.strictObject({
      /** World px. */
      unit: z.literal('px'),
      /** The spacing, -400 to 400 px. */
      value: z.number().min(LETTER_SPACING_LIMITS.px.min).max(LETTER_SPACING_LIMITS.px.max),
    }),
    z.strictObject({
      /** Percent of the run's font size. */
      unit: z.literal('percent'),
      /** The spacing, -100 to 400 percent. */
      value: z
        .number()
        .min(LETTER_SPACING_LIMITS.percent.min)
        .max(LETTER_SPACING_LIMITS.percent.max),
    }),
  ])
  .describe(
    'Extra space after each character: { value, unit: "px" } (-400 to 400) or { value, unit: "percent" } of the font size (-100 to 400); trimmed at line ends. Leave it out for none.',
  );

/** A run's letter-spacing: px, or percent of its font size. */
export type LetterSpacing = z.output<typeof letterSpacingSchema>;

/**
 * Validates a run's line-height: `'auto'`, the face's own (1.25 × the font size), or
 * a height in world px or in percent of the font size. A line is as tall as its tallest run.
 */
export const lineHeightSchema = z
  .union([
    z.literal('auto'),
    z.discriminatedUnion('unit', [
      z.strictObject({
        /** World px. */
        unit: z.literal('px'),
        /** The height, above 0 and at most 4000 px. */
        value: z.number().positive().max(MAX_LINE_HEIGHT.px),
      }),
      z.strictObject({
        /** Percent of the run's font size. */
        unit: z.literal('percent'),
        /** The height, above 0 and at most 1000 percent. */
        value: z.number().positive().max(MAX_LINE_HEIGHT.percent),
      }),
    ]),
  ])
  .describe(
    'The line box height: "auto" (1.25 × the font size, the default), { value, unit: "px" } (up to 4000) or { value, unit: "percent" } of the font size (up to 1000). A line is as tall as its tallest run.',
  );

/** A run's line-height: `'auto'`, px, or percent of its font size. */
export type LineHeight = z.output<typeof lineHeightSchema>;

/**
 * Validates a BCP 47 language tag: a two- or three-letter language, then subtags of one
 * to eight letters or digits, at most 35 characters, such as `ja`, `zh-Hant-TW` or `yue`.
 */
export const languageTagSchema = z
  .string()
  .max(35)
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/u)
  .describe('A BCP 47 language tag, such as ja, zh-Hant or en-US; at most 35 characters.');

/**
 * Validates the style of a run of characters: font family, size in world px, colour, weight and
 * italic, and optionally letter-spacing and line-height (absent means none and auto) and
 * variable-font coordinates (absent means the font's defaults). The prototype's `TextStyle` (`src/text/style.ts`). Weights run from 100 to 900; a
 * family draws one it lacks with its nearest face.
 */
export const textStyleSchema = z.strictObject({
  /** Font family name, 1 to 200 characters. */
  fontFamily: z.string().min(1).max(200).describe('Font family name, 1 to 200 characters.'),
  /** Font size in world px, 4 to 400. */
  fontSize: z
    .number()
    .min(MIN_FONT_SIZE)
    .max(MAX_FONT_SIZE)
    .describe('Font size in world px, 4 to 400.'),
  /** The glyph colour: a tuple, `'ink'` for the viewer's theme ink, or a token. */
  color: inkableColorSchema,
  /** 100 to 900 in steps of 100 (400 regular, 700 bold). */
  weight: fontWeightSchema,
  /** Whether the run is set in the italic face. */
  italic: z.boolean().describe('Whether the run is set in the italic face.'),
  /** Extra space after each character; absent for none. */
  letterSpacing: letterSpacingSchema.optional(),
  /** The line box height; absent for `'auto'`. */
  lineHeight: lineHeightSchema.optional(),
  /** Variable-font axis coordinates by tag; absent or empty for the font's defaults. */
  fontVariations: fontVariationsSchema.optional(),
  /**
   * OpenType features by tag: `0` off, `1` on, above `1` an alternate; absent or empty
   * for the shaper's defaults (ligatures and kerning on).
   */
  fontFeatures: fontFeaturesSchema.optional(),
  /**
   * The board text style the run's family, size, weight, slant, letter-spacing and line-height
   * come from; absent for none. The values are stored beside it.
   */
  textStyleId: styleIdSchema.optional(),
  /**
   * The run's language: a BCP 47 tag such as `ja`, `zh-Hant` or `en-US`, at most 35
   * characters; absent for none. It picks the face for Han characters (Japanese, Chinese or
   * Korean forms) and tells the shaper the language's conventions.
   */
  lang: languageTagSchema.optional(),
  /**
   * The PostScript name of the face the run is set in, for a family whose faces differ
   * beyond weight and slant (a condensed or display face); absent to choose by family, weight and
   * italic. It is honoured only when it names a face of the run's resolved family; otherwise the
   * face is chosen by weight and italic. A family change clears it.
   */
  postScriptName: postScriptNameSchema.optional(),
  /**
   * Where ⌘-click on the run goes: an http, https or mailto URL, under the same rules
   * as an object's link; absent for none. A board text style never sets or clears it.
   */
  link: linkSchema.optional(),
  /** Whether the run is underlined; absent for not, the same as `false`. */
  underline: z.boolean().optional().describe('Whether the run is underlined; absent for not.'),
  /** Whether the run is struck through; absent for not, the same as `false`. */
  strikethrough: z
    .boolean()
    .optional()
    .describe('Whether the run is struck through; absent for not.'),
});

/** The style of a run of characters. */
export type TextStyle = z.output<typeof textStyleSchema>;

/**
 * Validates a style run: `length` characters, counted in UTF-16 code units (JavaScript string
 * indices), set in `style`. A text's runs cover its characters in order; see
 * `findRunIssues` for the invariant.
 */
export const styleRunSchema = z.strictObject({
  /** Number of characters in the run, in UTF-16 code units. */
  length: z
    .number()
    .int()
    .nonnegative()
    .describe('Number of characters in the run, in UTF-16 code units.'),
  /** The style of every character in the run. */
  style: textStyleSchema,
});

/** A run of `length` UTF-16 code units set in one style. */
export type StyleRun = z.output<typeof styleRunSchema>;

/**
 * Tells whether two text styles are the same, field by field (the prototype's `styleEquals`). A
 * letter-spacing of 0 (in either unit) is the same as none, and a line-height of `'auto'` the
 * same as none, so they never split a run or need storing.
 *
 * @param first - One style.
 * @param second - The other style.
 * @returns `true` when every field, and every colour channel (or the `ink` token), is equal,
 *   the board text style each names included, and coordinates compared whatever their
 *   order, empty the same as none, the face's PostScript name and the
 *   run's link, and underline and strikethrough with `false` the same as absent.
 */
export function isSameTextStyle(first: TextStyle, second: TextStyle): boolean {
  return (
    first.fontFamily === second.fontFamily &&
    first.fontSize === second.fontSize &&
    first.weight === second.weight &&
    first.italic === second.italic &&
    isSameColor(first.color, second.color) &&
    isSameLetterSpacing(first.letterSpacing, second.letterSpacing) &&
    isSameLineHeight(first.lineHeight, second.lineHeight) &&
    isSameFontVariations(first.fontVariations, second.fontVariations) &&
    isSameFontFeatures(first.fontFeatures, second.fontFeatures) &&
    first.textStyleId === second.textStyleId &&
    first.lang === second.lang &&
    first.postScriptName === second.postScriptName &&
    first.link === second.link &&
    (first.underline ?? false) === (second.underline ?? false) &&
    (first.strikethrough ?? false) === (second.strikethrough ?? false)
  );
}

/**
 * Tells whether two letter-spacings are the same: both none (absent or 0), or the same value in
 * the same unit.
 *
 * @param first - One letter-spacing, or undefined for none.
 * @param second - The other.
 * @returns True when they are the same.
 */
function isSameLetterSpacing(
  first: LetterSpacing | undefined,
  second: LetterSpacing | undefined,
): boolean {
  const firstValue = first?.value ?? 0;
  const secondValue = second?.value ?? 0;
  if (firstValue === 0 || secondValue === 0) return firstValue === secondValue;
  return first?.unit === second?.unit && firstValue === secondValue;
}

/**
 * Tells whether two line-heights are the same: both auto (absent or `'auto'`), or the same value
 * in the same unit.
 *
 * @param first - One line-height, or undefined for auto.
 * @param second - The other.
 * @returns True when they are the same.
 */
function isSameLineHeight(first: LineHeight | undefined, second: LineHeight | undefined): boolean {
  const firstHeight = first === 'auto' ? undefined : first;
  const secondHeight = second === 'auto' ? undefined : second;
  if (firstHeight === undefined || secondHeight === undefined) return firstHeight === secondHeight;
  return firstHeight.unit === secondHeight.unit && firstHeight.value === secondHeight.value;
}

/**
 * Tells whether two stored colours are the same: both `ink`, both references to one token, or
 * equal channels. `'ink'` and `{ token: 'ink' }` draw alike but are stored apart, so they are not
 * the same stored colour (a run keeps what it was given).
 *
 * @param first - One colour.
 * @param second - The other.
 * @returns True when they are the same.
 */
export function isSameColor(first: InkableColor, second: InkableColor): boolean {
  if (typeof first === 'string' || typeof second === 'string') return first === second;
  if (isTokenRef(first) || isTokenRef(second)) {
    return isTokenRef(first) && isTokenRef(second) && first.token === second.token;
  }
  return first.every((channel, index) => channel === second[index]);
}
