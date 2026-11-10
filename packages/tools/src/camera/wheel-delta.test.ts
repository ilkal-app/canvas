import { describe, expect, it } from 'vitest';

import { LINE_HEIGHT_PX, wheelDeltaPx } from './wheel-delta.js';

describe('wheelDeltaPx', () => {
  it('passes pixel deltas through', () => {
    expect(wheelDeltaPx(-7.5, 0, 800)).toBe(-7.5);
  });

  it('turns lines into pixels at a fixed line height', () => {
    expect(wheelDeltaPx(3, 1, 800)).toBe(3 * LINE_HEIGHT_PX);
    expect(LINE_HEIGHT_PX).toBe(16);
  });

  it('turns pages into the viewport height', () => {
    expect(wheelDeltaPx(-1, 2, 640)).toBe(-640);
  });

  it('refuses a delta mode the DOM does not define', () => {
    expect(() => wheelDeltaPx(1, 3, 640)).toThrow(RangeError);
  });
});
