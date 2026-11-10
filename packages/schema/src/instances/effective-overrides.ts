import type { Board } from '../board/board.js';
import type { ComponentObject } from '../objects/component-object.js';
import type { InstanceObject } from '../objects/instance-object.js';

import type { InstanceOverrides, OverrideRecord } from './instance-overrides.js';
import { mergeOverrideRecords } from './override-merge.js';
import { presetKey, selectedValues } from './variants.js';

// An instance's effective overrides: the presets of the values it selects, composed in
// axis order, then its own records on top, each layer merged field by field like nested records
// (`mergeOverrideRecords`). Every resolver reads these, never `instance.overrides` alone. Pure.

/**
 * The layers to compose for an instance of a main: each selected value's preset in axis order,
 * then the instance's own records.
 *
 * @param instance - The instance.
 * @param main - Its main.
 * @returns The layers, earliest first.
 */
function layersOf(instance: InstanceObject, main: ComponentObject): InstanceOverrides[] {
  const axes = main.variantAxes ?? [];
  const presets = main.variantPresets ?? {};
  const layers: InstanceOverrides[] = [];
  for (const [axis, value] of selectedValues(axes, instance.variant)) {
    const preset = presets[presetKey(axis, value)];
    if (preset !== undefined) layers.push(preset);
  }
  layers.push(instance.overrides);
  return layers;
}

/**
 * An instance's effective overrides: the presets of its selected values composed in axis order
 * (a later axis winning field by field), its own records on top, merged as nested records merge.
 * A composed `measuredSize` is kept only when no later layer supplied a text field at that path
 * (`text`, `runs` or a `textStyle` key) without its own size; otherwise the merge drops it as
 * unmeasured (`mergeOverrideRecords`).
 *
 * @param instance - The instance; not changed.
 * @param main - Its main; not changed.
 * @returns The records to resolve with; `instance.overrides` itself when the main has no axes.
 */
export function effectiveOverrides(
  instance: InstanceObject,
  main: ComponentObject,
): InstanceOverrides {
  if (main.variantAxes === undefined) return instance.overrides;
  const composed: Record<string, OverrideRecord> = {};
  for (const layer of layersOf(instance, main)) {
    for (const [path, record] of Object.entries(layer)) {
      composed[path] = mergeOverrideRecords(composed[path], record);
    }
  }
  return composed;
}

/**
 * {@link effectiveOverrides} with the main looked up on the board.
 *
 * @param instance - The instance.
 * @param board - The board holding its main.
 * @returns Its effective overrides; its own when the main is missing or not a main.
 */
export function effectiveOverridesOf(instance: InstanceObject, board: Board): InstanceOverrides {
  const main = board.objects.get(instance.mainId);
  return main?.type === 'component' ? effectiveOverrides(instance, main) : instance.overrides;
}

/**
 * Whether a record's measured size still holds for the fonts in use: it has one, and it
 * was measured with this bundled-font fingerprint. A size measured with other fonts, or with no
 * fingerprint recorded, is measured again. Composition already drops a size a later layer's text
 * made stale ({@link effectiveOverrides}); this is the fonts half.
 *
 * @param record - A composed override record.
 * @param fingerprint - The bundled-font fingerprint in use (`BUNDLED_FONTS_FINGERPRINT`).
 * @returns Whether its `measuredSize` can be used as is.
 */
export function isMeasuredSizeCurrent(record: OverrideRecord, fingerprint: string): boolean {
  return record.measuredSize?.fonts === fingerprint;
}
