import { describe, expect, it } from 'vitest';

import { buildNetwork, countingIds } from './__fixtures__/networks.js';
import { isEmptyNetworkEdit, networkEditOf } from './network-edit.js';
import { deleteVertices, moveVertices } from './network.js';
import { splitSegment } from './split-segment.js';

const chain = buildNetwork(
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

describe('networkEditOf', () => {
  it('is empty for the same network', () => {
    expect(isEmptyNetworkEdit(networkEditOf(chain.network, chain.network))).toBe(true);
    const copy = {
      vertices: chain.network.vertices.map((vertex) => ({ ...vertex })),
      segments: chain.network.segments.map((segment) => ({ ...segment })),
    };
    expect(isEmptyNetworkEdit(networkEditOf(chain.network, copy))).toBe(true);
  });

  it('sets only the members a move changed', () => {
    const moved = moveVertices(chain.network, [chain.ids[1] ?? ''], 0, 5);
    expect(networkEditOf(chain.network, moved)).toEqual({
      setVertices: [{ id: chain.ids[1], x: 10, y: 5, mirror: 'none' }],
      deleteVertexIds: [],
      setSegments: [],
      deleteSegmentIds: [],
    });
  });

  it('adds and changes members for a split, and deletes for a delete', () => {
    const split = splitSegment(
      chain.network,
      chain.network.segments[0]?.id ?? '',
      0.5,
      countingIds('x'),
    );
    if (!split) throw new Error('not split');
    const edit = networkEditOf(chain.network, split.network);
    expect(edit.setVertices.map(({ id }) => id)).toEqual([split.vertexId]);
    expect(edit.setSegments.map(({ id }) => id)).toEqual([chain.network.segments[0]?.id, 'x2']);
    const deleted = networkEditOf(
      chain.network,
      deleteVertices(chain.network, [chain.ids[2] ?? '']),
    );
    expect(deleted.deleteVertexIds).toEqual([chain.ids[2]]);
    expect(deleted.deleteSegmentIds).toEqual([chain.network.segments[1]?.id]);
    expect(deleted.setVertices).toEqual([]);
  });
});
