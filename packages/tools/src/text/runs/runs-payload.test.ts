import { describe, expect, it } from 'vitest';

import { BASE, BOLD, runsOf } from './__fixtures__/text-styles.js';
import {
  MAX_RUNS_PAYLOAD_CHARS,
  parseRunsPayload,
  RUNS_MIME_TYPE,
  serializeRunsPayload,
} from './runs-payload.js';

const GOOD = { text: 'Hi you', runs: runsOf([2, BOLD], [4, BASE]) };

describe('parseRunsPayload', () => {
  it('round-trips what serializeRunsPayload writes, under its own flavour', () => {
    expect(RUNS_MIME_TYPE).toBe('application/x-canvas-runs+json');
    expect(parseRunsPayload(serializeRunsPayload(GOOD))).toEqual(GOOD);
  });

  it('clamps sizes and channels, coerces weight and italic, and merges equal neighbours', () => {
    const json = JSON.stringify({
      text: 'abc',
      runs: [
        { length: 1, style: { ...BASE, fontSize: 9000, color: [2, -1, 0.5, 1], weight: 450 } },
        { length: 2, style: { ...BASE, fontSize: 400, color: [1, 0, 0.5, 1], italic: 'yes' } },
      ],
    });
    expect(parseRunsPayload(json)).toEqual({
      text: 'abc',
      runs: [{ length: 3, style: { ...BASE, fontSize: 400, color: [1, 0, 0.5, 1] } }],
    });
  });

  it.each([
    ['not JSON', '{'],
    ['an array', '[]'],
    ['empty text', JSON.stringify({ text: '', runs: runsOf([0, BASE]) })],
    ['no runs', JSON.stringify({ text: 'a', runs: [] })],
    ['runs not a list', JSON.stringify({ text: 'a', runs: {} })],
    ['short runs', JSON.stringify({ text: 'abc', runs: runsOf([2, BASE]) })],
    ['a fractional length', JSON.stringify({ text: 'ab', runs: [{ length: 1.5, style: BASE }] })],
    ['a negative length', JSON.stringify({ text: 'a', runs: [{ length: -1, style: BASE }] })],
    [
      'a nameless family',
      JSON.stringify({ text: 'a', runs: runsOf([1, { ...BASE, fontFamily: '' }]) }),
    ],
    [
      'a size that is not a number',
      JSON.stringify({ text: 'a', runs: [{ length: 1, style: { ...BASE, fontSize: '9' } }] }),
    ],
    [
      'a three-channel colour',
      JSON.stringify({ text: 'a', runs: [{ length: 1, style: { ...BASE, color: [0, 0, 0] } }] }),
    ],
    [
      'a colour of strings',
      JSON.stringify({
        text: 'a',
        runs: [{ length: 1, style: { ...BASE, color: ['0', 0, 0, 1] } }],
      }),
    ],
    ['no style', JSON.stringify({ text: 'a', runs: [{ length: 1 }] })],
    [
      'a boundary inside a surrogate pair',
      JSON.stringify({ text: 'a😀', runs: runsOf([2, BASE], [1, BOLD]) }),
    ],
    ['too long', ' '.repeat(MAX_RUNS_PAYLOAD_CHARS + 1)],
  ])('rejects %s', (name, json) => {
    expect(parseRunsPayload(json), name).toBeUndefined();
  });
});

describe('letter-spacing and line-height in the runs flavour', () => {
  it('round-trips both fields', () => {
    const spaced = {
      text: 'Hi',
      runs: runsOf([
        2,
        {
          ...BASE,
          letterSpacing: { value: 2, unit: 'px' },
          lineHeight: { value: 140, unit: 'percent' },
        },
      ]),
    };
    expect(parseRunsPayload(serializeRunsPayload(spaced))).toEqual(spaced);
  });

  it('leaves out a value the schema refuses, and auto', () => {
    const json = JSON.stringify({
      text: 'Hi',
      runs: [
        {
          length: 2,
          style: { ...BASE, letterSpacing: { value: 9000, unit: 'px' }, lineHeight: 'auto' },
        },
      ],
    });
    expect(parseRunsPayload(json)).toEqual({ text: 'Hi', runs: runsOf([2, BASE]) });
  });
});

describe('variable-font coordinates in the runs flavour', () => {
  it('round-trips them', () => {
    const varied = { text: 'Hi', runs: runsOf([2, { ...BASE, fontVariations: { wght: 650 } }]) };
    expect(parseRunsPayload(serializeRunsPayload(varied))).toEqual(varied);
  });

  it('leaves out empty and malformed coordinates', () => {
    for (const fontVariations of [{}, { weight: 650 }, 'wght=650']) {
      const json = JSON.stringify({
        text: 'Hi',
        runs: [{ length: 2, style: { ...BASE, fontVariations } }],
      });
      expect(parseRunsPayload(json)).toEqual({ text: 'Hi', runs: runsOf([2, BASE]) });
    }
  });
});
