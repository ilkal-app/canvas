import { describe, expect, it } from 'vitest';

import { BASE_COLOR, readInkable } from './inkable-color.js';

describe('readInkable', () => {
  it('reads ink and a tuple as stored, anything else as the base colour', () => {
    expect(readInkable('ink')).toBe('ink');
    expect(readInkable([0, 1, 0, 1])).toEqual([0, 1, 0, 1]);
    for (const value of [undefined, 'INK', [0, 1, 0], [0, '1', 0, 1], { r: 0 }]) {
      expect(readInkable(value)).toBe(BASE_COLOR);
    }
    expect(BASE_COLOR).toEqual([0, 0, 0, 1]);
  });

  it('keeps a valid colour token reference for the renderer to resolve', () => {
    const ref = { token: 'accent' };
    expect(readInkable(ref)).toBe(ref);
    for (const value of [{ token: 'has space' }, { token: 'accent', extra: 1 }, { token: 3 }]) {
      expect(readInkable(value)).toBe(BASE_COLOR);
    }
  });
});
