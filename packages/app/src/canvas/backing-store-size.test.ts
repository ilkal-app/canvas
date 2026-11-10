import { describe, expect, it } from 'vitest';

import { computeBackingStoreSize } from './backing-store-size.js';

describe('computeBackingStoreSize', () => {
  it('scales the CSS size by the device pixel ratio', () => {
    expect(computeBackingStoreSize({ widthPx: 300, heightPx: 150 }, 2)).toEqual({
      cssWidthPx: 300,
      cssHeightPx: 150,
      widthPx: 600,
      heightPx: 300,
      dpr: 2,
    });
  });

  it('rounds fractional device pixels to the nearest whole pixel', () => {
    const size = computeBackingStoreSize({ widthPx: 100.5, heightPx: 33.3 }, 1.5);
    expect(size.widthPx).toBe(151);
    expect(size.heightPx).toBe(50);
  });

  it('prefers the exact device-pixel size when the browser reports one', () => {
    const size = computeBackingStoreSize({ widthPx: 100.5, heightPx: 33.3 }, 1.5, {
      widthPx: 150,
      heightPx: 49,
    });
    expect(size.widthPx).toBe(150);
    expect(size.heightPx).toBe(49);
  });

  it('ignores a device-pixel size more than a pixel away from CSS size times the ratio', () => {
    // Headless Chrome with an emulated device scale factor reports CSS pixels here.
    const size = computeBackingStoreSize({ widthPx: 1007, heightPx: 751 }, 2, {
      widthPx: 1007,
      heightPx: 751,
    });
    expect(size.widthPx).toBe(2014);
    expect(size.heightPx).toBe(1502);
  });

  it('never returns an empty backing store, which GPU contexts reject', () => {
    const size = computeBackingStoreSize({ widthPx: 0, heightPx: 0 }, 2);
    expect(size.widthPx).toBe(1);
    expect(size.heightPx).toBe(1);
  });

  it('treats a missing or invalid device pixel ratio as 1', () => {
    expect(computeBackingStoreSize({ widthPx: 10, heightPx: 10 }, 0).dpr).toBe(1);
    expect(computeBackingStoreSize({ widthPx: 10, heightPx: 10 }, Number.NaN).widthPx).toBe(10);
  });
});
