import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';

// Public evaluator returns a straight RGBA tuple; interpolation is premultiplied sRGB.
const colorAt = (paint: unknown, u: number, v: number): readonly number[] => {
  const fn = (
    schema as unknown as {
      paintColorAt: (paint: unknown, u: number, v: number) => readonly number[];
    }
  ).paintColorAt;
  expect(fn).toBeTypeOf('function');
  return fn(paint, u, v);
};
const paint = (first: readonly number[], last: readonly number[]) => ({
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: first },
    { offset: 1, color: last },
  ],
});

describe('independent interpolation oracle', () => {
  it('does not leak invisible blue into a red fade', () => {
    expect(colorAt(paint([1, 0, 0, 1], [0, 0, 1, 0]), 0.5, 0.5)).toEqual([1, 0, 0, 0.5]);
  });
  it('weights unequal alpha before interpolation, without converting to linear light', () => {
    const actual = colorAt(paint([1, 0, 0, 0.25], [0, 0, 1, 0.75]), 0.5, 0.5);
    expect(actual).toEqual([0.25, 0, 0.75, 0.5]);
  });
  it('keeps zero-alpha interpolation finite and transparent', () => {
    const actual = colorAt(paint([1, 0, 0, 0], [0, 0, 1, 0]), 0.5, 0.5);
    expect(actual.every(Number.isFinite)).toBe(true);
    expect(actual[3]).toBe(0);
  });
  it('spans diagonal corners and pads a radial beyond its radius', () => {
    const diagonal = { ...paint([1, 0, 0, 1], [0, 0, 1, 1]), angle: Math.PI / 4 };
    expect(colorAt(diagonal, 0, 0)).toEqual([1, 0, 0, 1]);
    expect(colorAt(diagonal, 1, 1)).toEqual([0, 0, 1, 1]);
    const radial = { type: 'radial', center: { x: 0, y: 1 }, radius: 0.1, stops: diagonal.stops };
    expect(colorAt(radial, 1, 0)).toEqual([0, 0, 1, 1]);
  });
});
