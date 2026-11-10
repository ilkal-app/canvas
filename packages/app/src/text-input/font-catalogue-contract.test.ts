// The shared font catalogue agents read (`BUNDLED_FONT_CATALOGUE` in @canvas/text,
// generated from the same font files and library catalogue) offers exactly the families, faces
// and categories the app's font picker offers, so `list_fonts` never names a font the app cannot
// draw, nor misses one it can.
import { describe, expect, it } from 'vitest';

import { BUNDLED_FONT_CATALOGUE, DEFAULT_FONT_FAMILY } from '@canvas/text';

import { COVERAGE_FONT_FAMILIES } from './coverage-fonts.js';
import { DEFAULT_TEXT_STYLE, FONT_FAMILIES } from './font-catalogue.js';

/**
 * A family as the catalogue and the picker can both describe it: name, category and faces in a
 * stable order.
 *
 * @param entry - A family.
 * @param entry.family - Its name.
 * @param entry.category - Its category.
 * @param entry.faces - Its faces.
 * @returns The comparable shape.
 */
function comparable(entry: {
  readonly family: string;
  readonly category: string;
  readonly faces: readonly { readonly weight: number; readonly isItalic: boolean }[];
}) {
  return {
    family: entry.family,
    category: entry.category,
    faces: entry.faces
      .map(({ weight, isItalic }) => `${String(weight)}${isItalic ? 'i' : ''}`)
      .sort(),
  };
}

/**
 * Families by name.
 *
 * @param entries - The families.
 * @returns Their comparable shapes, sorted by name.
 */
function byName(entries: readonly Parameters<typeof comparable>[0][]) {
  return entries.map(comparable).sort((first, second) => first.family.localeCompare(second.family));
}

describe('the shared font catalogue', () => {
  it('offers exactly the app picker’s families, categories and faces', () => {
    expect(byName(BUNDLED_FONT_CATALOGUE)).toEqual(byName(FONT_FAMILIES));
  });

  it('has the app’s default family first', () => {
    expect(BUNDLED_FONT_CATALOGUE[0]?.family).toBe(DEFAULT_FONT_FAMILY);
    expect(FONT_FAMILIES[0]?.family).toBe(DEFAULT_FONT_FAMILY);
    expect(DEFAULT_TEXT_STYLE.fontFamily).toBe(DEFAULT_FONT_FAMILY);
  });

  it('leaves out the coverage faces text never names', () => {
    const names = new Set(BUNDLED_FONT_CATALOGUE.map(({ family }) => family));
    for (const { family } of COVERAGE_FONT_FAMILIES) expect(names.has(family)).toBe(false);
  });
});
