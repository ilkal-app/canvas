import { describe, expect, it } from 'vitest';

import { MAX_FONT_SIZE, MIN_FONT_SIZE } from '../fields/text-style.js';

import { FLOAT32_MAX, MAX_DRAWABLE_SIZE } from './drawable-extent.js';
import {
  capReason,
  colorReason,
  coordinateReason,
  cropExtentReason,
  cropReason,
  fontSizeReason,
  fontWeightReason,
  naturalSizeReason,
  pointReason,
  scalarReason,
  sidesReason,
  sizeReason,
  strokeReason,
  textRunsReason,
  unitReason,
} from './drawable-ranges.js';

/** The smallest positive subnormal double, and the largest subnormal. */
const SUBNORMAL = Number.MIN_VALUE;
const LARGEST_SUBNORMAL = 2 ** -1022 - Number.MIN_VALUE;

/** Every rule taking a single number. */
const NUMBER_RULES = {
  coordinateReason,
  scalarReason,
  sizeReason,
  naturalSizeReason,
  fontSizeReason,
  unitReason,
  cropExtentReason,
  sidesReason,
} as const;

describe('the drawable ranges', () => {
  it.each(Object.entries(NUMBER_RULES))('%s refuses NaN and both infinities', (name, rule) => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(rule(value), `${name}(${String(value)})`).toBe('not-finite');
    }
  });

  it('holds a coordinate to finite only: its place is judged with its parents', () => {
    for (const value of [0, -0, SUBNORMAL, -LARGEST_SUBNORMAL, 2 ** 40, 1e308, -Number.MAX_VALUE]) {
      expect(coordinateReason(value), String(value)).toBeUndefined();
    }
  });

  it('holds a scalar to float32, which overflows at 2^128', () => {
    expect(FLOAT32_MAX).toBe(Math.fround(FLOAT32_MAX));
    expect(Math.fround(2 ** 128)).toBe(Number.POSITIVE_INFINITY);
    for (const value of [FLOAT32_MAX, -FLOAT32_MAX, -0, SUBNORMAL, 2 ** 127]) {
      expect(scalarReason(value), String(value)).toBeUndefined();
    }
    for (const value of [2 ** 128, -(2 ** 128), 1e39, -1e300]) {
      expect(scalarReason(value), String(value)).toBe('out-of-range');
    }
  });

  it('holds a size to [0, 2^32], -0 and subnormals included', () => {
    expect(MAX_DRAWABLE_SIZE).toBe(2 ** 32);
    for (const value of [0, -0, SUBNORMAL, 2 ** 32]) {
      expect(sizeReason(value), String(value)).toBeUndefined();
    }
    expect(sizeReason(-SUBNORMAL)).toBe('negative-size');
    expect(sizeReason(2 ** 32 + 1)).toBe('past-extent');
    expect(sizeReason(2 ** 128)).toBe('past-extent');
  });

  it('holds a natural size to the whole numbers 1 to 2^32', () => {
    for (const value of [1, 4000, 2 ** 32]) expect(naturalSizeReason(value)).toBeUndefined();
    for (const value of [0, -0, SUBNORMAL, 0.5, 1.5, 2 ** 32 + 1]) {
      expect(naturalSizeReason(value), String(value)).toBe('out-of-range');
    }
    expect(naturalSizeReason(-1)).toBe('negative-size');
  });

  it('holds a font size to 4 to 400', () => {
    expect(fontSizeReason(MIN_FONT_SIZE)).toBeUndefined();
    expect(fontSizeReason(MAX_FONT_SIZE)).toBeUndefined();
    expect(fontSizeReason(MIN_FONT_SIZE - 0.01)).toBe('out-of-range');
    expect(fontSizeReason(MAX_FONT_SIZE + 0.01)).toBe('out-of-range');
    expect(fontSizeReason(-1)).toBe('negative-size');
  });

  it('holds a fraction to [0, 1] and a crop extent to (0, 1]', () => {
    for (const value of [0, -0, SUBNORMAL, 1]) expect(unitReason(value)).toBeUndefined();
    for (const value of [-SUBNORMAL, 1 + 2 ** -52]) {
      expect(unitReason(value)).toBe('out-of-range');
    }
    for (const value of [SUBNORMAL, 0.5, 1]) expect(cropExtentReason(value)).toBeUndefined();
    expect(cropExtentReason(0)).toBe('out-of-range');
    expect(cropExtentReason(-0)).toBe('out-of-range');
    expect(cropExtentReason(1 + 2 ** -52)).toBe('out-of-range');
    expect(cropExtentReason(-0.5)).toBe('negative-size');
  });

  it('holds a crop within the image, with the schema slack for sums', () => {
    expect(cropReason({ x: 0, y: 0, width: 1, height: 1 })).toBeUndefined();
    expect(cropReason({ x: 0.1, y: 0.2, width: 0.9, height: 0.8 })).toBeUndefined();
    expect(cropReason({ x: 0.5, y: 0, width: 0.5 + 1e-10, height: 1 })).toBeUndefined();
    expect(cropReason({ x: 0.5, y: 0, width: 0.6, height: 1 })).toBe('out-of-range');
    expect(cropReason({ x: 0, y: 0.5, width: 1, height: 0.6 })).toBe('out-of-range');
    expect(cropReason({ x: Number.NaN, y: 0, width: 1, height: 1 })).toBe('not-finite');
    expect(cropReason({ x: 0, y: 0, width: 0, height: 1 })).toBe('out-of-range');
  });

  it('judges points, colours and strokes by their numbers', () => {
    expect(pointReason({ x: 1, y: -1 })).toBeUndefined();
    expect(pointReason({ x: 1, y: 1e39 })).toBe('out-of-range');
    expect(colorReason(null)).toBeUndefined();
    expect(colorReason([0, 0.5, 1, 1])).toBeUndefined();
    expect(colorReason([0, 0.5, 1.5, 1])).toBe('out-of-range');
    expect(strokeReason(null)).toBeUndefined();
    expect(strokeReason({ color: [0, 0, 0, 1], width: 64 })).toBeUndefined();
    expect(strokeReason({ color: [0, 0, 0, 1], width: 64.5 })).toBe('out-of-range');
    expect(strokeReason({ color: [0, 0, 0, 1], width: -1 })).toBe('negative-size');
    expect(strokeReason({ color: [2, 0, 0, 1], width: 1 })).toBe('out-of-range');
  });

  it('holds sides to the whole numbers 3 to 64 and caps to the listed ones', () => {
    for (const value of [3, 64]) expect(sidesReason(value)).toBeUndefined();
    for (const value of [2, 65, 3.5]) expect(sidesReason(value)).toBe('out-of-range');
    expect(capReason('arrow')).toBeUndefined();
    expect(capReason('spiral')).toBe('out-of-range');
  });

  it('holds runs to whole lengths covering the text, and at least one run', () => {
    const style = {
      fontFamily: 'Inter',
      fontSize: 24,
      color: [0, 0, 0, 1] as [number, number, number, number],
      weight: 400 as const,
      italic: false,
    };
    expect(textRunsReason(null)).toBeUndefined();
    expect(textRunsReason({ text: 'ab', runs: [{ length: 2, style }] })).toBeUndefined();
    expect(textRunsReason({ text: '', runs: [{ length: 0, style }] })).toBeUndefined();
    expect(textRunsReason({ text: 'ab', runs: [] })).toBe('out-of-range');
    expect(textRunsReason({ text: '', runs: [] })).toBe('out-of-range');
    expect(textRunsReason({ text: 'ab', runs: [{ length: 1, style }] })).toBe('out-of-range');
    expect(textRunsReason({ text: 'ab', runs: [{ length: 1.5, style }] })).toBe('out-of-range');
    expect(
      textRunsReason({
        text: 'ab',
        runs: [
          { length: 0, style },
          { length: 2, style },
        ],
      }),
    ).toBe('out-of-range');
    expect(textRunsReason({ text: 'ab', runs: [{ length: Number.NaN, style }] })).toBe(
      'not-finite',
    );
    expect(
      textRunsReason({ text: 'ab', runs: [{ length: 2, style: { ...style, fontSize: 1 } }] }),
    ).toBe('out-of-range');
  });

  it('holds a run’s weight to the nine CSS weights', () => {
    for (const weight of [100, 400, 650, Number.NaN]) {
      const expected =
        weight === 650 ? 'out-of-range' : Number.isNaN(weight) ? 'not-finite' : undefined;
      expect(fontWeightReason(weight), String(weight)).toBe(expected);
    }
    const style = { fontFamily: 'Inter', fontSize: 24, color: 'ink', weight: 450, italic: false };
    expect(textRunsReason({ text: 'ab', runs: [{ length: 2, style: style as never }] })).toBe(
      'out-of-range',
    );
  });

  it('holds a run’s letter-spacing and line-height to the schema’s ranges', () => {
    const style = { fontFamily: 'Inter', fontSize: 24, color: 'ink', weight: 400, italic: false };
    const judged = (extra: Record<string, unknown>) =>
      textRunsReason({ text: 'ab', runs: [{ length: 2, style: { ...style, ...extra } as never }] });
    expect(judged({ letterSpacing: { value: -2, unit: 'px' } })).toBeUndefined();
    expect(judged({ letterSpacing: { value: 400, unit: 'percent' } })).toBeUndefined();
    expect(judged({ lineHeight: 'auto' })).toBeUndefined();
    expect(judged({ lineHeight: { value: 150, unit: 'percent' } })).toBeUndefined();
    expect(judged({ letterSpacing: { value: Number.NaN, unit: 'px' } })).toBe('not-finite');
    expect(judged({ letterSpacing: { value: 401, unit: 'px' } })).toBe('out-of-range');
    expect(judged({ letterSpacing: { value: -101, unit: 'percent' } })).toBe('out-of-range');
    expect(judged({ letterSpacing: { value: 1, unit: 'em' } })).toBe('out-of-range');
    expect(judged({ lineHeight: { value: Number.POSITIVE_INFINITY, unit: 'px' } })).toBe(
      'not-finite',
    );
    expect(judged({ lineHeight: { value: 0, unit: 'px' } })).toBe('out-of-range');
    expect(judged({ lineHeight: { value: 1001, unit: 'percent' } })).toBe('out-of-range');
    expect(judged({ lineHeight: 'normal' })).toBe('out-of-range');
  });
});
