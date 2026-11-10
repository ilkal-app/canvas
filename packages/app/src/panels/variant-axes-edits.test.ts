import { describe, expect, it } from 'vitest';

import {
  addAxis,
  addValue,
  isVariantName,
  makeDefault,
  nextVariantName,
  removeAxis,
  removeValue,
  renameAxis,
  renameValue,
} from './variant-axes-edits.js';

// The Variants section's axis edits: the whole new list, and the rename it carries.

const AXES = [
  { name: 'state', values: ['rest', 'hover'] },
  { name: 'size', values: ['s'] },
];

describe('variant axis edits', () => {
  it('accepts a name only when it is a new, trimmed, non-blank name without =', () => {
    expect(isVariantName('open', ['rest'])).toBe(true);
    for (const name of ['', ' open', 'open ', 'a=b', 'rest', 'x'.repeat(65)]) {
      expect(isVariantName(name, ['rest'])).toBe(false);
    }
  });

  it('names the next value or axis after those in use', () => {
    expect(nextVariantName('value', ['rest', 'hover'])).toBe('value 3');
    expect(nextVariantName('value', ['value 2', 'value 3'])).toBe('value 4');
  });

  it('adds, renames, reorders and removes values, renames carrying the preset', () => {
    expect(addValue(AXES, 0).axes[0]?.values).toEqual(['rest', 'hover', 'value 3']);
    expect(renameValue(AXES, 0, 'hover', 'over')).toEqual({
      axes: [{ name: 'state', values: ['rest', 'over'] }, AXES[1]],
      renames: { values: [{ axis: 'state', from: 'hover', to: 'over' }] },
    });
    expect(makeDefault(AXES, 0, 'hover').axes[0]?.values).toEqual(['hover', 'rest']);
    expect(removeValue(AXES, 0, 'rest').axes[0]?.values).toEqual(['hover']);
  });

  it('adds, renames and removes axes', () => {
    expect(addAxis(AXES).axes[2]).toEqual({ name: 'axis 3', values: ['default'] });
    expect(renameAxis(AXES, 1, 'scale')).toEqual({
      axes: [AXES[0], { name: 'scale', values: ['s'] }],
      renames: { axes: [{ from: 'size', to: 'scale' }] },
    });
    expect(removeAxis(AXES, 0).axes).toEqual([AXES[1]]);
  });

  it('copies the list, leaving the input as it was, and ignores a missing axis', () => {
    const edit = addValue(AXES, 0);
    expect(AXES[0]?.values).toEqual(['rest', 'hover']);
    expect(edit.axes[1]).not.toBe(AXES[1]);
    for (const missing of [
      addValue(AXES, 5),
      renameValue(AXES, 5, 'a', 'b'),
      removeValue(AXES, 5, 'a'),
      makeDefault(AXES, 5, 'a'),
      renameAxis(AXES, 5, 'b'),
    ]) {
      expect(missing).toEqual({ axes: AXES });
    }
  });
});
