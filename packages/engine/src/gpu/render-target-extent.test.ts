import { describe, expect, it } from 'vitest';

import { RenderTargetExtent, isScratchStale } from './render-target-extent.js';

describe('RenderTargetExtent', () => {
  it('needs only the minimum while no target is live', () => {
    const extent = new RenderTargetExtent();
    expect(extent.required({ width: 4, height: 2 })).toEqual({ width: 4, height: 2 });
    expect(extent.liveCount).toBe(0);
  });

  it('fits the widest width and the tallest height of the live targets', () => {
    const extent = new RenderTargetExtent();
    const wide = {};
    const tall = {};
    extent.add(wide, { width: 300, height: 20 });
    extent.add(tall, { width: 40, height: 200 });
    expect(extent.required({ width: 1, height: 1 })).toEqual({ width: 300, height: 200 });
    expect(extent.required({ width: 1, height: 400 })).toEqual({ width: 300, height: 400 });
    expect(extent.delete(wide)).toBe(true);
    expect(extent.delete(wide)).toBe(false);
    expect(extent.required({ width: 1, height: 1 })).toEqual({ width: 40, height: 200 });
    expect(extent.liveCount).toBe(1);
  });

  it('copies the size it is given', () => {
    const extent = new RenderTargetExtent();
    const size = { width: 8, height: 8 };
    extent.add({}, size);
    size.width = 99;
    expect(extent.required({ width: 1, height: 1 })).toEqual({ width: 8, height: 8 });
  });
});

describe('isScratchStale', () => {
  it('is stale when missing, smaller or larger in either edge', () => {
    const required = { width: 64, height: 32 };
    expect(isScratchStale(undefined, required)).toBe(true);
    expect(isScratchStale({ width: 32, height: 32 }, required)).toBe(true);
    expect(isScratchStale({ width: 64, height: 64 }, required)).toBe(true);
    expect(isScratchStale({ width: 64, height: 32 }, required)).toBe(false);
  });
});
