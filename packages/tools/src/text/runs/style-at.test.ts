import { describe, expect, it } from 'vitest';

import { BASE, BOLD, LARGE, RED, runsOf } from './__fixtures__/text-styles.js';
import { maxFontSize, styleAt, styleOfCharacter } from './style-at.js';

const RUNS = runsOf([2, BASE], [3, BOLD], [1, RED]);

describe('styleAt and styleOfCharacter', () => {
  it('gives the style of the character before a caret, the first run at 0', () => {
    expect(styleAt(RUNS, 0)).toBe(BASE);
    expect(styleAt(RUNS, 2)).toBe(BASE);
    expect(styleAt(RUNS, 3)).toBe(BOLD);
    expect(styleAt(RUNS, 6)).toBe(RED);
    expect(styleAt(RUNS, 99)).toBe(RED);
    expect(styleAt(runsOf([0, BOLD]), 0)).toBe(BOLD);
  });

  it('gives the style of the character at an index, clamped to the last run', () => {
    expect(styleOfCharacter(RUNS, 0)).toBe(BASE);
    expect(styleOfCharacter(RUNS, 2)).toBe(BOLD);
    expect(styleOfCharacter(RUNS, 5)).toBe(RED);
    expect(styleOfCharacter(RUNS, 9)).toBe(RED);
    expect(() => styleOfCharacter([], 0)).toThrow(RangeError);
  });

  it('finds the largest font size', () => {
    expect(maxFontSize(runsOf([1, BASE], [1, LARGE]))).toBe(32);
    expect(maxFontSize([])).toBe(0);
  });
});
