import { describe, expect, it } from 'vitest';

import { buildNetwork } from './__fixtures__/networks.js';
import { closedLoops, loopCubics } from './chains.js';
import { edgesOf, indexNetwork } from './network-index.js';

describe('indexNetwork', () => {
  it('lists each vertex with its edges, in segment order', () => {
    const index = indexNetwork(
      buildNetwork(
        [
          [0, 0],
          [10, 0],
          [20, 0],
        ],
        [
          [0, 1],
          [2, 1],
        ],
      ),
    );
    expect(edgesOf(index, 'v1').map(({ segment, to }) => [segment.id, to])).toEqual([
      ['s0', 'v0'],
      ['s1', 'v2'],
    ]);
    expect(index.vertexById.get('v2')).toMatchObject({ x: 20, y: 0 });
    expect(edgesOf(index, 'missing')).toEqual([]);
  });

  it('skips a segment whose vertex is missing', () => {
    const network = buildNetwork([[0, 0]], []);
    const orphan = { id: 's9', a: 'v0', b: 'gone', ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } };
    const index = indexNetwork({ vertices: network.vertices, segments: [orphan] });
    expect(edgesOf(index, 'v0')).toEqual([]);
  });

  it('refuses a loop whose consecutive vertices are not joined', () => {
    const index = indexNetwork(
      buildNetwork(
        [
          [0, 0],
          [10, 0],
          [5, 8],
        ],
        [[0, 1]],
      ),
    );
    expect(closedLoops(index)).toEqual([]);
    expect(() => loopCubics(index, ['v0', 'v1', 'v2'])).toThrow(RangeError);
  });
});
