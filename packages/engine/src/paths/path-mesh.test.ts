import { describe, expect, it } from 'vitest';

import { covers, coverCount } from './__fixtures__/mesh-coverage.js';
import { buildNetwork, ringPairs } from './__fixtures__/networks.js';
import type { PathNetwork } from './network-index.js';
import { buildPathMesh, COVER_VERTEX_COUNT, type PathMeshData } from './path-mesh.js';

const SQUARE_WITH_HOLE = buildNetwork(
  [
    [0, 0],
    [30, 0],
    [30, 30],
    [0, 30],
    [10, 10],
    [20, 10],
    [20, 20],
    [10, 20],
  ],
  [...ringPairs([0, 1, 2, 3]), ...ringPairs([4, 5, 6, 7], 4)],
);

function mesh(network: PathNetwork, strokeWidth: number, isFilled: boolean, tolerance = 0.25) {
  return buildPathMesh({ network, strokeWidth, isFilled, tolerance });
}

const fillOf = (data: PathMeshData): Float32Array =>
  data.vertices.subarray(0, data.fillVertexCount * 2);
const coverOf = (data: PathMeshData): Float32Array =>
  data.vertices.subarray(data.fillVertexCount * 2, (data.fillVertexCount + COVER_VERTEX_COUNT) * 2);
const strokeOf = (data: PathMeshData): Float32Array =>
  data.vertices.subarray((data.fillVertexCount + COVER_VERTEX_COUNT) * 2);

describe('buildPathMesh', () => {
  it('fans every closed loop, so the stencil fills a square with a square hole', () => {
    const data = mesh(SQUARE_WITH_HOLE, 0, true);
    expect(data.strokeVertexCount).toBe(0);
    expect(data.vertices).toHaveLength((data.fillVertexCount + COVER_VERTEX_COUNT) * 2);
    const isFilled = (x: number, y: number): boolean => coverCount(fillOf(data), x, y) % 2 === 1;
    expect(isFilled(5, 8)).toBe(true);
    expect(isFilled(12, 17)).toBe(false);
    expect(data.bounds).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 30 });
  });

  it('pads the cover quad past everything it must cover', () => {
    const data = mesh(SQUARE_WITH_HOLE, 4, true, 0.5);
    expect(data.bounds).toEqual({ minX: -2, minY: -2, maxX: 32, maxY: 32 });
    expect([...coverOf(data)]).toEqual([-3, -3, 33, -3, 33, 33, -3, -3, 33, 33, -3, 33]);
    // The stroke runs round both loops, with no caps.
    expect(covers(strokeOf(data), 0, 15)).toBe(true);
    expect(covers(strokeOf(data), 10, 15)).toBe(true);
    expect(covers(strokeOf(data), 5, 15)).toBe(false);
  });

  it('strokes a branching network without filling it', () => {
    const theta = buildNetwork(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      [...ringPairs([0, 1, 2, 3]), [0, 2]],
    );
    const data = mesh(theta, 2, true);
    expect(data.fillVertexCount).toBe(0);
    expect(data.strokeVertexCount).toBeGreaterThan(0);
    expect(covers(strokeOf(data), 5, 5)).toBe(true);
  });

  it('draws a lone vertex as a dot when stroked', () => {
    const data = mesh(buildNetwork([[4, 4]], []), 2, true);
    expect(data.fillVertexCount).toBe(0);
    expect(data.bounds).toEqual({ minX: 3, minY: 3, maxX: 5, maxY: 5 });
  });

  it('is empty when nothing is drawn', () => {
    expect(mesh(buildNetwork([], []), 2, true)).toEqual({
      vertices: new Float32Array(0),
      fillVertexCount: 0,
      strokeVertexCount: 0,
      bounds: undefined,
    });
    expect(mesh(SQUARE_WITH_HOLE, 0, false).vertices).toHaveLength(0);
  });

  it('flattens curves more finely for a finer tolerance', () => {
    const arch = buildNetwork(
      [
        [0, 0],
        [100, 0],
      ],
      [[0, 1]],
      {
        0: [
          { x: 0, y: 100 },
          { x: 0, y: 100 },
        ],
      },
    );
    const coarse = mesh(arch, 2, false, 1);
    const fine = mesh(arch, 2, false, 0.01);
    expect(fine.strokeVertexCount).toBeGreaterThan(coarse.strokeVertexCount);
  });

  it('does not mutate its input', () => {
    const input = { network: SQUARE_WITH_HOLE, strokeWidth: 2, isFilled: true, tolerance: 0.25 };
    const copy = structuredClone(input);
    buildPathMesh(input);
    expect(input).toEqual(copy);
  });
});
