import { z } from 'zod';

/** The most axes a run's variable-font coordinates may set. */
export const MAX_FONT_VARIATION_AXES = 16;

/** The least coordinate an axis may be set to: OpenType's `Fixed` holds -32768 to 32767. */
const MIN_COORDINATE = -32768;

/** The greatest coordinate an axis may be set to. */
const MAX_COORDINATE = 32767;

/** An OpenType axis tag: four printable ASCII characters (U+0020 to U+007E). */
const AXIS_TAG = /^[\u0020-\u007e]{4}$/u;

/**
 * Validates a run's variable-font coordinates: axis tag to value, in the axis's own
 * units (`wght` 100 to 900, `wdth` in percent, `opsz` in points). At most
 * {@link MAX_FONT_VARIATION_AXES} axes; an axis the font lacks is ignored when drawing, and a
 * value outside the font's axis is clamped to it. Empty is the same as none.
 */
export const fontVariationsSchema = z
  .record(z.string().regex(AXIS_TAG), z.number().min(MIN_COORDINATE).max(MAX_COORDINATE))
  .refine((coordinates) => Object.keys(coordinates).length <= MAX_FONT_VARIATION_AXES, {
    message: `At most ${String(MAX_FONT_VARIATION_AXES)} axes.`,
  });

/** A run's variable-font coordinates, by axis tag. */
export type FontVariations = z.output<typeof fontVariationsSchema>;

/**
 * Tells whether two runs' coordinates are the same: equal values for the same tags, whatever
 * their order; absent and empty are the same (the font's defaults).
 *
 * @param first - One run's coordinates, or undefined for none.
 * @param second - The other's.
 * @returns True when they are the same.
 */
export function isSameFontVariations(
  first: FontVariations | undefined,
  second: FontVariations | undefined,
): boolean {
  const entries = Object.entries(first ?? {});
  const other = second ?? {};
  return (
    entries.length === Object.keys(other).length &&
    entries.every(([tag, value]) => other[tag] === value)
  );
}

/**
 * Validates a change to some axes of a run's coordinates: axis tag to a value to set,
 * or `null` to remove the tag; the run's other axes are kept. At most
 * {@link MAX_FONT_VARIATION_AXES} tags.
 */
export const fontVariationAxesSchema = z
  .record(z.string().regex(AXIS_TAG), z.number().min(MIN_COORDINATE).max(MAX_COORDINATE).nullable())
  .refine((axes) => Object.keys(axes).length <= MAX_FONT_VARIATION_AXES, {
    message: `At most ${String(MAX_FONT_VARIATION_AXES)} axes.`,
  });

/** A change to some axes of a run's coordinates: a value to set, or `null` to remove the tag. */
export type FontVariationAxes = z.output<typeof fontVariationAxesSchema>;

/**
 * A run's coordinates with some axes changed: the given tags set, those given `null`
 * removed, the others kept. Pure.
 *
 * @param current - The run's coordinates, or undefined for none.
 * @param axes - The axes to change.
 * @returns The new coordinates; undefined when none are left.
 */
export function mergeFontVariations(
  current: FontVariations | undefined,
  axes: FontVariationAxes,
): FontVariations | undefined {
  const merged: Record<string, number> = { ...current };
  for (const [tag, value] of Object.entries(axes)) {
    if (value === null) Reflect.deleteProperty(merged, tag);
    else merged[tag] = value;
  }
  return Object.keys(merged).length === 0 ? undefined : merged;
}
