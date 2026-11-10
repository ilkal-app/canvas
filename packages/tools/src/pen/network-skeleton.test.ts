import { describe, expect, it } from 'vitest';

import type { PathNetwork } from '@canvas/engine';

import { testPath } from './__fixtures__/pen-mode-context.js';
import { networkOverlayRects } from './network-overlay.js';
import { NetworkSkeleton } from './network-skeleton.js';
import { isNearBounds, segmentBoundsOf } from './segment-bounds.js';

const FRAME = { cos: 1, sin: 0, x: 100, y: 100 };

/**
 * A straight chain of `count` segments, 100 units long each, along the x axis.
 *
 * @param count - How many segments.
 * @returns The network.
 */
function chain(count: number): PathNetwork {
  const zero = { x: 0, y: 0 };
  const vertices = Array.from({ length: count + 1 }, (unused, index) => ({
    id: `v${String(index)}`,
    x: index * 100,
    y: 0,
    mirror: 'none' as const,
  }));
  const segments = vertices.slice(1).map((vertex, index) => ({
    id: `s${String(index)}`,
    a: `v${String(index)}`,
    b: vertex.id,
    ha: zero,
    hb: zero,
  }));
  return { vertices, segments };
}

/**
 * A viewport of the world, 200 × 100 units, from a left edge.
 *
 * @param minX - Its left edge.
 * @returns The viewport.
 */
function viewportFrom(minX: number) {
  return { minX, minY: 50, maxX: minX + 200, maxY: 150 };
}

describe('NetworkSkeleton', () => {
  it('draws the lines networkOverlayRects draws, and keeps them while nothing changes', () => {
    const network = testPath();
    const skeleton = new NetworkSkeleton();
    const rects = skeleton.rects(network, FRAME, 2);
    const drawn = networkOverlayRects({ network, frame: FRAME, zoom: 2, selected: new Set() });
    expect(rects).toEqual(drawn.slice(0, 2));
    expect(skeleton.rects(network, FRAME, 2)).toBe(rects);
    expect(skeleton.region).toBeUndefined();
    expect(skeleton.covers(viewportFrom(0))).toBe(true);
  });

  it('rebuilds on another network, frame or zoom, keeping the polylines within a zoom bucket', () => {
    const network = testPath();
    const skeleton = new NetworkSkeleton();
    const first = skeleton.rects(network, FRAME, 1);
    expect(skeleton.rects({ ...network }, FRAME, 1)).not.toBe(first);
    const moved = skeleton.rects(network, { ...FRAME, x: 0 }, 1);
    expect(moved[0]?.box.x).toBe(0);
    const zoomed = skeleton.rects(network, { ...FRAME, x: 0 }, 1.01);
    expect(zoomed).not.toBe(moved);
    // One pixel wide at the exact zoom.
    expect(zoomed[0]?.box.height).toBeCloseTo(1 / 1.01, 12);
  });

  it('culls to the viewport grown by half its size, and rebuilds once the view leaves that', () => {
    const network = chain(20);
    const skeleton = new NetworkSkeleton();
    // Viewport x 1,000 to 1,200 (world, the frame adds 100): the region is x 900 to 1,300.
    const rects = skeleton.rects(network, FRAME, 1, viewportFrom(1000));
    expect(rects.map(({ box }) => box.x)).toEqual([800, 900, 1000, 1100, 1200, 1300]);
    expect(skeleton.region).toEqual({ minX: 900, minY: 0, maxX: 1300, maxY: 200 });
    // A pan inside the region reuses them; one past it does not.
    expect(skeleton.covers(viewportFrom(1050))).toBe(true);
    expect(skeleton.rects(network, FRAME, 1, viewportFrom(1050))).toBe(rects);
    expect(skeleton.covers(viewportFrom(1150))).toBe(false);
    expect(skeleton.rects(network, FRAME, 1, viewportFrom(1150))).not.toBe(rects);
    // The viewport no longer known: the whole skeleton.
    expect(skeleton.rects(network, FRAME, 1)).toHaveLength(20);
  });
});

describe('segmentBoundsOf', () => {
  it('boxes each curve by its control points, once per network, skipping a missing end', () => {
    const path = testPath();
    const dangling = { id: 'x', a: 'v1', b: 'no', ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } };
    const network = { ...path, segments: [...path.segments, dangling] };
    const bounds = segmentBoundsOf(network);
    expect(
      bounds.map(({ segment, minX, maxX, minY, maxY }) => [segment.id, minX, maxX, minY, maxY]),
    ).toEqual([
      ['s1', 0, 100, 0, 0],
      ['s2', 100, 200, 0, 0],
    ]);
    expect(segmentBoundsOf(network)).toBe(bounds);
    const [first] = bounds;
    if (first === undefined) throw new Error('no bounds');
    expect(isNearBounds(first, 50, 5, 5)).toBe(true);
    expect(isNearBounds(first, 50, 6, 5)).toBe(false);
    expect(isNearBounds(first, 106, 0, 5)).toBe(false);
  });
});
