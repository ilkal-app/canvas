import type { FontWeight } from '@canvas/schema';
import type { TextStylePatch } from '@canvas/tools';

import type { FontFamilyEntry } from './font-catalogue.js';

/**
 * Bundled variable families: one upright 400 file each, whose axes stand for its
 * weights. Inter Variable is Inter 4.001's `opsz`/`wght` font, subset to latin
 * (tooling/fonts/variable-families.json; the owner added it as a 32nd family on 2026-10-18).
 */
export const VARIABLE_FONTS: readonly FontFamilyEntry[] = [
  {
    family: 'Inter Variable',
    category: 'sans',
    faces: [
      {
        family: 'Inter Variable',
        weight: 400,
        isItalic: false,
        url: new URL('../../assets/fonts/library/intervariable/400.ttf?no-inline', import.meta.url)
          .href,
      },
    ],
  },
];

/** The families with axes: the bundled variable ones. */
const VARIABLE_FAMILIES: ReadonlySet<string> = new Set(VARIABLE_FONTS.map(({ family }) => family));

/**
 * Whether a family is a bundled variable one, whose axes the style panel offers.
 *
 * @param family - The family.
 * @returns True for a bundled variable family.
 */
export function isVariableFamily(family: string): boolean {
  return VARIABLE_FAMILIES.has(family);
}

/**
 * The fields a weight choice sets (the Bold toggle, mod+b): on a bundled variable family the
 * weight drives the weight axis, so an explicit `wght` the runs set is removed too and
 * the new weight shows; each run keeps its other coordinates. Pure.
 *
 * @param weight - The weight chosen.
 * @param family - The targeted text's family, or undefined when mixed.
 * @returns The fields to set.
 */
export function weightPatchOf(weight: FontWeight, family: string | undefined): TextStylePatch {
  if (family === undefined || !isVariableFamily(family)) return { weight };
  return { weight, fontVariationsAxes: { wght: null } };
}
