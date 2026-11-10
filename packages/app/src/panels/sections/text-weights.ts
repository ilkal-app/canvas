import { FONT_WEIGHTS, type FontWeight } from '@canvas/schema';

import type { SelectOption } from '../controls/select-control.js';

// The style panel's weight field: the weights a family supplies, named as type
// designers name them, the text's own weight kept even when the family lacks it (it draws with
// the nearest face, which the option says). Pure.

/** Each weight's name, as Figma and type designers use them. */
export const WEIGHT_NAMES: Readonly<Record<FontWeight, string>> = Object.freeze({
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
});

/** The weights a family is drawn in when its faces are not known (a remote or local family). */
const UNKNOWN_FAMILY_WEIGHTS: readonly FontWeight[] = [400, 700];

/**
 * The weights a family supplies, in either slant, lightest first.
 *
 * @param faces - The family's faces (`FontFamilyEntry.faces`), or undefined when not bundled.
 * @returns Its weights; regular and bold for a family whose faces are not known.
 */
export function familyWeights(
  faces: readonly { readonly weight: FontWeight }[] | undefined,
): FontWeight[] {
  if (faces === undefined || faces.length === 0) return [...UNKNOWN_FAMILY_WEIGHTS];
  const weights = new Set(faces.map(({ weight }) => weight));
  return FONT_WEIGHTS.filter((weight) => weights.has(weight));
}

/**
 * The weight field's choices: the family's weights, and the text's own weight when the family
 * lacks it, marked as drawn by the nearest face.
 *
 * @param weights - The family's weights (`familyWeights`).
 * @param current - The text's weight, or undefined when mixed.
 * @returns The options, lightest first.
 */
export function weightOptions(
  weights: readonly FontWeight[],
  current: FontWeight | undefined,
): SelectOption[] {
  const shown = new Set<FontWeight>(weights);
  if (current !== undefined) shown.add(current);
  return FONT_WEIGHTS.filter((weight) => shown.has(weight)).map((weight) => ({
    value: String(weight),
    label: weights.includes(weight)
      ? `${WEIGHT_NAMES[weight]} ${String(weight)}`
      : `${WEIGHT_NAMES[weight]} ${String(weight)} (nearest face)`,
  }));
}
