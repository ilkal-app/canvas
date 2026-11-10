import { describe, expect, it } from 'vitest';

import { resolveParagraphLevels, visualOrder } from './bidi-levels.js';

describe('bidi levels', () => {
  it('pairs no brackets in a sequence whose 64th opening bracket finds the stack full (BD16)', () => {
    const openers = '['.repeat(64);
    const paired = resolveParagraphLevels(`a${openers}(b)א`, 'rtl');
    // The same text with the pair's brackets replaced by neutrals that pair with nothing. Paired,
    // ')' takes the L context of 'a' (N0); unpaired, it lies between L and R and takes R (N2).
    const unpaired = resolveParagraphLevels(`a${openers}!b!א`, 'rtl');
    expect(Array.from(paired.levels)).toEqual(Array.from(unpaired.levels));
  });

  it('pairs U+2329 and U+232A as their canonical equivalents U+3008 and U+3009 (BD16)', () => {
    const levelsOf = (text: string): number[] =>
      Array.from(resolveParagraphLevels(text, 'rtl').levels);
    const canonical = levelsOf('a\u3008b\u3009א');
    expect(levelsOf('a\u2329b\u232aא')).toEqual(canonical);
    expect(levelsOf('a\u2329b\u3009א')).toEqual(canonical);
    expect(levelsOf('a!b!א')).not.toEqual(canonical);
  });

  it('still pairs brackets below the stack limit', () => {
    const openers = '['.repeat(62);
    const paired = resolveParagraphLevels(`a${openers}(b)א`, 'rtl');
    const unpaired = resolveParagraphLevels(`a${openers}!b!א`, 'rtl');
    expect(Array.from(paired.levels)).not.toEqual(Array.from(unpaired.levels));
  });

  it('reverses each level run in place, many short runs included', () => {
    const levels = Array.from({ length: 10_000 }, (unused, index) => (index % 3 === 0 ? 1 : 2));
    const order = visualOrder(levels);
    expect(order).toHaveLength(levels.length);
    expect(new Set(order).size).toBe(levels.length);
    expect(order[0]).toBe(levels.length - 1);
  });
});
