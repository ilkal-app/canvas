import { describe, expect, it } from 'vitest';

import { InstanceFonts, MAX_VARIATION_INSTANCES } from './instance-fonts.js';

describe('InstanceFonts', () => {
  it('makes a font once per face while it is kept', () => {
    let made = 0;
    const fonts = new InstanceFonts<string, number>(
      () => (made += 1),
      () => undefined,
    );
    expect(fonts.fontOf('a')).toBe(1);
    expect(fonts.fontOf('a')).toBe(1);
    expect(made).toBe(1);
  });

  it('drops the least recently used face first, and remakes its font on use', () => {
    const dropped: number[] = [];
    const fonts = new InstanceFonts<number, string>(
      (face) => `font ${String(face)}`,
      (face) => dropped.push(face),
    );
    for (let face = 0; face < MAX_VARIATION_INSTANCES; face += 1) fonts.fontOf(face);
    // Using face 0 again makes face 1 the least recently used.
    fonts.fontOf(0);
    fonts.fontOf(MAX_VARIATION_INSTANCES);
    expect(dropped).toEqual([1]);
    expect(fonts.fontOf(1)).toBe('font 1');
    expect(dropped).toEqual([1, 2]);
  });
});
