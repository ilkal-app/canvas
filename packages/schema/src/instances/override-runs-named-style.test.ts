import { describe, expect, it } from 'vitest';

import { overrideRecordSchema } from './instance-overrides.js';

// A style's edits rewrite the runs of objects naming it, never an
// override record's, so an override's runs hold plain values and name no board text style.

const STYLE = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

describe('override runs and named text styles', () => {
  it('takes plain runs and refuses a run naming a text style', () => {
    expect(
      overrideRecordSchema.safeParse({ text: 'Hi', runs: [{ length: 2, style: STYLE }] }).success,
    ).toBe(true);
    expect(
      overrideRecordSchema.safeParse({
        text: 'Hi',
        runs: [{ length: 2, style: { ...STYLE, textStyleId: 'body' } }],
      }).success,
    ).toBe(false);
  });
});
