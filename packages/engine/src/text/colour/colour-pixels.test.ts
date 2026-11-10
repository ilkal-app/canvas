import { describe, expect, it } from 'vitest';

import type { ColourCanvasFactory, ColourContext2d } from './colour-canvas.js';
import { fieldRange, paintField, parameterField } from './colour-pixels.js';

/**
 * A context with a fixed transform that records what is drawn and keeps the pixels put.
 *
 * @param matrix - Its transform.
 * @returns The context and what it saw.
 */
function contextWith(matrix: readonly [number, number, number, number, number, number]): {
  readonly context: ColourContext2d;
  readonly calls: unknown[][];
  readonly put: Uint8ClampedArray[];
} {
  const [a, b, c, d, e, f] = matrix;
  const calls: unknown[][] = [];
  const put: Uint8ClampedArray[] = [];
  const context = {
    getTransform: () => ({ a, b, c, d, e, f }),
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    setTransform: (...args: number[]) => calls.push(['setTransform', ...args]),
    drawImage: (image: unknown, x: number, y: number) => calls.push(['drawImage', image, x, y]),
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: (image: { data: Uint8ClampedArray }) => put.push(image.data),
  } as unknown as ColourContext2d;
  return { context, calls, put };
}

const black = { r: 0, g: 0, b: 0, a: 1 };
const white = { r: 1, g: 1, b: 1, a: 1 };
const stops = [
  { offset: 0, color: black, isForeground: false },
  { offset: 1, color: white, isForeground: false },
];

describe('parameterField', () => {
  it('evaluates at each pixel centre through the inverse transform', () => {
    const { context } = contextWith([2, 0, 0, -2, 1, 4]);
    const field = parameterField(context, 2, 2, (p) => p.x * 10 + p.y);
    // Pixel (0, 0)'s centre (0.5, 0.5) is drawing point ((0.5 − 1) / 2, (0.5 − 4) / −2).
    expect([...(field?.values ?? [])]).toEqual([-2.5 + 1.75, 2.5 + 1.75, -2.5 + 1.25, 2.5 + 1.25]);
  });

  it('gives no field for a transform that cannot be inverted', () => {
    expect(parameterField(contextWith([0, 0, 0, 0, 0, 0]).context, 1, 1, () => 0)).toBeUndefined();
  });
});

describe('fieldRange', () => {
  it('spans the finite values only', () => {
    const values = Float32Array.from([Number.NaN, 2, -1, Number.POSITIVE_INFINITY]);
    expect(fieldRange({ width: 4, height: 1, values })).toEqual([-1, 2]);
    expect(fieldRange({ width: 1, height: 1, values: Float32Array.from([Number.NaN]) })).toBe(
      undefined,
    );
  });
});

describe('paintField', () => {
  it('paints the colour line per pixel into a layer drawn with no transform', () => {
    const layer = contextWith([1, 0, 0, 1, 0, 0]);
    const made: unknown[] = [];
    const canvas: ColourCanvasFactory = {
      create: (width, height) => {
        const created = { width, height, getContext: () => layer.context };
        made.push(created);
        return created;
      },
      decodePng: () => Promise.resolve({}),
    };
    const target = contextWith([4, 0, 0, -4, 0, 0]);
    const values = Float32Array.from([0.5, 1.5, Number.NaN]);
    paintField(
      target.context,
      canvas,
      { width: 3, height: 1, values },
      { stops, extend: 'reflect' },
    );
    expect([...(layer.put[0] ?? [])]).toEqual([128, 128, 128, 255, 128, 128, 128, 255, 0, 0, 0, 0]);
    expect(target.calls).toEqual([
      ['save'],
      ['setTransform', 1, 0, 0, 1, 0, 0],
      ['drawImage', made[0], 0, 0],
      ['restore'],
    ]);
  });

  it('refuses a layer without a 2D context', () => {
    const canvas: ColourCanvasFactory = {
      create: (width, height) => ({ width, height, getContext: () => null }),
      decodePng: () => Promise.resolve({}),
    };
    const field = { width: 1, height: 1, values: Float32Array.from([0]) };
    const { context } = contextWith([1, 0, 0, 1, 0, 0]);
    expect(() => {
      paintField(context, canvas, field, { stops, extend: 'repeat' });
    }).toThrow(/2D canvas/);
  });
});
