import { describe, expect, it } from 'vitest';

import { checkPixelRect } from './pixel-rect.js';

const BUFFER = { widthPx: 100, heightPx: 50 };

describe('checkPixelRect', () => {
  it('accepts a rectangle of whole pixels inside the drawing buffer', () => {
    expect(() => {
      checkPixelRect({ xPx: 0, yPx: 0, widthPx: 100, heightPx: 50 }, BUFFER);
    }).not.toThrow();
  });

  it('rejects a rectangle reaching past the right or bottom edge', () => {
    expect(() => {
      checkPixelRect({ xPx: 90, yPx: 0, widthPx: 11, heightPx: 1 }, BUFFER);
    }).toThrow(/outside the 100×50 drawing buffer/);
    expect(() => {
      checkPixelRect({ xPx: 0, yPx: 49, widthPx: 1, heightPx: 2 }, BUFFER);
    }).toThrow(RangeError);
  });

  it('rejects a negative origin', () => {
    expect(() => {
      checkPixelRect({ xPx: -1, yPx: 0, widthPx: 1, heightPx: 1 }, BUFFER);
    }).toThrow(RangeError);
  });

  it('rejects an empty rectangle', () => {
    expect(() => {
      checkPixelRect({ xPx: 0, yPx: 0, widthPx: 0, heightPx: 1 }, BUFFER);
    }).toThrow(/at least one pixel/);
  });

  it('rejects fractional pixels, which the drawing buffer does not have', () => {
    expect(() => {
      checkPixelRect({ xPx: 0.5, yPx: 0, widthPx: 1, heightPx: 1 }, BUFFER);
    }).toThrow(/whole pixels/);
  });
});
