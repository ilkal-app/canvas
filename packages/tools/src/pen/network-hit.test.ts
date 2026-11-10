// The prototype's hit tests (webgl-whiteboard `src/vector/hit.test.ts`), ported: tolerance
// boundaries for vertex, handle and segment, and the even-odd fill.
import { describe, expect, it } from 'vitest';

import { buildNetwork } from './__fixtures__/networks.js';
import { setHandle } from './network-handles.js';
import {
  hitFill,
  hitNetworkHandle,
  hitSegment,
  hitVertex,
  isInsideEvenOdd,
} from './network-hit.js';

const square = buildNetwork(
  [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ],
  [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ],
);

describe('hitVertex, hitSegment and hitNetworkHandle', () => {
  it('finds the nearest vertex within the tolerance, inclusive', () => {
    expect(hitVertex(square.network, { x: 3, y: 4 }, 5)).toBe(square.ids[0]);
    expect(hitVertex(square.network, { x: 3, y: 4.1 }, 5)).toBeUndefined();
    const close = buildNetwork([
      [0, 0],
      [4, 0],
    ]);
    expect(hitVertex(close.network, { x: 3, y: 0 }, 6)).toBe(close.ids[1]);
  });

  it('finds a segment with the parameter of its nearest point', () => {
    const hit = hitSegment(square.network, { x: 25, y: 3 }, 5);
    expect(hit?.segmentId).toBe(square.network.segments[0]?.id);
    // A straight cubic with its handles on its vertices is not linear in t:
    // x(t) = 100 (3t² − 2t³), so x = 25 is t ≈ 0.326.
    expect(hit?.t).toBeCloseTo(0.326, 2);
    expect(hitSegment(square.network, { x: 25, y: 4.9 }, 5)).toBeDefined();
    expect(hitSegment(square.network, { x: 25, y: 5.1 }, 5)).toBeUndefined();
  });

  it('finds only the pulled-out handles of the vertices given', () => {
    const segment = square.network.segments[0];
    if (!segment) throw new Error('no segment');
    const network = setHandle(square.network, segment.id, 'a', { x: 20, y: -20 }, false);
    const [first = '', second = ''] = square.ids;
    expect(hitNetworkHandle(network, [first], { x: 21, y: -19 }, 6)).toEqual({
      segmentId: segment.id,
      end: 'a',
      vertexId: first,
      origin: { x: 0, y: 0 },
    });
    expect(hitNetworkHandle(network, [second], { x: 21, y: -19 }, 6)).toBeUndefined();
    // The other segment's handle at the first vertex is zero: not a handle.
    expect(hitNetworkHandle(network, [first], { x: 0, y: 0 }, 6)).toBeUndefined();
  });
});

describe('hitFill', () => {
  it('is even-odd: a hole is outside', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const hole = [
      { x: 40, y: 40 },
      { x: 60, y: 40 },
      { x: 60, y: 60 },
      { x: 40, y: 60 },
    ];
    expect(isInsideEvenOdd([outer, hole], { x: 10, y: 10 })).toBe(true);
    expect(isInsideEvenOdd([outer, hole], { x: 50, y: 50 })).toBe(false);
    expect(isInsideEvenOdd([outer, hole], { x: 150, y: 50 })).toBe(false);
  });

  it('fills only closed loops', () => {
    expect(hitFill(square.network, { x: 50, y: 50 }, 0.25)).toBe(true);
    expect(hitFill(square.network, { x: 150, y: 50 }, 0.25)).toBe(false);
    const open = buildNetwork(
      [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
      [
        [0, 1],
        [1, 2],
      ],
    );
    expect(hitFill(open.network, { x: 90, y: 10 }, 0.25)).toBe(false);
  });
});

describe('hit tests on broken input', () => {
  it('skips an unknown vertex, a segment with a missing end and a hole in a polygon', () => {
    expect(hitNetworkHandle(square.network, ['nope'], { x: 0, y: 0 }, 6)).toBeUndefined();
    const dangling = {
      vertices: square.network.vertices.slice(1),
      segments: square.network.segments,
    };
    expect(hitSegment(dangling, { x: 50, y: 0 }, 5)).toBeUndefined();
    const sparse = [{ x: 0, y: 0 }, undefined, { x: 10, y: 10 }] as unknown as {
      x: number;
      y: number;
    }[];
    // Only the edge between the two points counts: one crossing to the right, so inside.
    expect(isInsideEvenOdd([sparse], { x: 1, y: 5 })).toBe(true);
  });
});
