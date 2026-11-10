import { describe, expect, it } from 'vitest';

import { component, id, shape } from './__fixtures__/component-objects.js';
import { isPaintOnlyPresetEdit, presetEdits } from './main-reads.js';

const AXES = [{ name: 'state', values: ['rest', 'hover'] }];
const RED: [number, number, number, number] = [1, 0, 0, 1];
const BLUE: [number, number, number, number] = [0, 0, 1, 1];

/**
 * A main whose `hover` preset holds the given records.
 *
 * @param hover - The preset's records.
 * @returns The main.
 */
function mainWith(hover: Record<string, unknown>) {
  return component('main', { variantAxes: AXES, variantPresets: { 'state=hover': hover } });
}

describe('presetEdits with geometry', () => {
  it('names the children a paint edit changes', () => {
    expect(presetEdits(mainWith({ bg: { fill: RED } }), mainWith({ bg: { fill: BLUE } }))).toEqual(
      new Set([id('bg')]),
    );
  });

  it('asks for a full resolution when a record gains or loses geometry, or is the root', () => {
    expect(presetEdits(mainWith({}), mainWith({ bg: { x: 4 } }))).toBeUndefined();
    expect(presetEdits(mainWith({ bg: { width: 4 } }), mainWith({}))).toBeUndefined();
    expect(presetEdits(mainWith({}), mainWith({ main: { width: 48 } }))).toBeUndefined();
  });
});

describe('isPaintOnlyPresetEdit', () => {
  it('is true when records differ in fill, strokeColor or color alone', () => {
    const before = mainWith({ bg: { fill: RED, isHidden: false } });
    const after = mainWith({ bg: { fill: BLUE, strokeColor: RED, isHidden: false }, tag: {} });
    expect(isPaintOnlyPresetEdit(before, after)).toBe(true);
  });

  it('is false for a change a layout reads, or for anything but two mains', () => {
    expect(isPaintOnlyPresetEdit(mainWith({}), mainWith({ bg: { isHidden: true } }))).toBe(false);
    expect(isPaintOnlyPresetEdit(mainWith({}), mainWith({ bg: { text: 'x' } }))).toBe(false);
    expect(isPaintOnlyPresetEdit(shape('bg', null), mainWith({}))).toBe(false);
    expect(isPaintOnlyPresetEdit(mainWith({}), undefined)).toBe(false);
  });
});
