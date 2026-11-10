import { describe, expect, it } from 'vitest';

import { paintColorAt, type Gradient, type Rgba } from '@canvas/schema';

import {
  GRADIENT_RECORD_FLOATS,
  GRADIENT_RECORD_TEXELS,
  LINEAR_GRADIENT_CODE,
  packGradientRecord,
  RADIAL_GRADIENT_CODE,
} from './gradient-record.js';

/**
 * The gradient shaders' `paintAt` (scripts/gradient-shader.ts) in float32 JavaScript, reading a
 * packed record as `textureLoad` would: the WGSL walks the same eight stops the same way.
 *
 * @param record - A packed record.
 * @param u - The unit-box x.
 * @param v - The unit-box y.
 * @returns The premultiplied colour.
 */
function shaderPaintAt(record: Float32Array, u: number, v: number): Rgba {
  const texel = (index: number): Rgba => [
    record[index * 4] ?? 0,
    record[index * 4 + 1] ?? 0,
    record[index * 4 + 2] ?? 0,
    record[index * 4 + 3] ?? 0,
  ];
  const [type, a, b, c] = texel(0);
  const t =
    type < 0.5
      ? Math.fround(0.5 + (u - 0.5) * a + (v - 0.5) * b)
      : Math.fround(Math.hypot(u - a, v - b) * c);
  const offsets = [...texel(9), ...texel(10)];
  let before = texel(1);
  if ((offsets[0] ?? 0) > t) return before;
  for (let index = 1; index < 8; index += 1) {
    const stop = texel(1 + index);
    const offset = offsets[index] ?? 0;
    if (offset > t) {
      const previous = offsets[index - 1] ?? 0;
      const f = (t - previous) / (offset - previous);
      return before.map((channel, at) => channel * (1 - f) + (stop[at] ?? 0) * f) as Rgba;
    }
    before = stop;
  }
  return before;
}

/**
 * `paintColorAt` premultiplied, the colour the shaders output.
 *
 * @param gradient - The gradient.
 * @param u - The unit-box x.
 * @param v - The unit-box y.
 * @returns The premultiplied colour.
 */
function expectedAt(gradient: Gradient, u: number, v: number): Rgba {
  const [r, g, b, a] = paintColorAt(gradient, u, v);
  return [r * a, g * a, b * a, a];
}

const LINEAR: Gradient = {
  type: 'linear',
  angle: Math.PI / 6,
  stops: [
    { offset: 0, color: [1, 0, 0, 1] },
    { offset: 0.5, color: [0, 1, 0, 0.5] },
    { offset: 1, color: [0, 0, 1, 1] },
  ],
};

const RADIAL: Gradient = {
  type: 'radial',
  center: { x: 0.25, y: 0.75 },
  radius: 0.8,
  stops: [
    { offset: 0.2, color: [1, 1, 0, 1] },
    { offset: 0.6, color: [0, 0, 1, 0] },
  ],
};

const HARD: Gradient = {
  type: 'linear',
  angle: -Math.PI / 2,
  stops: [
    { offset: 0, color: [0, 0, 0, 1] },
    { offset: 0.5, color: [0, 0, 0, 1] },
    { offset: 0.5, color: [1, 1, 1, 1] },
    { offset: 1, color: [1, 1, 1, 1] },
  ],
};

const EIGHT: Gradient = {
  type: 'linear',
  angle: Math.PI,
  stops: Array.from({ length: 8 }, (ignored, index) => ({
    offset: index / 7,
    color: [index / 7, 1 - index / 7, 0.5, (index + 1) / 8] as Rgba,
  })),
};

function pack(gradient: Gradient): Float32Array {
  const record = new Float32Array(GRADIENT_RECORD_FLOATS);
  packGradientRecord(gradient, record);
  return record;
}

describe('packGradientRecord', () => {
  it('is 11 texels: a header, eight stops and two texels of offsets', () => {
    expect(GRADIENT_RECORD_TEXELS).toBe(11);
    expect(GRADIENT_RECORD_FLOATS * 4).toBe(176);
  });

  it('precomputes a linear direction divided by |cos| + |sin|', () => {
    const record = pack(LINEAR);
    const span = Math.abs(Math.cos(LINEAR.angle)) + Math.abs(Math.sin(LINEAR.angle));
    expect(record[0]).toBe(LINEAR_GRADIENT_CODE);
    expect(record[1]).toBeCloseTo(Math.cos(LINEAR.angle) / span, 6);
    expect(record[2]).toBeCloseTo(Math.sin(LINEAR.angle) / span, 6);
  });

  it('holds a radial centre and 1 / radius', () => {
    expect([...pack(RADIAL).subarray(0, 4)]).toEqual([
      RADIAL_GRADIENT_CODE,
      0.25,
      0.75,
      Math.fround(1 / 0.8),
    ]);
  });

  it('premultiplies the stops and pads past the last with the last', () => {
    const record = pack(RADIAL);
    expect([...record.subarray(4, 8)]).toEqual([1, 1, 0, 1]);
    // [0, 0, 1, 0] premultiplied is transparent black, for every padded stop too.
    for (let stop = 2; stop <= 8; stop += 1) {
      expect([...record.subarray(stop * 4, stop * 4 + 4)]).toEqual([0, 0, 0, 0]);
    }
    expect([...record.subarray(36, 44)].map(Math.fround)).toEqual(
      [0.2, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6].map(Math.fround),
    );
  });

  it('writes at an offset without touching its neighbours', () => {
    const target = new Float32Array(GRADIENT_RECORD_FLOATS * 2 + 2).fill(7);
    packGradientRecord(LINEAR, target, GRADIENT_RECORD_FLOATS + 1);
    expect(target[GRADIENT_RECORD_FLOATS]).toBe(7);
    expect(target[target.length - 1]).toBe(7);
  });

  it.each([
    ['linear', LINEAR],
    ['radial', RADIAL],
    ['hard stops', HARD],
    ['eight stops', EIGHT],
  ])('evaluates %s as paintColorAt does, premultiplied, across the box', (name, gradient) => {
    const record = pack(gradient);
    for (let row = -2; row <= 12; row += 1) {
      for (let column = -2; column <= 12; column += 1) {
        // Off the hard stop's exact edge: there float32 and float64 rightly pick different sides.
        const u = (column + 0.37) / 10;
        const v = (row + 0.41) / 10;
        const actual = shaderPaintAt(record, u, v);
        expectedAt(gradient, u, v).forEach((channel, index) => {
          expect(actual[index], `${String(u)}, ${String(v)}`).toBeCloseTo(channel, 5);
        });
      }
    }
  });

  it('applies the later stop at equal offsets, from that offset on', () => {
    const record = pack(HARD);
    // angle −π/2 points up: t is 0.5 on the middle row, the later (white) stop applies.
    expect(shaderPaintAt(record, 0.5, 0.5)).toEqual([1, 1, 1, 1]);
    expect(expectedAt(HARD, 0.5, 0.5)).toEqual([1, 1, 1, 1]);
  });
});
