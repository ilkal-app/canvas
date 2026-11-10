import { z } from 'zod';

import { autoLayoutSchema } from '../fields/auto-layout.js';
import { colorModeSchema } from '../fields/color-tokens.js';
import { layerShape } from '../fields/opacity.js';
import { visibilityShape } from '../fields/visibility.js';
import { instanceOverridesSchema } from '../instances/instance-overrides.js';
import { parsePresetKey, variantAxesSchema, type VariantAxis } from '../instances/variants.js';

import { baseObjectSchema, boxShape } from './base-object.js';

/**
 * A board-local main definition with ordinary stored children. Retirement hides the main
 * while retaining its content for instances placed concurrently with deletion.
 */
export const componentObjectSchema = baseObjectSchema
  .extend({
    /** Always `component`: a named definition container. */
    type: z.literal('component'),
    /** The layer's opacity from 0 to 1; absent is opaque. */
    ...layerShape,
    ...visibilityShape,
    ...boxShape,
    /** The name shown in the component list and on the main. */
    name: z.string().max(200).describe('The board-local main name.'),
    /** Whether deletion has hidden this definition while retaining its content. */
    retired: z
      .boolean()
      .describe('Whether the deleted main is retained invisibly for concurrent instances.'),
    /** Its live auto-layout, which its instances follow; absent for none. */
    autoLayout: autoLayoutSchema
      .optional()
      .describe('Its live auto-layout, which its instances follow; omit for none.'),
    /** The colour mode of the main's content and of instances that set none. */
    colorMode: colorModeSchema.optional(),
    /** Its property axes, in the order their presets compose; absent for none. */
    variantAxes: variantAxesSchema
      .optional()
      .describe('Its variant property axes, in composition order; omit for none.'),
    /**
     * Override records per axis value, keyed `axis=value` (`presetKey`), with paths relative to
     * this main as an instance's are; a value may have none.
     */
    variantPresets: z
      .record(z.string(), instanceOverridesSchema)
      .optional()
      .describe('Override records per axis value, keyed "axis=value"; paths as in overrides.'),
  })
  .superRefine((main, context) => {
    for (const message of variantPresetIssues(main.variantAxes, main.variantPresets)) {
      context.addIssue({ code: 'custom', path: ['variantPresets'], message });
    }
  });

/**
 * Why a main's presets do not fit its axes: presets without axes, or a key that is not
 * `axis=value` for one of its axes and values. Empty when they fit.
 *
 * @param axes - The main's axes, if any.
 * @param presets - Its presets, if any.
 * @returns The issues, as messages.
 */
export function variantPresetIssues(
  axes: readonly VariantAxis[] | undefined,
  presets: Readonly<Record<string, unknown>> | undefined,
): string[] {
  if (presets === undefined) return [];
  if (axes === undefined) return ['variant presets need variant axes'];
  return Object.keys(presets).flatMap((key) => {
    const parsed = parsePresetKey(key);
    const axis = axes.find(({ name }) => name === parsed?.axis);
    return parsed !== undefined && axis?.values.includes(parsed.value) === true
      ? []
      : [`"${key}" names no axis value of this main`];
  });
}

/** A main definition and its retained retirement state. */
export type ComponentObject = z.output<typeof componentObjectSchema>;
