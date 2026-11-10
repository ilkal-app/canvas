import { isSameTextStyle, type LetterSpacing, type TextStyle } from '@canvas/schema';

/**
 * The fields of a text style, in schema order (added the two spacing fields, the
 * variable-font coordinates, the language, the face, OpenType features,
 * The link, underline and strikethrough).
 */
export const TEXT_STYLE_FIELDS = [
  'fontFamily',
  'fontSize',
  'color',
  'weight',
  'italic',
  'letterSpacing',
  'lineHeight',
  'fontVariations',
  'lang',
  'postScriptName',
  'fontFeatures',
  'link',
  'underline',
  'strikethrough',
] as const;

/** A field of a text style. */
export type TextStyleField = (typeof TEXT_STYLE_FIELDS)[number];

/** No letter-spacing, as the style panel shows it: 0 % of the font size. */
export const NO_LETTER_SPACING: LetterSpacing = Object.freeze({ value: 0, unit: 'percent' });

/** A full style both sides of a field comparison share, so only the field differs. */
const COMPARED: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

/**
 * Whether two values of one style field are the same, as the schema judges styles
 * (`isSameTextStyle`): colours channel by channel, a letter-spacing of 0 the same as none, a
 * line-height of `'auto'` the same as none. Pure.
 *
 * @param field - The field.
 * @param first - One value, or undefined for none.
 * @param second - The other.
 * @returns True when they are the same.
 */
export function isSameStyleField(field: TextStyleField, first: unknown, second: unknown): boolean {
  return isSameTextStyle({ ...COMPARED, [field]: first }, { ...COMPARED, [field]: second });
}

/**
 * A style with its optional fields spelt out, as the style panel shows it: no letter-spacing as
 * {@link NO_LETTER_SPACING}, an auto line-height as `'auto'`, no variable-font
 * coordinates as `{}`, no face name as an `undefined` `postScriptName`, no feature settings as an `undefined`
 * `fontFeatures`, no link as an `undefined` `link`. A shared
 * field is then always present, so a field missing from a shared style means mixed. Pure.
 *
 * @param style - A style.
 * @returns The style with its spacing fields, coordinates and face name present.
 */
export function shownTextStyle(style: TextStyle): ShownTextStyle {
  const isSpaced = style.letterSpacing !== undefined && style.letterSpacing.value !== 0;
  return {
    ...style,
    letterSpacing: isSpaced ? style.letterSpacing : NO_LETTER_SPACING,
    lineHeight: style.lineHeight ?? 'auto',
    fontVariations: style.fontVariations ?? {},
    postScriptName: style.postScriptName,
    fontFeatures: style.fontFeatures,
    link: style.link,
  };
}

/**
 * A style as the panel shows it: its face name, feature settings and link present, `undefined`
 * for none.
 */
export type ShownTextStyle = Omit<TextStyle, 'postScriptName' | 'fontFeatures' | 'link'> & {
  /** The face's PostScript name, or `undefined` for the family's plain faces. */
  readonly postScriptName: string | undefined;
  /** The OpenType feature settings, or `undefined` for none. */
  readonly fontFeatures: TextStyle['fontFeatures'] | undefined;
  /** The run's link, or `undefined` for none. */
  readonly link: string | undefined;
};
