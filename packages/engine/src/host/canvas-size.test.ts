import { describe, expect, it } from 'vitest';

import { checkCanvasSize } from './canvas-size.js';

describe('checkCanvasSize', () => {
  it('accepts positive whole device pixels at a positive ratio', () => {
    expect(() => {
      checkCanvasSize(800, 600, 1.5);
    }).not.toThrow();
  });

  it.each([
    [0, 600, 1],
    [800, -1, 1],
    [800.5, 600, 1],
    [800, 600, 0],
    [800, 600, Number.NaN],
    [800, 600, Number.POSITIVE_INFINITY],
  ])('rejects %s×%s at %s', (widthPx, heightPx, dpr) => {
    expect(() => {
      checkCanvasSize(widthPx, heightPx, dpr);
    }).toThrow(RangeError);
  });
});
