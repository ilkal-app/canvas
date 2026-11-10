import { describe, expect, it } from 'vitest';

import {
  MAX_PREFETCH_VIEWPORTS,
  MIN_PREFETCH_REACH_SHARE,
  PREFETCH_LOOKAHEAD_MS,
  prefetchReach,
  prefetchStrips,
  prefetchViewport,
  viewportVelocity,
} from './prefetch.js';

const VIEW = { minX: 0, minY: 0, maxX: 1000, maxY: 500 };

describe('viewportVelocity', () => {
  it('is how far the viewport centre moved per millisecond', () => {
    const moved = { minX: 100, minY: -50, maxX: 1100, maxY: 450 };

    expect(viewportVelocity(VIEW, moved, 20)).toEqual({ x: 5, y: -2.5 });
  });

  it('is zero without elapsed time', () => {
    expect(viewportVelocity(VIEW, { ...VIEW, minX: 10, maxX: 1010 }, 0)).toEqual({ x: 0, y: 0 });
  });

  it('follows the centre, not the edges, while zooming', () => {
    const zoomedOut = { minX: -500, minY: -250, maxX: 1500, maxY: 750 };

    expect(viewportVelocity(VIEW, zoomedOut, 16)).toEqual({ x: 0, y: 0 });
  });
});

describe('prefetchViewport', () => {
  it('moves the viewport along the velocity by the lookahead', () => {
    const ahead = prefetchViewport(VIEW, { x: 0.5, y: 0 }, PREFETCH_LOOKAHEAD_MS);

    expect(ahead).toEqual({
      minX: 0.5 * PREFETCH_LOOKAHEAD_MS,
      minY: 0,
      maxX: 1000 + 0.5 * PREFETCH_LOOKAHEAD_MS,
      maxY: 500,
    });
  });

  it('points the way the camera moves, up and left too', () => {
    const ahead = prefetchViewport(VIEW, { x: -1, y: -0.2 }, 100);

    expect(ahead).toEqual({ minX: -100, minY: -20, maxX: 900, maxY: 480 });
  });

  it('stays put for a still camera', () => {
    expect(prefetchViewport(VIEW, { x: 0, y: 0 }, 500)).toEqual(VIEW);
  });

  it('looks at most a few viewports ahead during a fling', () => {
    const ahead = prefetchViewport(VIEW, { x: 1e6, y: 1e6 }, 500);

    expect(ahead.minX).toBe(MAX_PREFETCH_VIEWPORTS * 1000);
    expect(ahead.minY).toBe(MAX_PREFETCH_VIEWPORTS * 500);
  });

  it('does not change the viewport it is given', () => {
    const view = { ...VIEW };
    prefetchViewport(view, { x: 3, y: 3 }, 500);

    expect(view).toEqual(VIEW);
  });
});

describe('prefetchStrips', () => {
  const padded = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  it('is the strip beside the padded rectangle a pan along x moves into', () => {
    expect(prefetchStrips(padded, { minX: 30, minY: 0, maxX: 130, maxY: 100 })).toEqual([
      { minX: 100, minY: 0, maxX: 130, maxY: 100 },
    ]);
    expect(prefetchStrips(padded, { minX: -30, minY: 0, maxX: 70, maxY: 100 })).toEqual([
      { minX: -30, minY: 0, maxX: 0, maxY: 100 },
    ]);
  });

  it('adds the strip above or below for a diagonal pan, sharing no point with the first', () => {
    expect(prefetchStrips(padded, { minX: 20, minY: -10, maxX: 120, maxY: 90 })).toEqual([
      { minX: 100, minY: -10, maxX: 120, maxY: 90 },
      { minX: 20, minY: -10, maxX: 100, maxY: 0 },
    ]);
  });

  it('is nothing for a still rectangle', () => {
    expect(prefetchStrips(padded, padded)).toEqual([]);
  });
});

describe('prefetchReach', () => {
  // An extent of 1600: the shortest reach is 100, then 200, 400, 800, 1600 and 3200.
  const extent = 1600;

  it('rounds the lookahead up to the shortest reach times a power of two', () => {
    expect(extent * MIN_PREFETCH_REACH_SHARE).toBe(100);
    expect(prefetchReach(100, 0, extent)).toBe(100);
    expect(prefetchReach(101, 0, extent)).toBe(200);
    expect(prefetchReach(-300, 0, extent)).toBe(-400);
  });

  it('is nothing for a lookahead short of the shortest reach, or a camera at rest', () => {
    expect(prefetchReach(99, 0, extent)).toBe(0);
    expect(prefetchReach(0, 400, extent)).toBe(0);
    expect(prefetchReach(0, 0, extent)).toBe(0);
    expect(prefetchReach(50, 0, 0)).toBe(0);
  });

  it('keeps the reach while the lookahead is between a quarter of it and it', () => {
    expect(prefetchReach(100, 400, extent)).toBe(400);
    expect(prefetchReach(250, 400, extent)).toBe(400);
    expect(prefetchReach(400, 400, extent)).toBe(400);
    expect(prefetchReach(-150, -400, extent)).toBe(-400);
  });

  it('moves the reach once the lookahead passes it, falls below a quarter, or turns', () => {
    expect(prefetchReach(401, 400, extent)).toBe(800);
    expect(prefetchReach(120, 800, extent)).toBe(200);
    expect(prefetchReach(-150, 400, extent)).toBe(-200);
  });

  it('reaches at most a few rectangles ahead during a fling', () => {
    expect(prefetchReach(1e6, 0, extent)).toBe(MAX_PREFETCH_VIEWPORTS * extent);
    expect(prefetchReach(1e6, 3200, extent)).toBe(3200);
    // A reach kept from a larger rectangle (before a zoom in) is not kept past the limit.
    expect(prefetchReach(3000, 6400, extent)).toBe(3200);
  });
});
