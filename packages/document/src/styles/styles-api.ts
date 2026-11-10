// The document's named style exports: the stored style maps, the style
// commands and the text style patch, re-exported by the package entry.
export {
  EFFECT_STYLES_MAP_NAME,
  parseStyleKey,
  readStyles,
  STYLE_FIELDS,
  STYLE_MAP_NAMES,
  styleKey,
  TEXT_STYLES_MAP_NAME,
} from './style-map.js';
export type {
  ParsedStyleKey,
  StyleCreation,
  StyleEntry,
  StyleField,
  StyleIdentity,
  StyleKind,
  StyleTable,
  StyleWrite,
} from './style-map.js';
export {
  setEffectStyleCommand,
  setEffectStyleInputSchema,
  setTextStyleCommand,
  setTextStyleInputSchema,
} from '../commands/styles/set-named-style.js';
export {
  replaceFontFamilyCommand,
  replaceFontFamilyInputSchema,
} from '../commands/replace-font-family.js';
export type {
  ReplaceFontFamilyInput,
  ReplaceFontFamilyPlan,
  ReplaceFontFamilyResult,
  SkippedFontUse,
} from '../commands/replace-font-family.js';
export type {
  MeasuredBox,
  SetNamedStylePlan,
  SetNamedStyleResult,
} from '../commands/styles/set-named-style.js';
export type { BoundRange } from '../commands/styles/style-support.js';
export {
  deleteEffectStyleCommand,
  deleteNamedStyleInputSchema,
  deleteTextStyleCommand,
} from '../commands/styles/delete-named-style.js';
export type {
  DeleteNamedStylePlan,
  DeleteNamedStyleResult,
} from '../commands/styles/delete-named-style.js';
export type { TextStylePatch } from '../codec/style-attributes.js';
export type { NamedStyleChanges, NamedStyleReads, NamedStyleWrites } from '../store/style-store.js';
export {
  createObjectsWithStylesCommand,
  createObjectsWithStylesInputSchema,
} from '../commands/styles/create-objects-with-styles.js';
export type {
  CreateObjectsWithStylesInput,
  CreateObjectsWithStylesPlan,
  CreateObjectsWithStylesResult,
  StyleItemResult,
} from '../commands/styles/create-objects-with-styles.js';
