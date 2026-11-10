import { describe, expect, it } from 'vitest';

import { buildNetwork, ringPairs } from './__fixtures__/networks.js';
import type { Cubic } from './bezier.js';
import { closedLoops, flattenChain, isolatedVertices, loopCubics, strokeChains } from './chains.js';
import { indexNetwork } from './network-index.js';

// Ported from the prototype's `webgl-whiteboard/src/vector/network.test.ts` (`closedLoops`,
// `loopCubics`, `strokeChains`) and `stroke.test.ts` (`flattenChain`).
const OPEN = buildNetwork(
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
const TRIANGLE_POINTS = [
  [0, 0],
  [10, 0],
  [5, 8],
] as const;
const TRIANGLE = buildNetwork(TRIANGLE_POINTS, ringPairs(TRIANGLE_POINTS));
// A square with one diagonal: every vertex on a loop, but two of degree 3.
const THETA = buildNetwork(
  [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  [...ringPairs([0, 1, 2, 3]), [0, 2]],
);
// A triangle with a segment hanging off one corner.
const LOOP_WITH_TAIL = buildNetwork(
  [
    [0, 0],
    [10, 0],
    [5, 8],
    [30, 0],
  ],
  [...ringPairs([0, 1, 2]), [1, 3]],
);
const TWO_LOOPS = buildNetwork(
  [...TRIANGLE_POINTS, [100, 0], [110, 0], [105, 8]],
  [...ringPairs([0, 1, 2]), ...ringPairs([3, 4, 5], 3)],
);

describe('closedLoops', () => {
  it('finds nothing in an open path, a theta graph or a loop with a tail', () => {
    for (const network of [OPEN, THETA, LOOP_WITH_TAIL]) {
      expect(closedLoops(indexNetwork(network))).toEqual([]);
    }
  });

  it('orders the vertices of a triangle', () => {
    expect(closedLoops(indexNetwork(TRIANGLE))).toEqual([['v0', 'v1', 'v2']]);
  });

  it('finds each loop of a network with two', () => {
    const loops = closedLoops(indexNetwork(TWO_LOOPS));
    expect(loops).toHaveLength(2);
    expect(new Set(loops[0])).toEqual(new Set(['v0', 'v1', 'v2']));
    expect(new Set(loops[1])).toEqual(new Set(['v3', 'v4', 'v5']));
  });

  it('ignores a lone vertex and a two-vertex component', () => {
    const network = buildNetwork(
      [
        [0, 0],
        [5, 5],
        [9, 9],
      ],
      [[1, 2]],
    );
    expect(closedLoops(indexNetwork(network))).toEqual([]);
  });

  it('gives cubics that join end to start round the loop, oriented along it', () => {
    const curved = buildNetwork(
      TRIANGLE_POINTS,
      [
        [0, 1],
        [2, 1],
        [2, 0],
      ],
      {
        1: [
          { x: 3, y: 0 },
          { x: 0, y: 3 },
        ],
      },
    );
    const index = indexNetwork(curved);
    const [loop] = closedLoops(index);
    if (!loop) throw new Error('No loop.');
    const cubics = loopCubics(index, loop);
    expect(cubics).toHaveLength(3);
    for (let at = 0; at < 3; at += 1) {
      expect(cubics[at]?.[3]).toEqual(cubics[(at + 1) % 3]?.[0]);
    }
    // The reversed segment keeps its handles on the right ends.
    expect(cubics[1]).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 3 },
      { x: 8, y: 8 },
      { x: 5, y: 8 },
    ]);
  });
});

describe('strokeChains', () => {
  it('runs through degree-2 vertices and stops at ends and branches', () => {
    const summary = (network: typeof OPEN): [number, boolean][] =>
      strokeChains(indexNetwork(network)).map(({ cubics, isClosed }) => [cubics.length, isClosed]);
    expect(summary(OPEN)).toEqual([[2, false]]);
    expect(summary(TRIANGLE)).toEqual([[3, true]]);
    const star = buildNetwork(
      [
        [0, 0],
        [10, 0],
        [-10, 0],
        [0, 10],
        [20, 0],
      ],
      [
        [0, 1],
        [0, 2],
        [0, 3],
        [1, 4],
      ],
    );
    expect(
      summary(star)
        .map(([count]) => count)
        .sort(),
    ).toEqual([1, 1, 2]);
    expect(summary(star).every(([, isClosed]) => !isClosed)).toBe(true);
    expect(
      summary(THETA)
        .map(([count]) => count)
        .sort(),
    ).toEqual([1, 2, 2]);
    // A loop through a branch vertex starts and ends there, capped (the prototype's rule).
    expect(summary(LOOP_WITH_TAIL)).toEqual([
      [3, false],
      [1, false],
    ]);
  });

  it('gives continuous chains, whichever way the segments point', () => {
    const network = buildNetwork(
      [
        [0, 0],
        [10, 0],
        [20, 5],
      ],
      [
        [0, 1],
        [2, 1],
      ],
    );
    const [chain] = strokeChains(indexNetwork(network));
    expect(chain?.cubics[0]?.[3]).toEqual(chain?.cubics[1]?.[0]);
  });

  it('strokes every segment exactly once', () => {
    for (const network of [OPEN, TRIANGLE, THETA, LOOP_WITH_TAIL, TWO_LOOPS]) {
      const chains = strokeChains(indexNetwork(network));
      const cubicCount = chains.reduce((total, { cubics }) => total + cubics.length, 0);
      expect(cubicCount).toBe(network.segments.length);
    }
  });
});

describe('isolatedVertices', () => {
  it('lists the vertices no segment touches', () => {
    const network = buildNetwork(
      [
        [0, 0],
        [5, 5],
        [9, 9],
      ],
      [[1, 2]],
    );
    expect(isolatedVertices(indexNetwork(network)).map(({ id }) => id)).toEqual(['v0']);
  });
});

describe('flattenChain', () => {
  it('joins cubics without repeating their shared points', () => {
    const first: Cubic = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
    ];
    const second: Cubic = [
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    ];
    expect(flattenChain([first, second], 0.25)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(flattenChain([], 0.25)).toEqual([]);
  });
});
