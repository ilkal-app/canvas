// The popover colour buttons' palettes.
import { describe, expect, it } from 'vitest';

import { popoverPaletteOf, recentChoicesOf, stickyColourGroup } from './popover-colours.js';

const TABLE = new Map();

describe('popover colours', () => {
  it('lists the sticky colours in the Sticky panel’s order', () => {
    expect(stickyColourGroup().choices.map((choice) => choice.label)).toEqual([
      'Yellow',
      'Pink',
      'Green',
      'Blue',
      'Purple',
      'Orange',
    ]);
  });

  it('offers a note the sticky colours and tokens, and text ink too', () => {
    const note = popoverPaletteOf('note', TABLE, 'light').flatMap((group) => group.choices);
    expect(note.some((choice) => choice.value === 'ink')).toBe(false);
    const text = popoverPaletteOf('text', TABLE, 'light').flatMap((group) => group.choices);
    expect(text.some((choice) => choice.value === 'ink')).toBe(true);
  });

  it('leaves ink out of a note’s recent colours, and drops values that are no colour', () => {
    const recent = ['ink', '#ff8040', 'nonsense', 'none'];
    expect(recentChoicesOf(recent, TABLE, 'light', false).map((choice) => choice.value)).toEqual([
      '#ff8040',
    ]);
    expect(recentChoicesOf(recent, TABLE, 'light', true).map((choice) => choice.value)).toEqual([
      'ink',
      '#ff8040',
    ]);
  });
});
