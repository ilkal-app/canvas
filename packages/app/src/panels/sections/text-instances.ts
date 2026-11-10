import { FONT_WEIGHTS, type FontVariations, type FontWeight } from '@canvas/schema';
import { normaliseVariations, variationKey } from '@canvas/text';
import type { TextStylePatch } from '@canvas/tools';

import type { FamilyAxes } from '../../text-input/family-axes.js';
import { MIXED } from '../controls/mixed-value.js';
import type { SelectOption } from '../controls/select-control.js';

// A variable family's named instances as the style panel's weight choices: the
// instances the font names, the one the text is set at, and the style a choice writes. Pure.

/** What the weight field shows for coordinates no named instance has. */
export const CUSTOM_INSTANCE = 'Custom';

/** The weight axis's tag. */
const WEIGHT_AXIS = 'wght';

/**
 * The weight field's choices for a variable family: its named instances, in the font's order.
 *
 * @param axes - The family's axes and instances.
 * @returns One option per instance, named as the font names it.
 */
export function instanceOptions(axes: FamilyAxes): SelectOption[] {
  return axes.instances.map(({ name }) => ({ value: name, label: name }));
}

/**
 * The coordinates text is drawn at on every axis: its own, the axis's default where it sets none.
 *
 * @param axes - The family's axes.
 * @param fontVariations - The text's coordinates.
 * @returns A coordinate per axis.
 */
function onEveryAxis(axes: FamilyAxes, fontVariations: FontVariations): Record<string, number> {
  return Object.fromEntries(
    axes.axes.map(({ tag, default: value }) => [tag, fontVariations[tag] ?? value]),
  );
}

/**
 * The named instance text is set at: its coordinates on every axis, its weight standing for the
 * weight axis when it sets none (as layout draws it).
 *
 * @param axes - The family's axes and instances.
 * @param fontVariations - The text's coordinates; undefined when mixed.
 * @param weight - The text's weight; undefined when mixed.
 * @returns The instance's name, {@link CUSTOM_INSTANCE} when none matches, `MIXED` when mixed.
 */
export function selectedInstance(
  axes: FamilyAxes,
  fontVariations: FontVariations | undefined,
  weight: FontWeight | undefined,
): string | typeof MIXED {
  if (fontVariations === undefined || weight === undefined) return MIXED;
  // Compared as drawn: on the 1/16 grid, clamped to the axes, the defaults dropped.
  const text = variationKey(
    normaliseVariations(axes.axes, onEveryAxis(axes, { [WEIGHT_AXIS]: weight, ...fontVariations })),
  );
  const match = axes.instances.find(
    ({ coordinates }) =>
      variationKey(normaliseVariations(axes.axes, onEveryAxis(axes, coordinates))) === text,
  );
  return match?.name ?? CUSTOM_INSTANCE;
}

/**
 * The weight nearest a weight-axis value, among the nine a run may ask for.
 *
 * @param value - The `wght` coordinate.
 * @returns The weight, 100 to 900.
 */
function nearestWeight(value: number): FontWeight {
  const rounded = Math.min(900, Math.max(100, Math.round(value / 100) * 100));
  return FONT_WEIGHTS.find((weight) => weight === rounded) ?? 400;
}

/**
 * Coordinates without the axes left at their defaults: what text stores for them.
 *
 * @param axes - The family's axes.
 * @param coordinates - Coordinates by tag.
 * @returns The ones that differ from their axis's default.
 */
function withoutDefaults(
  axes: FamilyAxes,
  coordinates: Readonly<Record<string, number>>,
): Record<string, number> {
  return Object.fromEntries(
    axes.axes.flatMap(({ tag, default: value }) => {
      const coordinate = coordinates[tag];
      return coordinate === undefined || coordinate === value ? [] : [[tag, coordinate]];
    }),
  );
}

/**
 * The style choosing a named instance writes: the weight nearest its weight axis, which layout
 * draws the weight axis at, and its other coordinates, the defaults and a weight coordinate the
 * weight gives left out.
 *
 * @param axes - The family's axes and instances.
 * @param name - The instance's name.
 * @returns The patch, or undefined for a name the family does not have.
 */
export function instancePatch(axes: FamilyAxes, name: string): TextStylePatch | undefined {
  const instance = axes.instances.find((candidate) => candidate.name === name);
  if (instance === undefined) return undefined;
  const coordinates = withoutDefaults(axes, instance.coordinates);
  const wght = onEveryAxis(axes, instance.coordinates)[WEIGHT_AXIS];
  if (wght === undefined) return { fontVariations: coordinates };
  const weight = nearestWeight(wght);
  // The weight stands for the weight axis (layout draws it so): a wght it gives is left out.
  const { [WEIGHT_AXIS]: written, ...others } = coordinates;
  const fontVariations = written === undefined || written === weight ? others : coordinates;
  return { fontVariations, weight };
}

/**
 * Whether a family's weight is chosen by its named instances: it has instances and a weight axis.
 *
 * @param axes - The family's axes, or undefined while loading.
 * @returns True when the weight field lists instances.
 */
export function hasInstanceWeights(axes: FamilyAxes | undefined): axes is FamilyAxes {
  return (
    axes !== undefined &&
    axes.instances.length > 0 &&
    axes.axes.some(({ tag }) => tag === WEIGHT_AXIS)
  );
}
