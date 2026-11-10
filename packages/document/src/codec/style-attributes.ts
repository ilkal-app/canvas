import {
  fontFeaturesSchema,
  type FontFeatures,
  fontVariationsSchema,
  type FontVariationAxes,
  type FontVariations,
  INK,
  isFontWeight,
  isSameTextStyle,
  isTokenRef,
  languageTagSchema,
  normalizeLink,
  postScriptNameSchema,
  type InkableColor,
  type LetterSpacing,
  type LineHeight,
  styleIdSchema,
  type Rgba,
  type StyleId,
  type TextStyle,
} from '@canvas/schema';

// The formatting attributes of one character of a `Y.Text`: the fields of a schema `TextStyle`
// (five, and since the optional `letterSpacing` and `lineHeight`), each its own attribute, so two people restyling the same range concurrently (one
// makes it bold, the other recolours it) both win (text is a `Y.Text`
// with run attributes). The colour is one attribute, so a colour never tears.
//
// Since a character carries only the fields that differ from `ATTRIBUTE_BASE_STYLE`:
// Yjs stores every change of an attribute along a text as two items (it starts and ends the
// format), so five attributes on every run cost about 26 items per three-run text, a fifth of
// a 50k-object board's items. A field equal to the base is written as `null` (no attribute).
// The reader is tolerant: a character may carry any of them, the base value included (a
// peer that writes redundant attributes, or a merge of concurrent formats), and reads the same.
// A colour is a tuple or the `ink` token, which differs from the base's black, so ink
// text always carries the attribute; a colour attribute that is neither a tuple of channels in
// [0, 1] nor exactly `'ink'` reads as the base colour. A colour token reference
// `{ token }` is stored as is, one attribute, and the base's black never changes.
//
// Since a style may also carry `letterSpacing` and `lineHeight`, each one attribute
// holding its `{ value, unit }` object (or `'auto'`), so a value and its unit never tear. The
// base has neither: no spacing and an auto line-height are never stored, and a malformed
// attribute reads as none.
//
// Since a style may also carry `textStyleId`, the board text style the run's values come
// from: one attribute holding the id; the base has none, and a malformed one reads as none.
//
// Since a style may also carry `fontVariations`, its variable-font axis coordinates: one
// attribute holding the whole tag-to-value record, so a set of coordinates never tears. The base
// has none, empty is never stored, and a malformed record reads as none.
// Since a style may also carry `fontFeatures`, its OpenType features: one attribute holding
// the whole tag-to-value record; the base has none, empty is never stored, `null` removes it, and a
// malformed record reads as none.
// Since a style may also carry `lang`, the run's BCP 47 language tag: one attribute; the
// base has none, `null` in a patch removes it, and a malformed one reads as none.
// Since a style may also carry `postScriptName`, the face's PostScript name: one attribute;
// the base has none, `null` in a patch removes it, and a malformed one reads as none.
// Since a style may also carry `underline` and `strikethrough`: one attribute each, written
// only when `true`; `false` is the base, so a patch to `false` removes the attribute.
// Since a style may also carry `link`, where ⌘-click on the run goes: one attribute
// holding the URL; the base has none, `null` in a patch removes it, and one that is not a valid
// link in its normal form (a peer's `javascript:` URL, say) reads as none.

/**
 * The style a character has in each field it carries no attribute for. It is part of the
 * stored format: changing it would restyle every character of every stored text, so it never
 * changes.
 */
export const ATTRIBUTE_BASE_STYLE: TextStyle = Object.freeze({
  fontFamily: 'Inter',
  fontSize: 16,
  color: Object.freeze([0, 0, 0, 1]) as unknown as Rgba,
  weight: 400,
  italic: false,
});

/** Attributes to write on characters: a field's value, or `null` to fall back to the base. */
export type StyleAttributes = { readonly [Field in keyof TextStyle]?: TextStyle[Field] | null };

/**
 * Some fields of a text style, to set on a range: a field present is set, `textStyleId: null`
 * removes the run's board text style while keeping its values, `lang: null` removes
 * its language, `postScriptName: null` its face name, `fontFeatures: null`
 * its features, and `link: null` its link.
 */
