import { describe, expect, it } from 'vitest';

import { DEFAULT_NOTE_COLOR, NOTE_COLORS, noteColorName } from './note-colors.js';

describe('NOTE_COLORS', () => {
  it("is the prototype's six-colour palette, yellow first and the default", () => {
    expect(NOTE_COLORS.map(({ name }) => name)).toEqual([
      'Yellow',
      'Pink',
      'Green',
      'Blue',
      'Orange',
      'Purple',
    ]);
    expect(NOTE_COLORS[0]?.color).toEqual([1, 0.92, 0.55, 1]);
    expect(DEFAULT_NOTE_COLOR).toBe(NOTE_COLORS[0]?.color);
  });

  it('is deeply frozen: the list, each entry and each colour refuse changes', () => {
    expect(Object.isFrozen(NOTE_COLORS)).toBe(true);
    for (const entry of NOTE_COLORS) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.color)).toBe(true);
    }
    expect(Reflect.set(DEFAULT_NOTE_COLOR, 0, 0)).toBe(false);
    expect(Reflect.set(NOTE_COLORS, 0, NOTE_COLORS[1])).toBe(false);
    expect(DEFAULT_NOTE_COLOR).toEqual([1, 0.92, 0.55, 1]);
  });

  it('names a palette colour by value, and nothing for a colour off the palette', () => {
    expect(noteColorName([0.66, 0.84, 0.98, 1])).toBe('Blue');
    expect(noteColorName([0.5, 0.5, 0.5, 1])).toBeUndefined();
  });
});
