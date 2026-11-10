import { z } from 'zod';

// Variant sets: a main names property axes (`state` with `rest`, `hover`, …), each
// value may carry a preset of override records, and an instance selects one value per axis.
// This module holds the names, the axes, the selection and the preset keys. Pure.

/** The most axes a main may define. */
export const MAX_VARIANT_AXES = 8;

/** The most values one axis may list. */
export const MAX_VARIANT_VALUES = 32;

/** The longest axis or value name, in characters. */
export const MAX_VARIANT_NAME = 64;

/**
 * An axis or value name: 1 to 64 characters, no `=` (it separates the two in a preset key) and
 * no leading or trailing spaces (two names that differ only there would look the same).
 */
export const variantNameSchema = z
  .string()
  .min(1)
  .max(MAX_VARIANT_NAME)
  .refine((name) => !name.includes('='), 'a variant name cannot contain "="')
  .refine((name) => name.trim() === name, 'a variant name cannot start or end with a space')
  .describe('An axis or value name: 1 to 64 characters, no "=", no edge spaces.');

/** One property axis: its name and its values, the first being the default. */
export const variantAxisSchema = z
  .strictObject({
    /** The axis name, for example `state`. */
    name: variantNameSchema.describe('The axis name, for example "state".'),
    /** Its values, unique; the first is the default an instance gets. */
    values: z
      .array(variantNameSchema)
      .min(1)
      .max(MAX_VARIANT_VALUES)
      .refine((values) => new Set(values).size === values.length, 'axis values must be unique')
      .describe('The values, unique; the first is the default.'),
  })
  .describe('A property axis and its values; the first value is the default.');

/** One property axis of a variant set. */
export type VariantAxis = z.output<typeof variantAxisSchema>;

/** A main's axes, in the order their presets compose: at most 8, names unique. */
export const variantAxesSchema = z
  .array(variantAxisSchema)
  .max(MAX_VARIANT_AXES)
  .refine(
    (axes) => new Set(axes.map(({ name }) => name)).size === axes.length,
    'axis names must be unique',
  )
  .describe('The property axes, in composition order; names unique.');

/**
 * Which value an instance (or a nested instance, through an override record) selects on each
 * axis. It may name axes or values its main no longer has: they are kept, so restoring them
 * restores the choice, and resolution ignores them.
 */
export const variantSelectionSchema = z
  .record(variantNameSchema, variantNameSchema)
  .refine(
    (selection) => Object.keys(selection).length <= MAX_VARIANT_AXES,
    `a variant selection names at most ${String(MAX_VARIANT_AXES)} axes`,
  )
  .describe('The value selected on each axis, by axis name.');

/** The value selected on each axis, by axis name. */
export type VariantSelection = z.output<typeof variantSelectionSchema>;

/**
 * The key of one axis value's preset: `axis=value`.
 *
 * @param axis - The axis name.
 * @param value - The value name.
 * @returns The preset key.
 */
export function presetKey(axis: string, value: string): string {
  return `${axis}=${value}`;
}

/** A preset key's two parts. */
export interface PresetKeyParts {
  /** The axis name. */
  readonly axis: string;
  /** The value name. */
  readonly value: string;
}

/**
 * Reads a preset key back into its axis and value.
 *
 * @param key - A stored preset key.
 * @returns The axis and value, or `undefined` when the key is not `axis=value` with valid names.
 */
export function parsePresetKey(key: string): PresetKeyParts | undefined {
  const separator = key.indexOf('=');
  if (separator < 0) return undefined;
  const axis = key.slice(0, separator);
  const value = key.slice(separator + 1);
  const isValid =
    variantNameSchema.safeParse(axis).success && variantNameSchema.safeParse(value).success;
  return isValid ? { axis, value } : undefined;
}

/**
 * The value in force on each axis: the selected one if the axis lists it, else the axis default.
 * Selections naming axes the main lacks are ignored.
 *
 * @param axes - The main's axes.
 * @param selection - The instance's selection, if any.
 * @returns Each axis with its value, in axis order.
 */
export function selectedValues(
  axes: readonly VariantAxis[],
  selection: Readonly<Record<string, string>> | undefined,
): [axis: string, value: string][] {
  return axes.map(({ name, values }) => {
    const chosen = selection?.[name];
    const value = chosen !== undefined && values.includes(chosen) ? chosen : values[0];
    return [name, value ?? ''];
  });
}
