import { afterEach, describe, expect, it, vi } from 'vitest';

import { lineBreakOpportunities } from './line-breaks.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The indices of a text's break opportunities.
 *
 * @param text - The text.
 * @returns The indices, the text's end included.
 */
function indices(text: string): number[] {
  return lineBreakOpportunities(text).map(({ index }) => index);
}

describe('lineBreakOpportunities', () => {
  it('keeps a prefix with an opening parenthesis before a decimal (LB25)', () => {
    expect(indices('$(.5')).toEqual([4]);
  });

  it('leaves a lone complex-context character to the rules', () => {
    expect(indices('a ก b')).toEqual([2, 4, 5]);
  });

  it('has no opportunity in empty text', () => {
    expect(lineBreakOpportunities('')).toEqual([]);
  });

  it('breaks a Thai run that other text follows by its words, then by the rules', () => {
    const thai = 'สวัสดีครับ';
    const words = indices(thai).slice(0, -1);
    expect(words.length).toBeGreaterThan(0);
    expect(indices(`${thai} ok`)).toEqual([...words, thai.length + 1, thai.length + 3]);
  });

  it('breaks Thai only at the rules without Intl.Segmenter', () => {
    const text = 'สวัสดีครับ';
    expect(indices(text).length).toBeGreaterThan(1);
    vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
    expect(indices(text)).toEqual([text.length]);
  });

  it('pairs every regional indicator of a long run (LB30a, counted once per group)', () => {
    const flags = '🇯🇵'.repeat(5_000);
    const breaks = lineBreakOpportunities(flags);
    // A break between each flag (4 UTF-16 units), none inside one.
    expect(breaks.map(({ index }) => index).slice(0, 3)).toEqual([4, 8, 12]);
    expect(breaks).toHaveLength(5_000);
  });
});
