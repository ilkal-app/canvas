import { describe, expect, it } from 'vitest';

import { cubicOf, evalCubic, type PathNetwork } from '@canvas/engine';
import type { Segment } from '@canvas/schema';

import { buildNetwork, countingIds, deepFreeze, segmentBetween } from './__fixtures__/networks.js';
import { splitSegment } from './split-segment.js';

/**
 * A segment's curve in a network.
 *
 * @param network - The network.
 * @param segment - The segment.
 * @returns Its cubic.
 */
function curveOf(network: PathNetwork, segment: Segment) {
  return cubicOf({ vertexById: new Map(network.vertices.map((v) => [v.id, v])) }, segment);
}

describe('splitSegment', () => {
  it('inserts a smooth vertex that keeps the curve where it was', () => {
    const { network: built, ids } = buildNetwork(
      [
        [0, 0],
        [100, 0],
      ],
      [[0, 1]],
    );
    const [a = '', b = ''] = ids;
    const original = built.segments[0];
    if (!original) throw new Error('no segment');
    const network = deepFreeze({
      vertices: built.vertices,
      segments: [{ ...original, ha: { x: 0, y: 100 }, hb: { x: 0, y: 100 } }],
    });
    const before = curveOf(network, network.segments[0] ?? original);
    const split = splitSegment(network, original.id, 0.4, countingIds('s'));
    if (!split) throw new Error('not split');
    const vertex = split.network.vertices.find(({ id }) => id === split.vertexId);
    expect(vertex?.mirror).toBe('angle');
    const at = evalCubic(before, 0.4);
    expect(vertex?.x).toBeCloseTo(at.x, 9);
    expect(vertex?.y).toBeCloseTo(at.y, 9);
    const left = segmentBetween(split.network, a, split.vertexId);
    const right = segmentBetween(split.network, split.vertexId, b);
    expect(left.id).toBe(original.id);
    expect([left.a, right.b]).toEqual([a, b]);
    for (const u of [0.25, 0.5, 0.75]) {
      const onLeft = evalCubic(curveOf(split.network, left), u);
      const wantLeft = evalCubic(before, 0.4 * u);
      expect(Math.hypot(onLeft.x - wantLeft.x, onLeft.y - wantLeft.y)).toBeLessThan(1e-9);
      const onRight = evalCubic(curveOf(split.network, right), u);
      const wantRight = evalCubic(before, 0.4 + 0.6 * u);
      expect(Math.hypot(onRight.x - wantRight.x, onRight.y - wantRight.y)).toBeLessThan(1e-9);
    }
  });

  it('keeps a straight segment straight, with a corner between the halves', () => {
    const { network } = buildNetwork(
      [
        [0, 0],
        [100, 0],
      ],
      [[0, 1]],
    );
    const split = splitSegment(network, network.segments[0]?.id ?? '', 0.5, countingIds('s'));
    expect(split?.network.vertices.find(({ id }) => id === split.vertexId)).toMatchObject({
      x: 50,
      y: 0,
      mirror: 'none',
    });
    const isZero = ({ x, y }: { x: number; y: number }) => x === 0 && y === 0;
    expect(split?.network.segments.every(({ ha, hb }) => isZero(ha) && isZero(hb))).toBe(true);
  });

  it('refuses an unknown segment', () => {
    const { network } = buildNetwork([[0, 0]]);
    expect(splitSegment(network, 'nope', 0.5, countingIds())).toBeUndefined();
  });
});

describe('splitSegment on a broken network', () => {
  it('refuses a segment with a missing end', () => {
    const { network } = buildNetwork(
      [
        [0, 0],
        [100, 0],
      ],
      [[0, 1]],
    );
    const dangling = { vertices: network.vertices.slice(1), segments: network.segments };
    expect(
      splitSegment(dangling, network.segments[0]?.id ?? '', 0.5, countingIds()),
    ).toBeUndefined();
  });
});
