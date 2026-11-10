// The schema's named style exports: style ids, the text and effect
// style tables and values, where an object names a style, and the drop shadow and its layers
// an effect style holds, re-exported by the package entry.
export { effectStyleIdFieldSchema, styleIdSchema } from '../fields/style-id.js';
export type { StyleId } from '../fields/style-id.js';
export {
  effectStyleEntrySchema,
  effectStyleValueSchema,
  MAX_EFFECT_STYLES,
  MAX_STYLE_NAME_LENGTH,
  MAX_TEXT_STYLES,
  styleNameKey,
  styleNameSchema,
  TEXT_STYLE_VALUE_FIELDS,
  textStyleEntrySchema,
  textStyleValueSchema,
} from '../fields/named-styles.js';
export type {
  EffectStyleEntry,
  EffectStyleTable,
  EffectStyleValue,
  TextStyleEntry,
  TextStyleTable,
  TextStyleValue,
} from '../fields/named-styles.js';
export { boardFontFamilies, fontFamilyUsesOf } from './font-family-refs.js';
export type { BoardFontFamily, FontFamilyUse } from './font-family-refs.js';
export { effectStyleUseOf, textStyleUsesOf, unknownStyleIssues } from './named-style-refs.js';
export type { StyleUse } from './named-style-refs.js';
export {
  DEFAULT_SHADOW,
  MAX_SHADOW_BLUR,
  MAX_SHADOW_LAYERS,
  MAX_SHADOW_OFFSET,
  MAX_SHADOW_SPREAD,
  shadowFieldSchema,
  shadowLayersOf,
  shadowLayersSchema,
  shadowSchema,
} from '../fields/shadow.js';
export type { Shadow, ShadowValue } from '../fields/shadow.js';
export type { BoardStyles } from '../board/board.js';
