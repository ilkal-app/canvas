import { describe, expect, it } from 'vitest';

import { importBoard } from '@canvas/schema';

import { createFixtureBoardJson } from '../codec/__fixtures__/fixture-board-json.js';

import { checkWrittenFields } from './written-fields.js';

// A main's axes and presets are one cross-field unit: a preset key must name one of the
// main's axis values, so a write of either judges both.

const AXES = [{ name: 'state', values: ['rest', 'hover'] }];

/** The fixture board's main, stored with variants. */
const STORED: Record<string, unknown> = {
  ...[...importBoard(createFixtureBoardJson(true)).objects.values()].find(
    ({ type }) => type === 'component',
  ),
  variantAxes: AXES,
  variantPresets: { 'state=rest': {}, 'state=hover': {} },
};

/**
 * The paths of a check's issues.
 *
 * @param written - The object as written.
 * @returns The paths, joined.
 */
function issuePaths(written: Record<string, unknown>): string[] {
  return (checkWrittenFields(written, STORED)?.issues ?? []).map(({ path }) => path.join('.'));
}

describe("checkWrittenFields on a main's variants", () => {
  it('accepts presets that fit the axes, and writes the unit whole', () => {
    const written = {
      ...STORED,
      variantPresets: { 'state=rest': {}, 'state=hover': { a: { isHidden: true } } },
    };
    const checked = checkWrittenFields(written, STORED);
    expect(checked?.issues).toEqual([]);
    expect([...(checked?.written ?? [])]).toEqual(
      expect.arrayContaining(['variantAxes', 'variantPresets']),
    );
  });

  it('refuses a preset key that names no axis value', () => {
    expect(
      issuePaths({
        ...STORED,
        variantPresets: { 'state=rest': {}, 'state=hover': {}, 'size=big': {} },
      }),
    ).toEqual(['variantPresets']);
  });

  it("refuses a field's own bad value, under its path", () => {
    expect(issuePaths({ ...STORED, variantAxes: [AXES[0], AXES[0]] })).toEqual(['variantAxes']);
    expect(
      issuePaths({ ...STORED, variantPresets: { 'state=rest': { a: { isHidden: 'yes' } } } }),
    ).toEqual(['variantPresets.state=rest.a.isHidden']);
  });

  it('accepts removing both, writing neither back', () => {
    const removed: Record<string, unknown> = { ...STORED };
    delete removed.variantAxes;
    delete removed.variantPresets;
    const checked = checkWrittenFields(removed, STORED);
    expect(checked?.issues).toEqual([]);
    expect(checked?.object).not.toHaveProperty('variantAxes');
    expect(checked?.object).not.toHaveProperty('variantPresets');
  });
});
