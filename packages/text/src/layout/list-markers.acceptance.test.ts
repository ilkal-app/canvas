import { describe, expect, it } from 'vitest';

import { LIST_INDENT_EM, listMarkerOf, listOrdinalsOf, MARKER_GAP_EM } from '@canvas/text';

describe('list marker rules', () => {
  it('exports the em spacing used by list layout', () => {
    expect(LIST_INDENT_EM).toBe(1.5);
    expect(MARKER_GAP_EM).toBe(0.5);
  });

  it.each([
    [
      [0, 0, 1, 1, 0],
      [1, 2, 1, 2, 3],
    ],
    [
      [0, 1, 0, 1],
      [1, 1, 2, 1],
    ],
  ])('counts numbered paragraphs independently by level', (levels, expected) => {
    expect(listOrdinalsOf(levels.map((level) => ({ list: 'numbered', level })))).toEqual(expected);
  });

  it.each([
    [
      [{ list: 'numbered' }, {}, { list: 'numbered' }],
      [1, undefined, 1],
    ],
    [
      [{ list: 'numbered' }, { list: 'bullet' }, { list: 'numbered' }],
      [1, undefined, 1],
    ],
    [
      [{ list: 'numbered' }, { list: 'bullet', level: 1 }, { list: 'numbered' }],
      [1, undefined, 2],
    ],
  ] as const)('resets only counters at or below the interruption', (paragraphs, expected) => {
    expect(listOrdinalsOf(paragraphs)).toEqual(expected);
  });

  it('uses level-specific bullets and bijective letters', () => {
    expect([0, 1, 2, 3].map((level) => listMarkerOf({ list: 'bullet', level }, undefined))).toEqual(
      ['•', '◦', '▪', '•'],
    );
    expect([1, 26, 27, 28].map((n) => listMarkerOf({ list: 'numbered', level: 1 }, n))).toEqual([
      'a.',
      'z.',
      'aa.',
      'ab.',
    ]);
    expect(listMarkerOf({}, undefined)).toBeUndefined();
  });

  it('writes lower-case roman through 3999 and decimal beyond it', () => {
    expect(
      [1, 4, 9, 14, 3999, 4000].map((n) => listMarkerOf({ list: 'numbered', level: 2 }, n)),
    ).toEqual(['i.', 'iv.', 'ix.', 'xiv.', 'mmmcmxcix.', '4000.']);
    expect(listMarkerOf({ list: 'numbered', level: 3 }, 7)).toBe('7.');
  });
});