export type TextStylePatch = Partial<
  Omit<
    TextStyle,
    'textStyleId' | 'fontVariations' | 'fontFeatures' | 'lang' | 'postScriptName' | 'link'
  >
> & {
  /** The board text style the range's values come from, or `null` to detach it. */
  readonly textStyleId?: StyleId | null;
  /** The range's variable-font coordinates, or `null` (or empty) to remove them. */
  readonly fontVariations?: FontVariations | null | undefined;
  /**
   * Some axes of each run's coordinates to change: a value sets the tag, `null`
   * removes it, the run's other axes are kept; `fontVariations` wins when both are given.
   */
  readonly fontVariationsAxes?: FontVariationAxes | undefined;
  /** The range's OpenType features, or `null` (or empty) to remove them. */
  readonly fontFeatures?: FontFeatures | null | undefined;
  /** The range's language, a BCP 47 tag, or `null` to remove it. */
  readonly lang?: string | null;
  /** The range's face, a PostScript name, or `null` to remove it. */
  readonly postScriptName?: string | null;
  /** The range's link, an http, https or mailto URL, or `null` to remove it. */
  readonly link?: string | null;
};

/**
 * The style fields, in schema order (
 * And added the optional ones).
 */
const STYLE_FIELDS = [
  'fontFamily',
  'fontSize',
  'color',
  'weight',
  'italic',
  'letterSpacing',
  'lineHeight',
  'fontVariations',
  'fontFeatures',
  'textStyleId',
  'lang',
  'postScriptName',
  'link',
  'underline',
  'strikethrough',
] as const;

/**
 * Tells whether a style field's value equals the base style's.
 *
 * @param field - The field.
 * @param value - Its value.
 * @returns `true` when the character needs no attribute for it.
 */
function isBaseValue<Field extends keyof TextStyle>(
  field: Field,
  value: TextStyle[Field],
): boolean {
  return isSameTextStyle({ ...ATTRIBUTE_BASE_STYLE, [field]: value }, ATTRIBUTE_BASE_STYLE);
}

/**
 * Copies a field's value for storing, so the attribute shares nothing with the caller.
 *
 * @param value - A field's value.
 * @returns A copy of an array or object; any other value as is.
 */
function copyValue(value: unknown): unknown {
  if (Array.isArray(value)) return [...(value as unknown[])];
  if (typeof value === 'object' && value !== null) return { ...value };
  return value;
}

/**
 * Converts a text style to the attributes new characters are inserted with: only the fields
 * that differ from {@link ATTRIBUTE_BASE_STYLE}. Yjs gives inserted characters no attribute for
 * a field left out (it negates the neighbours' attributes), so they read as the base.
 *
 * @param style - A validated text style.
 * @returns A new attribute record; the colour array is copied.
 */
export function styleToAttributes(style: TextStyle): StyleAttributes {
  const attributes: Record<string, unknown> = {};
  for (const field of STYLE_FIELDS) {
    const value = style[field];
    if (value !== undefined && !isBaseValue(field, value)) attributes[field] = copyValue(value);
  }
  return attributes;
}

/**
 * Converts part of a text style to attributes, for formatting a range: only the fields present
 * in `patch` change, and a field set to the base value, or `textStyleId` set to `null`, removes
 * the attribute (`null`).
 *
 * @param patch - A validated partial text style.
 * @returns A new attribute record holding only the patched fields.
 */
export function stylePatchToAttributes(patch: TextStylePatch): StyleAttributes {
  const attributes: Record<string, unknown> = {};
  for (const field of STYLE_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    if (value === null || isBaseValue(field, value)) attributes[field] = null;
    else attributes[field] = copyValue(value);
  }
  return attributes;
}

/**
 * Copies a colour: a tuple into a new array, a token reference into a new record, the `ink`
 * token as is.
 *
 * @param color - The colour.
 * @returns The copy.
 */
