import { describe, expect, it } from 'vitest';

import { drawableValuesReason } from './drawable-values.js';
import { strokeStyleReason } from './stroke-style-values.js';

// The door judges a path's, line's or connector's stroke style,
// so a peer cannot write a value the engine would loop over or misread.

const LINE_STYLE = {
  stroke: { color: [0, 0, 0, 1], width: 2 },
  startCap: 'none',
  endCap: 'arrow',
  route: 'straight',
};

describe('strokeStyleReason', () => {
  it('accepts absent fields, a null dash and every valid value', () => {
    expect(strokeStyleReason({})).toBeUndefined();
    expect(strokeStyleReason({ strokeDash: null })).toBeUndefined();
    const valid = [
      { strokeDash: { pattern: [4] } },
      { strokeDash: { pattern: [0, 2], offset: -3.5 } },
      { strokeDash: { pattern: [1, 2, 3, 4, 5, 6, 7, 4096], offset: 32768 } },
      { strokeJoin: 'miter', strokeMiterLimit: 1 },
      { strokeJoin: 'round', strokeMiterLimit: 100 },
      { strokeJoin: 'bevel' },
      { strokeCap: 'butt' },
      { strokeCap: 'round' },
      { strokeCap: 'square' },
    ];
    for (const style of valid) expect(strokeStyleReason(style)).toBeUndefined();
  });

  it('refuses a dash that is not a strict record holding a pattern', () => {
    for (const strokeDash of [[4, 2], 'dashed', 4, true, {}, { pattern: [4], extra: 1 }]) {
      expect(strokeStyleReason({ strokeDash })).toEqual({
        field: 'strokeDash',
        reason: 'not-a-record',
      });
    }
  });

  it('refuses a pattern of the wrong count, all zero, or not an array', () => {
    const cases: readonly [unknown, string, string][] = [
      [[], 'strokeDash.pattern', 'out-of-range'],
      [[1, 1, 1, 1, 1, 1, 1, 1, 1], 'strokeDash.pattern', 'out-of-range'],
      [[0, 0], 'strokeDash.pattern', 'out-of-range'],
      ['4 2', 'strokeDash.pattern', 'not-a-record'],
      [[4, -1], 'strokeDash.pattern.1', 'out-of-range'],
      [[4, 4097], 'strokeDash.pattern.1', 'out-of-range'],
      [[Number.NaN], 'strokeDash.pattern.0', 'not-finite'],
      [[Number.POSITIVE_INFINITY], 'strokeDash.pattern.0', 'not-finite'],
      [[4, '2'], 'strokeDash.pattern.1', 'not-a-number'],
    ];
    for (const [pattern, field, reason] of cases) {
      expect(strokeStyleReason({ strokeDash: { pattern } })).toEqual({ field, reason });
    }
  });

  it('refuses an offset that is not a finite number within ±32768', () => {
    const cases: readonly [unknown, string][] = [
      [32769, 'out-of-range'],
      [-32769, 'out-of-range'],
      [Number.NaN, 'not-finite'],
      ['1', 'not-a-number'],
      [null, 'not-a-number'],
    ];
    for (const [offset, reason] of cases) {
      expect(strokeStyleReason({ strokeDash: { pattern: [4], offset } })).toEqual({
        field: 'strokeDash.offset',
        reason,
      });
    }
  });

  it('refuses unknown joins and caps, ink included, and limits outside [1, 100]', () => {
    for (const strokeJoin of ['Miter', 'ink', 'arcs', 1, null]) {
      expect(strokeStyleReason({ strokeJoin })).toEqual({
        field: 'strokeJoin',
        reason: 'out-of-range',
      });
    }
    for (const strokeCap of ['Round', 'ink', 'arrow', 0, null]) {
      expect(strokeStyleReason({ strokeCap })).toEqual({
        field: 'strokeCap',
        reason: 'out-of-range',
      });
    }
    const limits: readonly [unknown, string][] = [
      [0.5, 'out-of-range'],
      [101, 'out-of-range'],
      [Number.POSITIVE_INFINITY, 'not-finite'],
      ['4', 'not-a-number'],
    ];
    for (const [strokeMiterLimit, reason] of limits) {
      expect(strokeStyleReason({ strokeMiterLimit })).toEqual({
        field: 'strokeMiterLimit',
        reason,
      });
    }
  });

  it('does not mutate the style it judges', () => {
    const style = { strokeDash: { pattern: [4, 2], offset: 1 }, strokeJoin: 'bevel' };
    const before = structuredClone(style);
    strokeStyleReason(style);
    expect(style).toEqual(before);
  });
});

describe("drawableValuesReason('style') with a stroke style", () => {
  it('passes a valid stroke style and refuses an invalid one with its path', () => {
    const styled = {
      ...LINE_STYLE,
      strokeDash: { pattern: [6, 3] },
      strokeJoin: 'miter',
      strokeMiterLimit: 8,
      strokeCap: 'square',
    };
    expect(drawableValuesReason('style', styled)).toBeUndefined();
    expect(
      drawableValuesReason('style', { ...LINE_STYLE, strokeDash: { pattern: [6, Number.NaN] } }),
    ).toEqual({ field: 'strokeDash.pattern.1', reason: 'not-finite' });
    expect(drawableValuesReason('style', { ...LINE_STYLE, strokeCap: 'arrow' })).toEqual({
      field: 'strokeCap',
      reason: 'out-of-range',
    });
  });

  it('lets a refused field through when the board already holds it', () => {
    const stored = { ...LINE_STYLE, strokeJoin: 'arcs' };
    const read = () => ({ value: stored });
    expect(drawableValuesReason('style', { ...stored }, read)).toBeUndefined();
    expect(drawableValuesReason('style', { ...stored, strokeJoin: 'loops' }, read)).toEqual({
      field: 'strokeJoin',
      reason: 'out-of-range',
    });
  });
});
