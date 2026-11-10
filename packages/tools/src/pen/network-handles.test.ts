// The prototype's handle tests (webgl-whiteboard `src/vector/network.test.ts`, "setHandle
// mirroring" and "toggleSmooth", and `penMode.test.ts`'s `continuationHandle`), ported.
import { describe, expect, it } from 'vitest';

import type { PathNetwork } from '@canvas/engine';

import {
  buildNetwork,
  countingIds,
  deepFreeze,
  EMPTY_NETWORK,
  handleAtVertex,
  segmentBetween,
} from './__fixtures__/networks.js';
import { continuationHandle, setHandle, toggleSmooth } from './network-handles.js';
import { addVertex, connect, type Mirror } from './network.js';

const ZERO = { x: 0, y: 0 };

/**
 * A three-vertex chain whose middle vertex has the given mirror, with the handle at the middle
 * of the first segment pulled to (−10, 0).
 *
 * @param mirror - The middle vertex's mirror.
 * @returns The network, its ids and its two segment ids.
 */
function chainWith(mirror: Mirror) {
  const { network: built, ids } = buildNetwork(
    [
      [0, 0],
      [100, 0],
      [200, 0],
    ],
    [
      [0, 1],
      [1, 2],
    ],
  );
  const [a = '', b = '', c = ''] = ids;
  const first = segmentBetween(built, a, b).id;
  const second = segmentBetween(built, b, c).id;
  const pulled = setHandle(built, first, 'b', { x: -10, y: 0 }, false);
  const network: PathNetwork = deepFreeze({
    vertices: pulled.vertices.map((vertex) => (vertex.id === b ? { ...vertex, mirror } : vertex)),
    segments: pulled.segments,
  });
  return { network, middle: b, first, second };
}

describe('setHandle mirroring', () => {
  it("'both' mirrors direction and length", () => {
    const { network, middle, first, second } = chainWith('both');
    const out = setHandle(network, second, 'a', { x: 30, y: 40 }, false);
    expect(handleAtVertex(out, second, middle)).toEqual({ x: 30, y: 40 });
    expect(handleAtVertex(out, first, middle)).toEqual({ x: -30, y: -40 });
  });

  it("'angle' mirrors direction and keeps the other length", () => {
    const { network, middle, first, second } = chainWith('angle');
    const other = handleAtVertex(
      setHandle(network, second, 'a', { x: 30, y: 40 }, false),
      first,
      middle,
    );
    expect(other.x).toBeCloseTo(-6, 9);
    expect(other.y).toBeCloseTo(-8, 9);
  });

  it("'none' leaves the other handle alone", () => {
    const { network, middle, first, second } = chainWith('none');
    const out = setHandle(network, second, 'a', { x: 30, y: 40 }, false);
    expect(handleAtVertex(out, first, middle)).toEqual({ x: -10, y: 0 });
  });

  it('breaking the mirror moves one handle and turns mirroring off', () => {
    const { network, middle, first, second } = chainWith('both');
    const out = setHandle(network, second, 'a', { x: 30, y: 40 }, true);
    expect(handleAtVertex(out, first, middle)).toEqual({ x: -10, y: 0 });
    expect(out.vertices.find(({ id }) => id === middle)?.mirror).toBe('none');
  });

  it('does not mirror at an end vertex or a branch vertex', () => {
    const { network: built, ids } = buildNetwork(
      [
        [0, 0],
        [100, 0],
        [200, 0],
        [100, 100],
      ],
      [
        [0, 1],
        [1, 2],
        [1, 3],
      ],
    );
    const [a = '', b = '', c = '', d = ''] = ids;
    const network = deepFreeze({
      vertices: built.vertices.map((vertex) => ({ ...vertex, mirror: 'both' as const })),
      segments: built.segments,
    });
    const ab = segmentBetween(network, a, b).id;
    const out = setHandle(network, ab, 'b', { x: -20, y: 0 }, false);
    expect(handleAtVertex(out, segmentBetween(out, b, c).id, b)).toEqual(ZERO);
    expect(handleAtVertex(out, segmentBetween(out, b, d).id, b)).toEqual(ZERO);
    const end = setHandle(network, ab, 'a', { x: 5, y: 5 }, false);
    expect(handleAtVertex(end, ab, a)).toEqual({ x: 5, y: 5 });
  });

  it('leaves the network alone for an unknown segment', () => {
    const { network } = chainWith('both');
    expect(setHandle(network, 'nope', 'a', { x: 1, y: 1 }, false)).toBe(network);
  });
});