function copyColor(color: InkableColor): InkableColor {
  if (color === INK) return INK;
  return isTokenRef(color) ? { token: color.token } : [...color];
}

/**
 * Copies a text style, so a value stored in the document shares nothing with the caller.
 *
 * @param style - The style.
 * @returns A copy with its own colour array, spacing objects and coordinates.
 */
export function copyTextStyle(style: TextStyle): TextStyle {
  const { letterSpacing, lineHeight, fontVariations, fontFeatures } = style;
  return {
    ...style,
    color: copyColor(style.color),
    ...(letterSpacing === undefined ? {} : { letterSpacing: { ...letterSpacing } }),
    ...(lineHeight === undefined || lineHeight === 'auto' ? {} : { lineHeight: { ...lineHeight } }),
    ...(fontVariations === undefined ? {} : { fontVariations: { ...fontVariations } }),
    ...(fontFeatures === undefined ? {} : { fontFeatures: { ...fontFeatures } }),
  };
}

/**
 * Tells whether a stored value is a `{ value, unit }` measure: a finite number in px or percent.
 * Ranges are not checked here (see {@link styleFromAttributes}).
 *
 * @param value - The stored value.
 * @returns True for a measure.
 */
function isMeasure(
  value: unknown,
): value is { readonly value: number; readonly unit: 'px' | 'percent' } {
  if (typeof value !== 'object' || value === null) return false;
  const { value: amount, unit } = value as Readonly<Record<string, unknown>>;
  return (
    typeof amount === 'number' && Number.isFinite(amount) && (unit === 'px' || unit === 'percent')
  );
}

/**
 * Tells whether a stored value is a line-height: `'auto'` or a measure.
 *
 * @param value - The stored value.
 * @returns True for a line-height.
 */
function isLineHeight(value: unknown): value is LineHeight {
  return value === 'auto' || isMeasure(value);
}

/**
 * Tells whether a stored attribute value is a colour: the `ink` token, a token reference with a
 * valid id, or four channels in [0, 1].
 *
 * @param value - The stored value.
 * @returns `true` for a colour a renderer can draw.
 */
function isColor(value: unknown): value is InkableColor {
  if (value === INK || isTokenRef(value)) return true;
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((channel) => typeof channel === 'number' && channel >= 0 && channel <= 1)
  );
}

/**
 * Rebuilds a text style from the attributes of a run of a `Y.Text` delta. A field without an
 * attribute (or with one of the wrong kind, which only a faulty peer writes) takes the
 * {@link ATTRIBUTE_BASE_STYLE}'s value, so a text never becomes unreadable. Values other than the
 * colour and the coordinates are not range-checked here (remote updates are trusted, see the
 * README); a colour must be `'ink'`, a token reference or four channels in [0, 1], and
 * coordinates must pass `fontVariationsSchema`.
 *
 * @param attributes - The delta op's `attributes`, or `undefined` for unformatted characters.
 * @returns The style of the run; the base style itself when no field has an attribute.
 */
export function styleFromAttributes(attributes: unknown): TextStyle {
  const base = ATTRIBUTE_BASE_STYLE;
  if (typeof attributes !== 'object' || attributes === null) return base;
  const record = attributes as Readonly<Record<string, unknown>>;
  const { fontFamily, fontSize, color, weight, italic, letterSpacing, lineHeight, textStyleId } =
    record;
  const coordinates = fontVariationsSchema.safeParse(record.fontVariations);
  const features = fontFeaturesSchema.safeParse(record.fontFeatures);
  const { lang, postScriptName, link, underline, strikethrough } = record;
  return {
    fontFamily: typeof fontFamily === 'string' ? fontFamily : base.fontFamily,
    fontSize: typeof fontSize === 'number' ? fontSize : base.fontSize,
    color: isColor(color) ? color : base.color,
    weight: isFontWeight(weight) ? weight : base.weight,
    italic: typeof italic === 'boolean' ? italic : base.italic,
    ...(isMeasure(letterSpacing) ? { letterSpacing: letterSpacing satisfies LetterSpacing } : {}),
    ...(isMeasure(lineHeight) ? { lineHeight } : {}),
    // Empty coordinates are the font's defaults: read as none, as they are never written.
    ...(coordinates.success && Object.keys(coordinates.data).length > 0
      ? { fontVariations: coordinates.data }
      : {}),
    // Empty features are the defaults: read as none, as they are never written.
    ...(features.success && Object.keys(features.data).length > 0
      ? { fontFeatures: features.data }
      : {}),
    ...(isStyleId(textStyleId) ? { textStyleId } : {}),
    ...(isLanguageTag(lang) ? { lang } : {}),
    ...(isPostScriptName(postScriptName) ? { postScriptName } : {}),
    ...(isRunLink(link) ? { link } : {}),
    // Only `true` is ever written; anything else reads as not underlined or struck.
    ...(underline === true ? { underline } : {}),
    ...(strikethrough === true ? { strikethrough } : {}),
  };
}

