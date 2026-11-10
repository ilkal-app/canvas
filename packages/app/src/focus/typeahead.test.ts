// @vitest-environment jsdom
// Menus and listboxes find an item by its first letters.
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { isTypeaheadKey, typeaheadIndex, useTypeahead } from './typeahead.js';

const NONE = { ctrlKey: false, altKey: false, metaKey: false };
const NAMES = ['Liberation Sans', 'Lora', 'Inter', 'Lexend'];

describe('typeaheadIndex', () => {
  it('moves one letter past the active item, cycling through the items it starts', () => {
    expect(typeaheadIndex(NAMES, 0, 'l')).toBe(1);
    expect(typeaheadIndex(NAMES, 1, 'l')).toBe(3);
    expect(typeaheadIndex(NAMES, 3, 'L')).toBe(0);
    expect(typeaheadIndex(NAMES, -1, 'i')).toBe(2);
  });

  it('keeps a longer prefix on the active item while it still names it', () => {
    expect(typeaheadIndex(NAMES, 1, 'lo')).toBe(1);
    expect(typeaheadIndex(NAMES, 0, 'lo')).toBe(1);
    expect(typeaheadIndex(NAMES, 0, 'lib')).toBe(0);
  });

  it('names nothing when no item starts with the prefix', () => {
    expect(typeaheadIndex(NAMES, 0, 'z')).toBeUndefined();
    expect(typeaheadIndex([], 0, 'a')).toBeUndefined();
  });
});

describe('isTypeaheadKey', () => {
  it('takes a printable character without Control, Alt or Meta', () => {
    expect(isTypeaheadKey({ key: 'a', ...NONE }, false)).toBe(true);
    expect(isTypeaheadKey({ key: '7', ...NONE }, false)).toBe(true);
    expect(isTypeaheadKey({ key: 'ArrowDown', ...NONE }, false)).toBe(false);
    expect(isTypeaheadKey({ key: 'a', ...NONE, ctrlKey: true }, false)).toBe(false);
    expect(isTypeaheadKey({ key: 'a', ...NONE, metaKey: true }, false)).toBe(false);
  });

  it('leaves Space to choose, unless a prefix is under way', () => {
    expect(isTypeaheadKey({ key: ' ', ...NONE }, false)).toBe(false);
    expect(isTypeaheadKey({ key: ' ', ...NONE }, true)).toBe(true);
  });
});

describe('useTypeahead', () => {
  it('cycles a repeated letter, and takes a letter that names nothing as typed', () => {
    const { result } = renderHook(() => useTypeahead());
    const type = (key: string, active: number) => result.current({ key, ...NONE }, NAMES, active);
    expect(type('l', 0)).toEqual({ next: 1 });
    // L again cycles to the next L, not "ll".
    expect(type('l', 1)).toEqual({ next: 3 });
    expect(type('v', 3)).toEqual({ next: undefined });
    expect(type('ArrowDown', 3)).toBeUndefined();
  });
});
