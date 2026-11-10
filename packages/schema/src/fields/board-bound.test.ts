import { describe, expect, it } from 'vitest';

import { applyTransform, placementTransform } from '../geometry/rigid-transform.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import { boardObjectSchema } from '../objects/board-object.js';

import { angleSchema, BOARD_BOUND, finiteCoordinate } from './board-bound.js';
import { pointSchema } from './point.js';

const OUTSIDE = BOARD_BOUND + 1;

describe('BOARD_BOUND', () => {
  it('is 2^30 world units', () => {
    expect(BOARD_BOUND).toBe(1_073_741_824);
  });
});

describe('angleSchema, the limit of a rotation', () => {
  it('accepts a turn count up to the bound and refuses more, NaN and infinities', () => {
    expect(angleSchema.safeParse(-BOARD_BOUND).success).toBe(true);
    for (const value of [OUTSIDE, 1e308, Number.NaN, Infinity]) {
      expect(angleSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('what an object stores is not held to the bound', () => {
  // A coordinate relative to a parent can exceed the bound while the object's place on the board
  // does not (a group of two frames at -B and +B holds one at 2B): the bound is on where objects
  // are on the board, which the command layer, paste and import judge.
  it('a point, a position, a size and an angle may exceed it, as long as they are finite', () => {
    expect(pointSchema.safeParse({ x: 2 * BOARD_BOUND, y: -1e300 }).success).toBe(true);
    const far = sampleObject('frame', 'a', {
      x: 2 * BOARD_BOUND,
      y: -OUTSIDE,
      rotation: 1e300,
      width: OUTSIDE,
      height: 1e300,
    });
    expect(boardObjectSchema.safeParse(far).success).toBe(true);
  });

  it('NaN and the infinities are still refused', () => {
    for (const value of [Number.NaN, Infinity, -Infinity]) {
      expect(boardObjectSchema.safeParse(sampleObject('frame', 'a', { x: value })).success).toBe(
        false,
      );
      expect(pointSchema.safeParse({ x: 0, y: value }).success).toBe(false);
    }
  });

  it('a size is still not negative', () => {
    expect(boardObjectSchema.safeParse(sampleObject('frame', 'a', { width: -1 })).success).toBe(
      false,
    );
  });
});

describe('finiteCoordinate', () => {
  it('returns a finite value as it is, past the bound too', () => {
    expect(finiteCoordinate(5)).toBe(5);
    expect(finiteCoordinate(-BOARD_BOUND)).toBe(-BOARD_BOUND);
    expect(finiteCoordinate(1e308)).toBe(1e308);
    expect(finiteCoordinate(-1e300)).toBe(-1e300);
  });

  it('clamps only what is not finite: an infinity to the largest number on its side, NaN to 0', () => {
    expect(finiteCoordinate(Infinity)).toBe(Number.MAX_VALUE);
    expect(finiteCoordinate(-Infinity)).toBe(-Number.MAX_VALUE);
    expect(finiteCoordinate(Number.NaN)).toBe(0);
  });
});

describe('arithmetic at the bound stays finite and exact enough', () => {
  it('sums, midpoints and extents of coordinates at the bound are exact in float64', () => {
    expect(BOARD_BOUND + BOARD_BOUND).toBe(2 ** 31);
    expect((BOARD_BOUND + -BOARD_BOUND) / 2).toBe(0);
    expect(BOARD_BOUND - -BOARD_BOUND).toBe(2 ** 31);
    // A fractional coordinate keeps 22 fraction bits at 2^30, so a quarter world unit survives.
    expect(BOARD_BOUND - 0.25 + 0.25).toBe(BOARD_BOUND);
    expect((BOARD_BOUND - 0.25 + (BOARD_BOUND - 0.75)) / 2).toBe(BOARD_BOUND - 0.5);
  });

  it('the distance between two far corners is finite in float64 and in float32', () => {
    const distance = Math.hypot(2 * BOARD_BOUND, 2 * BOARD_BOUND);
    expect(Number.isFinite(distance)).toBe(true);
    expect(distance).toBeCloseTo(2 ** 31 * Math.SQRT2, 0);
    expect(Number.isFinite(Math.fround(distance))).toBe(true);
    // The squared distance a shader forms is far from the float32 range limit.
    const squared = (2 * BOARD_BOUND) ** 2 * 2;
    expect(Number.isFinite(Math.fround(squared))).toBe(true);
    expect(Math.abs(Math.fround(distance) - distance) / distance).toBeLessThan(2 ** -23);
  });

  it('a turned corner at the bound stays finite and within float32 rounding of the exact value', () => {
    const transform = placementTransform(BOARD_BOUND, -BOARD_BOUND, 1.234);
    const corner = applyTransform(transform, { x: BOARD_BOUND, y: BOARD_BOUND });
    expect(Number.isFinite(corner.x) && Number.isFinite(corner.y)).toBe(true);
    for (const value of [corner.x, corner.y]) {
      expect(Math.abs(Math.fround(value) - value)).toBeLessThanOrEqual(Math.abs(value) * 2 ** -24);
    }
  });

  it('the bound itself and every power-of-two multiple up to 64 zoom are exact in float32', () => {
    for (const zoom of [0.02, 0.5, 1, 32, 64]) {
      const scaled = BOARD_BOUND * zoom;
      expect(Number.isFinite(Math.fround(scaled))).toBe(true);
    }
    expect(Math.fround(BOARD_BOUND)).toBe(BOARD_BOUND);
    expect(Math.fround(BOARD_BOUND * 64)).toBe(BOARD_BOUND * 64);
  });
});