/**
 * Tells whether a stored value is a language tag.
 *
 * @param value - The stored value.
 * @returns True for a valid BCP 47 tag.
 */
function isLanguageTag(value: unknown): value is string {
  return typeof value === 'string' && languageTagSchema.safeParse(value).success;
}

/**
 * Tells whether a stored value is a face's PostScript name.
 *
 * @param value - The stored value.
 * @returns True for a valid name.
 */
function isPostScriptName(value: unknown): value is string {
  return typeof value === 'string' && postScriptNameSchema.safeParse(value).success;
}

/**
 * Tells whether a stored value is a run's link: a URL in the normal form `normalizeLink`
 * gives, so a peer's `javascript:` or `data:` URL, or one with credentials, is never read.
 *
 * @param value - The stored value.
 * @returns True for a valid link.
 */
function isRunLink(value: unknown): value is string {
  return typeof value === 'string' && normalizeLink(value) === value;
}

/**
 * Tells whether a stored value is a style id.
 *
 * @param value - The stored value.
 * @returns True for a valid style id.
 */
function isStyleId(value: unknown): value is StyleId {
  return typeof value === 'string' && styleIdSchema.safeParse(value).success;
}

/**
 * Tells whether a stored value is a complete text style (every required field present, every
 * field of the right kind; ranges are not checked). A `link` is not judged here: read the style
 * with {@link storedTextStyleOf}, which drops an invalid one.
 *
 * @param value - The stored value.
 * @returns `true` when `value` can be read as a text style.
 */
export function isStoredTextStyle(value: unknown): value is TextStyle {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Readonly<Record<string, unknown>>;
  const { fontFamily, fontSize, color, weight, italic, letterSpacing, lineHeight, textStyleId } =
    record;
  const { fontVariations, fontFeatures } = record;
  return (
    typeof fontFamily === 'string' &&
    typeof fontSize === 'number' &&
    isColor(color) &&
    isFontWeight(weight) &&
    typeof italic === 'boolean' &&
    (letterSpacing === undefined || isMeasure(letterSpacing)) &&
    (lineHeight === undefined || isLineHeight(lineHeight)) &&
    (fontVariations === undefined || fontVariationsSchema.safeParse(fontVariations).success) &&
    (fontFeatures === undefined || fontFeaturesSchema.safeParse(fontFeatures).success) &&
    (textStyleId === undefined || isStyleId(textStyleId)) &&
    (record.lang === undefined || isLanguageTag(record.lang)) &&
    (record.postScriptName === undefined || isPostScriptName(record.postScriptName))
  );
}

/**
 * Reads a stored text style (`isStoredTextStyle`), its link kept only when valid: the
 * relay's door does not judge the style of empty text, so a peer may store any `link` beside a
 * valid style, and that must cost the link alone, never the text.
 *
 * @param value - The stored value.
 * @returns The style, without a link that is not a normalised link; undefined when it is not a
 *   text style.
 */
export function storedTextStyleOf(value: unknown): TextStyle | undefined {
  if (!isStoredTextStyle(value)) return undefined;
  if (value.link === undefined || isRunLink(value.link)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([field]) => field !== 'link'),
  ) as TextStyle;
}
