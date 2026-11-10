// The schema's variant and swap exports: variant axes, selections and presets,
// effective overrides and their merge, and a swapped slot's effective main, re-exported by the
// package entry.
export { mergeOverrideRecords } from './override-merge.js';
export { effectiveSlotMain, namedSwapTargets, slotSwapIssue } from './effective-slot-main.js';
export type { SlotSwapIssue } from './effective-slot-main.js';
export { slotExpansion } from './slot-expansion.js';
export { mainClosure } from './main-closure.js';
export type { DefinitionReader } from './main-closure.js';
export {
  effectiveOverrides,
  effectiveOverridesOf,
  isMeasuredSizeCurrent,
} from './effective-overrides.js';
export {
  MAX_VARIANT_AXES,
  MAX_VARIANT_NAME,
  MAX_VARIANT_VALUES,
  parsePresetKey,
  presetKey,
  selectedValues,
  variantAxesSchema,
  variantAxisSchema,
  variantNameSchema,
  variantSelectionSchema,
} from './variants.js';
export type { PresetKeyParts, VariantAxis, VariantSelection } from './variants.js';
