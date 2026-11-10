// The prototype's network tests (webgl-whiteboard `src/vector/network.test.ts`), ported: connect
// rules, moves, delete versus heal, pruning; every input is deep-frozen, so an operation that
// mutated its input would throw.
import { describe, expect, it } from 'vitest';

import {
  buildNetwork,
  countingIds,
  deepFreeze,
  EMPTY_NETWORK,
  handleAtVertex,
  segmentBetween,
} from './__fixtures__/networks.js';
import { setHandle } from './network-handles.js';
import {
  addVertex,
  connect,
  deleteAndHeal,
  deleteVertices,
  moveVertices,
  otherEnd,
  pruneOrphans,
  segmentsAt,
} from './network.js';

const ZERO = { x: 0, y: 0 };

describe('addVertex and connect', () => {
  it('adds vertices and straight segments, leaving the input alone', () => {
    const newId = countingIds('x');
    const first = addVertex(EMPTY_NETWORK, { x: 1, y: 2 }, newId);
    expect(EMPTY_NETWORK.vertices).toHaveLength(0);
    expect(first.network.vertices).toEqual([{ id: 'x1', x: 1, y: 2, mirror: 'none' }]);
    const second = addVertex(deepFreeze(first.network), { x: 5, y: 6 }, newId, 'both');
    const joined = connect(deepFreeze(second.network), first.id, second.id, newId);
    expect(joined.network.segments).toEqual([
      { id: 'x3', a: first.id, b: second.id, ha: ZERO, hb: ZERO },
    ]);
    expect(second.network.segments).toHaveLength(0);
  });

  it('refuses a self-join, a pair already joined (either way) and a missing vertex', () => {
    const { network, ids } = buildNetwork(
      [
        [0, 0],
        [10, 0],
      ],
      [[0, 1]],
    );
    const [a = '', b = ''] = ids;
    for (const [from, to] of [
      [a, a],
      [a, b],
      [b, a],
      [a, 'nope'],
    ] as const) {
      const refused = connect(network, from, to, countingIds());
      expect(refused.id).toBeNull();
      expect(refused.network).toBe(network);
    }
  });

  it('lists the segment ends at a vertex', () => {
    const { network, ids } = buildNetwork(
      [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
      [
        [0, 1],
        [2, 1],
      ],
    );
    expect(segmentsAt(network, ids[1] ?? '').map(({ end }) => end)).toEqual(['b', 'b']);
    expect(segmentsAt(network, ids[0] ?? '').map(({ end }) => end)).toEqual(['a']);
    const [first] = network.segments;
    expect(first && otherEnd(first, ids[0] ?? '')).toBe(ids[1]);
  });
});

describe('moveVertices', () => {
  it('moves only the vertices named', () => {
    const { network, ids } = buildNetwork(
      [
        [0, 0],
        [10, 0],
      ],
      [[0, 1]],
    );
    const moved = moveVertices(network, [ids[1] ?? ''], 5, -5);
    expect(moved.vertices.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [15, -5],
    ]);
    expect(moved.segments).toBe(network.segments);
  });
});

describe('delete', () => {
  const chain = () =>
    buildNetwork(
      [
        [0, 0],
        [10, 0],
        [20, 0],
        [30, 0],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    );

  it('deleteVertices leaves a gap and drops the vertices left alone', () => {
    const { network, ids } = chain();
    const out = deleteVertices(network, [ids[1] ?? '']);
    expect(out.vertices.map(({ id }) => id)).toEqual([ids[2], ids[3]]);
    expect(out.segments).toHaveLength(1);
  });

  it('deleteAndHeal joins the neighbours and keeps their outer handles', () => {
    const { network: built, ids } = buildNetwork(
      [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
      [
        [0, 1],
        [1, 2],
      ],
    );
    const [a = '', b = '', c = ''] = ids;
    let network = setHandle(built, segmentBetween(built, a, b).id, 'a', { x: 0, y: 7 }, false);
    network = setHandle(network, segmentBetween(network, b, c).id, 'b', { x: 0, y: -9 }, false);
    const out = deleteAndHeal(deepFreeze(network), [b], countingIds('h'));
    expect(out.vertices.map(({ id }) => id)).toEqual([a, c]);
    expect(out.segments).toEqual([{ id: 'h1', a, b: c, ha: { x: 0, y: 7 }, hb: { x: 0, y: -9 } }]);
    expect(handleAtVertex(out, 'h1', c)).toEqual({ x: 0, y: -9 });
  });

  it('deleteAndHeal makes no duplicate or self segment', () => {
    const triangle = buildNetwork(
      [
        [0, 0],
        [10, 0],
        [5, 8],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
    );
    const out = deleteAndHeal(triangle.network, [triangle.ids[1] ?? ''], countingIds('h'));
    expect(out.segments).toHaveLength(1);
    expect(out.vertices).toHaveLength(2);
  });

  it('pruneOrphans drops lone vertices but the one to keep', () => {
    const lone = addVertex(EMPTY_NETWORK, { x: 0, y: 0 }, countingIds());
    expect(pruneOrphans(lone.network).vertices).toHaveLength(0);
    expect(pruneOrphans(lone.network, lone.id).vertices).toHaveLength(1);
    const { network } = chain();
    expect(pruneOrphans(network)).toBe(network);
  });
});
