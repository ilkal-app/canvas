import { describe, expect, it } from 'vitest';

import { isCharacterBoundary } from './character-boundary.js';

describe('isCharacterBoundary', () => {
  it('is false only between the halves of a surrogate pair', () => {
    expect(isCharacterBoundary('a😀', 0)).toBe(true);
    expect(isCharacterBoundary('a😀', 1)).toBe(true);
    expect(isCharacterBoundary('a😀', 2)).toBe(false);
    expect(isCharacterBoundary('a😀', 3)).toBe(true);
  });

  it('treats the ends of the text and positions past it as boundaries', () => {
    expect(isCharacterBoundary('', 0)).toBe(true);
    expect(isCharacterBoundary('😀', 0)).toBe(true);
    expect(isCharacterBoundary('😀', 2)).toBe(true);
    expect(isCharacterBoundary('😀', 5)).toBe(true);
  });

  it('counts code points, not grapheme clusters: a boundary inside a ZWJ sequence is allowed', () => {
    // 👩‍💻 is U+1F469 U+200D U+1F4BB: one grapheme, three code points, five code units.
    const technologist = '\u{1F469}\u200D\u{1F4BB}';
    expect(isCharacterBoundary(technologist, 2)).toBe(true);
    expect(isCharacterBoundary(technologist, 3)).toBe(true);
    expect(isCharacterBoundary(technologist, 4)).toBe(false);
  });

  it('allows a boundary next to a lone surrogate, which is not a pair to split', () => {
    expect(isCharacterBoundary('\uD83Dx', 1)).toBe(true);
    expect(isCharacterBoundary('x\uDE00', 1)).toBe(true);
  });
});
