import { describe, expect, it } from 'vitest';

import { drawnFrameCornerRadii, hasRoundedCorner } from './corner-radii.js';

describe('drawn frame corner radii', () => {
  it('caps each drawn radius at half the shorter side', () => {
    expect(drawnFrameCornerRadii([1, 30, 80, 0], 100, 60)).toEqual([1, 30, 30, 0]);
    expect(drawnFrameCornerRadii(500, 40, 200)).toEqual([20, 20, 20, 20]);
    expect(drawnFrameCornerRadii(5, 0, 10)).toEqual([0, 0, 0, 0]);
    expect(drawnFrameCornerRadii(undefined, 100, 100)).toEqual([0, 0, 0, 0]);
    expect(drawnFrameCornerRadii([1, 2, -3, 4], 100, 100)).toEqual([0, 0, 0, 0]);
  });

  it('says whether any corner rounds', () => {
    expect(hasRoundedCorner([0, 0, 0, 0])).toBe(false);
    expect(hasRoundedCorner([0, 0, 0, 1])).toBe(true);
    expect(hasRoundedCorner([0, 0, 1, 0])).toBe(true);
    expect(hasRoundedCorner([0, 1, 0, 0])).toBe(true);
    expect(hasRoundedCorner([1, 0, 0, 0])).toBe(true);
  });
});
