import { describe, expect, it } from 'vitest';

import { BASE, BOLD, LARGE, RED, runsOf } from './__fixtures__/text-styles.js';
import { applyStyle, commonStyle, mergeStyle } from './apply-style.js';
import { NO_LETTER_SPACING } from './style-fields.js';

/** No spacing and an auto line-height, as a shared style spells them out. */
// The optional fields as the panel spells out none.
const UNSPACED = {
  letterSpacing: NO_LETTER_SPACING,
  lineHeight: 'auto',
  fontVariations: {},
} as const;

describe('applyStyle', () => {
  it('restyles a range inside one run, splitting it', () => {
    expect(applyStyle(runsOf([6, BASE]), 2, 4, { weight: 700 })).toEqual(
      runsOf([2, BASE], [2, BOLD], [2, BASE]),
    );
  });

  it('merges a patch into every run of a multi-run range and merges what becomes equal', () => {
    const runs = runsOf([2, BASE], [2, BOLD], [2, BASE]);
    expect(applyStyle(runs, 0, 6, { weight: 700 })).toEqual(runsOf([6, BOLD]));
    expect(applyStyle(runs, 1, 5, { fontSize: 32 })).toEqual(
      runsOf([1, BASE], [1, LARGE], [2, { ...BOLD, fontSize: 32 }], [1, LARGE], [1, BASE]),
    );
  });

  it("restyles empty text's run, leaves other text alone for an empty range", () => {
    expect(applyStyle(runsOf([0, BASE]), 0, 0, { color: [1, 0, 0, 1] })).toEqual(runsOf([0, RED]));
    expect(applyStyle(runsOf([3, BASE]), 1, 1, { weight: 700 })).toEqual(runsOf([3, BASE]));
  });
});

describe('commonStyle', () => {
  it('keeps only the fields the whole range shares', () => {
    const runs = runsOf([2, BASE], [2, BOLD], [2, RED]);
    const { weight, color, ...shared } = BASE;
    expect(weight).toBe(400);
    expect(color).toBeDefined();
    expect(commonStyle(runs, 0, 6)).toEqual({ ...shared, ...UNSPACED });
    expect(commonStyle(runs, 0, 4)).toEqual({ ...shared, color: BASE.color, ...UNSPACED });
    expect(commonStyle(runs, 2, 4)).toEqual({ ...BOLD, ...UNSPACED });
  });

  it('tells a spacing set over part of a range (mixed) from none', () => {
    const tracked = { ...BASE, letterSpacing: { value: 2, unit: 'px' } } as const;
    const runs = runsOf([2, BASE], [2, tracked]);
    expect(commonStyle(runs, 0, 4)).not.toHaveProperty('letterSpacing');
    expect(commonStyle(runs, 0, 2)).toHaveProperty('letterSpacing', NO_LETTER_SPACING);
    expect(commonStyle(runs, 2, 4)).toHaveProperty('letterSpacing', tracked.letterSpacing);
    expect(commonStyle(runs, 0, 4)).toHaveProperty('lineHeight', 'auto');
  });

  it('gives the style typing would continue for an empty range', () => {
    expect(commonStyle(runsOf([2, BASE], [2, BOLD]), 3, 3)).toEqual({ ...BOLD, ...UNSPACED });
    expect(commonStyle(runsOf([2, BASE]), 2, 9)).toEqual({ ...BASE, ...UNSPACED });
  });
});

describe('mergeStyle with a face name', () => {
  const face = { ...BASE, postScriptName: 'Inter-CondensedBold' };

  it('drops the face when the family changes without one, and keeps it otherwise', () => {
    expect(mergeStyle(face, { fontFamily: 'Lora' })).not.toHaveProperty('postScriptName');
    expect(mergeStyle(face, { fontSize: 32 }).postScriptName).toBe('Inter-CondensedBold');
    expect(mergeStyle(face, { fontFamily: face.fontFamily }).postScriptName).toBe(
      'Inter-CondensedBold',
    );
  });

  it('sets a face given with the family, and removes it for null', () => {
    expect(
      mergeStyle(face, { fontFamily: 'Lora', postScriptName: 'Lora-Bold' }).postScriptName,
    ).toBe('Lora-Bold');
    expect(mergeStyle(face, { postScriptName: null })).not.toHaveProperty('postScriptName');
  });
});

describe('mergeStyle with a link', () => {
  const link = 'https://example.com/range';

  it('sets a link, keeps it when absent from the patch, and null removes it', () => {
    const linked = mergeStyle(BASE, { link });
    expect(linked.link).toBe(link);
    expect(mergeStyle(linked, { weight: 700 }).link).toBe(link);
    const cleared = mergeStyle(linked, { link: null });
    expect(cleared).not.toHaveProperty('link');
    expect(cleared).toEqual(BASE);
  });
});
