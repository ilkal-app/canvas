import { describe, expect, it } from 'vitest';

import type { Rgba } from '../fields/color.js';
import type { TextStyle } from '../fields/text-style.js';

import { BODY, connector, path, shape, sticky, text } from './__fixtures__/component-board.js';
import { overrideRecordSchema } from './instance-overrides.js';
import { instanceOverrideFields } from './override-content.js';

// An override record may restyle a text child (`textStyle`) and carry its own runs
// (`runs`, only beside `text`).

const RED: Rgba = [1, 0, 0, 1];
const AMBER: Rgba = [1, 0.75, 0, 1];
const BOLD: TextStyle = { ...BODY, weight: 700 };
const MENTION: TextStyle = { ...BODY, color: AMBER };

/**
 * Whether the override record schema accepts a value.
 *
 * @param record - The candidate record.
 * @returns True when it parses.
 */
function parses(record: unknown): boolean {
  return overrideRecordSchema.safeParse(record).success;
}

describe('the override record schema with textStyle and runs', () => {
  it.each([
    ['a colour', { textStyle: { color: RED } }],
    ['ink', { textStyle: { color: 'ink' } }],
    ['size, weight, italic and family', { textStyle: { fontSize: 40, weight: 700, italic: true } }],
    ['a family alone', { textStyle: { fontFamily: 'Inter Display' } }],
    ['text with runs', { text: 'ab', runs: [{ length: 2, style: BODY }] }],
    [
      'text with two runs',
      {
        text: '@Mira hi',
        runs: [
          { length: 5, style: MENTION },
          { length: 3, style: BODY },
        ],
      },
    ],
    [
      'empty text with its single zero-length run',
      { text: '', runs: [{ length: 0, style: BODY }] },
    ],
    [
      'runs whose boundary follows a surrogate pair',
      {
        text: '\u{1F600}a',
        runs: [
          { length: 2, style: BOLD },
          { length: 1, style: BODY },
        ],
      },
    ],
    [
      'text, runs and a style',
      { text: 'ab', runs: [{ length: 2, style: BODY }], textStyle: { color: RED } },
    ],
  ])('accepts %s', (label, record) => {
    expect(parses(record)).toBe(true);
  });

  it.each([
    ['an empty style', { textStyle: {} }],
    ['an unknown style key', { textStyle: { color: RED, underline: true } }],
    ['a size below the bound', { textStyle: { fontSize: 2 } }],
    ['a size above the bound', { textStyle: { fontSize: 401 } }],
    ['a weight between the nine CSS weights', { textStyle: { weight: 450 } }],
    ['an empty family', { textStyle: { fontFamily: '' } }],
    ['a family too long', { textStyle: { fontFamily: 'x'.repeat(201) } }],
    ['a colour that is not one', { textStyle: { color: 'red' } }],
    ['runs without text', { runs: [{ length: 2, style: BODY }] }],
    ['runs without text beside a fill', { fill: RED, runs: [{ length: 1, style: BODY }] }],
    ['no runs at all', { text: 'ab', runs: [] }],
    ['runs short of the text', { text: 'abc', runs: [{ length: 2, style: BODY }] }],
    ['runs past the text', { text: 'a', runs: [{ length: 2, style: BODY }] }],
    [
      'equal neighbours',
      {
        text: 'ab',
        runs: [
          { length: 1, style: BODY },
          { length: 1, style: BODY },
        ],
      },
    ],
    [
      'a zero-length run in non-empty text',
      {
        text: 'a',
        runs: [
          { length: 0, style: BOLD },
          { length: 1, style: BODY },
        ],
      },
    ],
    ['empty text without its run', { text: '', runs: [] }],
    [
      'a boundary inside a surrogate pair',
      {
        text: '\u{1F600}a',
        runs: [
          { length: 1, style: BOLD },
          { length: 2, style: BODY },
        ],
      },
    ],
    ['a run with a partial style', { text: 'a', runs: [{ length: 1, style: { color: RED } }] }],
  ])('refuses %s', (label, record) => {
    expect(parses(record)).toBe(false);
  });
});

describe('instanceOverrideFields with textStyle and runs', () => {
  it.each([
    ['text', text('child', 'main')],
    ['sticky', sticky('child', 'main')],
    ['shape', shape('child', 'main')],
    ['connector', connector('child', 'main', 'a', 'b')],
  ])('lets a %s take textStyle and runs where it takes text', (label, child) => {
    const fields = instanceOverrideFields(child);
    expect(fields).toContain('text');
    expect(fields).toContain('textStyle');
    expect(fields).toContain('runs');
  });

  it('keeps them off a type without text', () => {
    expect(instanceOverrideFields(path('child', 'main'))).not.toContain('textStyle');
    expect(instanceOverrideFields(path('child', 'main'))).not.toContain('runs');
  });
});
