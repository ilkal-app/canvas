import type { VariationAxis } from './variation-axes.js';

/**
 * The step coordinates are rounded to: a sixteenth of an axis unit, so a slider dragged across a
 * weight axis makes at most sixteen layouts and glyph sets per unit, not one per pointer move.
 */
export const VARIATION_STEP = 1 / 16;

/**
 * The coordinates a face is drawn at for requested ones: each clamped to its axis,
 * rounded to {@link VARIATION_STEP} (unless that would leave the axis, whose ends a font may set
 * off the grid), and kept only when it differs from the axis's default. Tags
 * the face has no axis for, and values that are not finite, are dropped. Pure: it never changes
 * its inputs, and the result's tags are in the axes' order, whatever the request's order.
 *
 * @param axes - The face's axes.
 * @param requested - The coordinates asked for, by tag.
 * @returns The coordinates to draw at; empty for the default instance.
 */
export function normaliseVariations(
  axes: readonly VariationAxis[],
  requested: Readonly<Record<string, number>>,
): Record<string, number> {
  const normalised: Record<string, number> = {};
  for (const axis of axes) {
    if (!Object.hasOwn(requested, axis.tag)) continue;
    const value = requested[axis.tag];
    if (value === undefined || !Number.isFinite(value)) continue;
    const coordinate = onGrid(axis, value);
    // The default is put on the grid the same way, so asking for it gives the default instance.
    if (coordinate !== onGrid(axis, axis.default)) normalised[axis.tag] = coordinate;
  }
  return normalised;
}

/**
 * A value as the face is drawn at it: clamped to the axis, then rounded to the grid, unless that
 * would leave the axis (whose ends a font may set off the grid), where the clamped value stands.
 *
 * @param axis - The axis.
 * @param value - A finite value.
 * @returns The coordinate.
 */
function onGrid(axis: VariationAxis, value: number): number {
  const clamped = Math.min(axis.maximum, Math.max(axis.minimum, value));
  const rounded = Math.round(clamped / VARIATION_STEP) * VARIATION_STEP;
  return rounded < axis.minimum || rounded > axis.maximum ? clamped : rounded;
}
