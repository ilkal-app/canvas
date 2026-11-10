import { describe, expect, it } from 'vitest';

import {
  freehandFieldsOf,
  freehandSamplesOf,
  freehandTolerance,
  simplifyFreehand,
  smoothFreehand,
  splitFreehand,
  type FreehandSample,
} from './freehand-samples.js';

describe('freehandTolerance', () => {
  it('is half a screen pixel in world units', () => {
    expect(freehandTolerance(1)).toBe(0.5);
    expect(freehandTolerance(4)).toBe(0.125);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses the zoom %s', (zoom) => {
    expect(() => freehandTolerance(zoom)).toThrow(RangeError);
  });
});

describe('simplifyFreehand', () => {
  it('collapses a straight run to its ends', () => {
    const run = [0, 1, 2, 3, 4].map((x) => ({ x: x * 10, y: 0 }));
    expect(simplifyFreehand(run, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ]);
  });

  it('keeps a corner beyond the tolerance and drops a wobble within it', () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 5, y: 0.2 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(simplifyFreehand(samples, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('keeps a pressure change on a straight run', () => {
    const samples = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 5, y: 0, pressure: 0.9 },
      { x: 10, y: 0, pressure: 0.5 },
    ];
    expect(simplifyFreehand(samples, 0.5)).toEqual(samples);
  });

  it('drops a pressure that follows its chord', () => {
    const samples = [
      { x: 0, y: 0, pressure: 0.2 },
      { x: 5, y: 0, pressure: 0.42 },
      { x: 10, y: 0, pressure: 0.6 },
    ];
    expect(simplifyFreehand(samples, 0.5)).toEqual([samples[0], samples[2]]);
  });

  it('measures a span whose ends coincide from that point', () => {
    const loop = [
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 0, y: 0.001 },
      { x: 0, y: 0 },
    ];
    expect(simplifyFreehand(loop, 0.5)).toContainEqual({ x: 3, y: 4 });
  });

  it('collapses repeated positions and copies short strokes', () => {
    const dot = { x: 2, y: 3, pressure: 0.4 };
    expect(simplifyFreehand([dot, { x: 2, y: 3 }], 1)).toEqual([dot]);
    expect(simplifyFreehand([], 1)).toEqual([]);
    const copy = simplifyFreehand([dot], 1);
    expect(copy).toEqual([dot]);
    expect(copy[0]).not.toBe(dot);
  });

  it('leaves its input untouched', () => {
    const samples: FreehandSample[] = [
      { x: 0, y: 0 },
      { x: 5, y: 3 },
      { x: 10, y: 0 },
    ];
    const before = structuredClone(samples);
    simplifyFreehand(Object.freeze(samples), 0.1);
    expect(samples).toEqual(before);
  });
});

describe('smoothFreehand', () => {
  it('pulls each middle sample toward the previous output', () => {
    const samples = [
      { x: 0, y: 0, pressure: 0 },
      { x: 10, y: 10, pressure: 1 },
      { x: 20, y: 0, pressure: 0 },
    ];
    expect(smoothFreehand(samples, 0.5)).toEqual([
      { x: 0, y: 0, pressure: 0 },
      { x: 5, y: 5, pressure: 0.5 },
      { x: 20, y: 0, pressure: 0 },
    ]);
  });

  it('keeps a sample pressure that has no smoothed predecessor', () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 10, y: 0, pressure: 0.7 },
      { x: 20, y: 0 },
    ];
    expect(smoothFreehand(samples, 0.5)[1]).toEqual({ x: 5, y: 0, pressure: 0.7 });
    expect(
      smoothFreehand(
        [
          { x: 0, y: 0, pressure: 1 },
          { x: 4, y: 0 },
          { x: 8, y: 0 },
        ],
        0.5,
      )[1],
    ).toEqual({ x: 2, y: 0 });
  });

  it('copies at factor 0', () => {
    const samples = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ];
    expect(smoothFreehand(samples, 0)).toEqual(samples);
  });

  it.each([1, -0.1, Number.NaN])('refuses the factor %s', (factor) => {
    expect(() => smoothFreehand([], factor)).toThrow(RangeError);
  });
});

describe('splitFreehand', () => {
  const samples = Array.from({ length: 2500 }, (unused, index) => ({ x: index, y: 0 }));

  it('splits a long stroke into joined pieces', () => {
    const pieces = splitFreehand(samples, 1024);
    expect(pieces.map((piece) => piece.length)).toEqual([1024, 1024, 454]);
    expect(pieces[1]?.[0]).toEqual(pieces[0]?.at(-1));
    expect(pieces[2]?.[0]).toEqual(pieces[1]?.at(-1));
    expect(pieces.flatMap((piece, index) => (index === 0 ? piece : piece.slice(1)))).toEqual(
      samples,
    );
  });

  it('keeps a stroke that fits as one piece, by the default cap too', () => {
    expect(splitFreehand(samples.slice(0, 10))).toEqual([samples.slice(0, 10)]);
    expect(splitFreehand(samples, 2500)).toHaveLength(1);
  });

  it.each([1, 2.5])('refuses a cap of %s', (max) => {
    expect(() => splitFreehand(samples, max)).toThrow(RangeError);
  });
});

describe('freehandFieldsOf and freehandSamplesOf', () => {
  it('round-trips a pressured stroke', () => {
    const samples = [
      { x: 1, y: 2, pressure: 0.3 },
      { x: 3, y: 4, pressure: 0.6 },
    ];
    const fields = freehandFieldsOf(samples);
    expect(fields).toEqual({ points: [1, 2, 3, 4], pressures: [0.3, 0.6] });
    expect(freehandSamplesOf(fields)).toEqual(samples);
  });

  it('stores no pressures unless every sample has one', () => {
    expect(
      freehandFieldsOf([
        { x: 1, y: 2, pressure: 0.3 },
        { x: 3, y: 4 },
      ]),
    ).toEqual({
      points: [1, 2, 3, 4],
    });
    expect(freehandFieldsOf([])).toEqual({ points: [] });
    expect(freehandSamplesOf({ points: [1, 2, 3, 4] })).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });
});