describe('toggleSmooth', () => {
  it('gives a corner handles along its neighbours, a third of each distance, and back', () => {
    const { network, ids } = buildNetwork(
      [
        [0, 0],
        [90, 0],
        [90, 60],
      ],
      [
        [0, 1],
        [1, 2],
      ],
    );
    const [a = '', b = '', c = ''] = ids;
    const smooth = toggleSmooth(network, b);
    expect(smooth.vertices.find(({ id }) => id === b)?.mirror).toBe('both');
    const length = Math.hypot(90, 60);
    const direction = { x: 90 / length, y: 60 / length };
    const toPrevious = handleAtVertex(smooth, segmentBetween(smooth, a, b).id, b);
    const toNext = handleAtVertex(smooth, segmentBetween(smooth, b, c).id, b);
    expect(toPrevious.x).toBeCloseTo(-direction.x * 30, 9);
    expect(toPrevious.y).toBeCloseTo(-direction.y * 30, 9);
    expect(toNext.x).toBeCloseTo(direction.x * 20, 9);
    expect(toNext.y).toBeCloseTo(direction.y * 20, 9);
    const corner = toggleSmooth(deepFreeze(smooth), b);
    expect(corner.vertices.find(({ id }) => id === b)?.mirror).toBe('none');
    expect(handleAtVertex(corner, segmentBetween(corner, a, b).id, b)).toEqual(ZERO);
    expect(handleAtVertex(corner, segmentBetween(corner, b, c).id, b)).toEqual(ZERO);
  });

  it('only zeroes the handles at a vertex without exactly two segment ends', () => {
    const { network, ids } = buildNetwork(
      [
        [0, 0],
        [100, 0],
      ],
      [[0, 1]],
    );
    const [a = ''] = ids;
    const segmentId = network.segments[0]?.id ?? '';
    const curved = setHandle(network, segmentId, 'a', { x: 10, y: 10 }, false);
    expect(handleAtVertex(toggleSmooth(curved, a), segmentId, a)).toEqual(ZERO);
    expect(toggleSmooth(network, a)).toBe(network);
  });
});

describe('continuationHandle', () => {
  const open = (mirror: Mirror, handle: { x: number; y: number }) => {
    const newId = countingIds();
    const start = addVertex(EMPTY_NETWORK, { x: 0, y: 0 }, newId, mirror);
    const end = addVertex(start.network, { x: 100, y: 0 }, newId);
    const joined = connect(end.network, start.id, end.id, newId, handle);
    return { network: joined.network, start: start.id, end: end.id };
  };

  it('is the negated handle of an open smooth end', () => {
    const { network, start } = open('both', { x: 20, y: -10 });
    expect(continuationHandle(network, start)).toEqual({ x: -20, y: 10 });
  });

  it('is none for a corner end, a zero handle, two ends or a missing vertex', () => {
    expect(continuationHandle(open('none', { x: 20, y: -10 }).network, 'n1')).toBeUndefined();
    expect(continuationHandle(open('both', ZERO).network, 'n1')).toBeUndefined();
    const { network: built, ids } = buildNetwork(
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
    const [, b = ''] = ids;
    const both = {
      vertices: built.vertices.map((vertex) => ({ ...vertex, mirror: 'both' as const })),
      segments: built.segments,
    };
    const pulled = setHandle(both, built.segments[0]?.id ?? '', 'b', { x: 20, y: -10 }, true);
    expect(continuationHandle(pulled, b)).toBeUndefined();
    expect(continuationHandle(EMPTY_NETWORK, 'nope')).toBeUndefined();
  });
});

describe('toggleSmooth on what it cannot smooth', () => {
  it('leaves an unknown vertex, a missing neighbour and neighbours in one place alone', () => {
    const { network, ids } = buildNetwork(
      [
        [0, 0],
        [50, 0],
        [0, 0],
        [200, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    );
    const [, middle = '', third = ''] = ids;
    expect(toggleSmooth(network, 'nope')).toBe(network);
    // The middle vertex's neighbours are both at the origin: no direction to smooth along.
    expect(toggleSmooth(network, middle)).toBe(network);
    const dangling = {
      vertices: network.vertices.filter(({ id }) => id !== ids[3]),
      segments: network.segments,
    };
    expect(toggleSmooth(dangling, third)).toBe(dangling);
  });

  it('touches only the two segments at the vertex it smooths', () => {
    const { network, ids } = buildNetwork(
      [
        [0, 0],
        [100, 0],
        [200, 50],
        [300, 50],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    );
    const smooth = toggleSmooth(network, ids[1] ?? '');
    expect(smooth.segments[2]).toBe(network.segments[2]);
    const corner = toggleSmooth(smooth, ids[1] ?? '');
    expect(corner.segments[2]).toBe(network.segments[2]);
  });
});
