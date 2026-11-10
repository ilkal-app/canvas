import { describe, expect, it } from 'vitest';

import {
  FLATTEN_BUCKET_HYSTERESIS,
  FLATTEN_TOLERANCE_PX,
  flattenToleranceOf,
  pickFlattenBucket,
} from './flatten-bucket.js';

// The zoom at a position on the bucket scale: two buckets per doubling.
const zoomAt = (position: number): number => 2 ** (position / 2);

describe('pickFlattenBucket', () => {
  it('puts each power of √2 in its own bucket', () => {
    expect(pickFlattenBucket(1)).toBe(0);
    expect(pickFlattenBucket(Math.SQRT2)).toBe(1);
    expect(pickFlattenBucket(2)).toBe(2);
    expect(pickFlattenBucket(0.25)).toBe(-4);
    expect(pickFlattenBucket(32)).toBe(10);
  });

  it('rounds to the nearest bucket without a previous one', () => {
    expect(pickFlattenBucket(zoomAt(0.49))).toBe(0);
    expect(pickFlattenBucket(zoomAt(0.51))).toBe(1);
  });

  it('keeps the previous bucket until the zoom crosses the boundary by the margin', () => {
    const margin = FLATTEN_BUCKET_HYSTERESIS;
    // Zooming in from bucket 0.
    expect(pickFlattenBucket(zoomAt(0.5 + margin - 0.01), 0)).toBe(0);
    expect(pickFlattenBucket(zoomAt(0.5 + margin + 0.01), 0)).toBe(1);
    // Zooming back out from bucket 1: it stays past the midpoint.
    expect(pickFlattenBucket(zoomAt(0.5 - margin + 0.01), 1)).toBe(1);
    expect(pickFlattenBucket(zoomAt(0.5 - margin - 0.01), 1)).toBe(0);
  });

  it('jumps straight to the nearest bucket after a large zoom', () => {
    expect(pickFlattenBucket(8, 0)).toBe(6);
    expect(pickFlattenBucket(1 / 8, 6)).toBe(-6);
  });

  it('gives a finite bucket for a zoom of zero or less', () => {
    expect(Number.isFinite(pickFlattenBucket(0))).toBe(true);
    expect(pickFlattenBucket(-1)).toBe(pickFlattenBucket(0));
  });

  it('does not thrash back and forth when the zoom wobbles about a boundary', () => {
    let bucket = pickFlattenBucket(zoomAt(0.4));
    const seen = new Set([bucket]);
    for (let step = 0; step < 100; step += 1) {
      bucket = pickFlattenBucket(zoomAt(0.5 + 0.2 * Math.sin(step)), bucket);
      seen.add(bucket);
    }
    expect(seen).toEqual(new Set([0]));
  });
});

describe('flattenToleranceOf', () => {
  it('is a quarter device pixel in world units at the zoom of the bucket', () => {
    expect(FLATTEN_TOLERANCE_PX).toBe(0.25);
    expect(flattenToleranceOf(0)).toBe(0.25);
    expect(flattenToleranceOf(2)).toBe(0.125);
    expect(flattenToleranceOf(-4)).toBe(1);
    expect(flattenToleranceOf(pickFlattenBucket(8))).toBeCloseTo(0.25 / 8, 12);
  });
});
