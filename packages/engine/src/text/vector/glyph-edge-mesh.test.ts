import { describe, expect, it } from 'vitest';

import { resolveVertexBufferLayouts } from '../../gpu/vertex-layout.js';

import { EDGE_FLOATS_PER_VERTEX, glyphEdgeMesh } from './glyph-edge-mesh.js';
import { glyphEdges } from './glyph-edges.js';
import { GLYPH_EDGE_VERTEX_LAYOUT } from './vector-text-pipelines.js';

const SQUARE = {
  contours: [
    [
      { kind: 'line' as const, x0: 0, y0: 0, x1: 1, y1: 0 },
      { kind: 'line' as const, x0: 1, y0: 0, x1: 1, y1: 1 },
      { kind: 'line' as const, x0: 1, y0: 1, x1: 0, y1: 1 },
      { kind: 'line' as const, x0: 0, y0: 1, x1: 0, y1: 0 },
    ],
  ],
};

describe('glyphEdgeMesh', () => {
  it('writes exactly the floats the edge vertex layout reads', () => {
    const [layout] = resolveVertexBufferLayouts([GLYPH_EDGE_VERTEX_LAYOUT]);
    expect(layout?.byteStride).toBe(EDGE_FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT);
    const mesh = glyphEdgeMesh(glyphEdges(SQUARE));
    expect(mesh.vertexCount).toBe(4 * 6);
    expect(mesh.vertices).toHaveLength(mesh.vertexCount * EDGE_FLOATS_PER_VERTEX);
  });

  it("carries each edge, its side, its neighbours' outward normals and its convex joins", () => {
    const vertex = [...glyphEdgeMesh(glyphEdges(SQUARE)).vertices.subarray(0, 15)];
    // The bottom edge, left to right, its inside to the left (up): its outside is right.
    expect(vertex.slice(0, 6)).toEqual([0, 0, 0.5, 0, 1, 0]);
    expect(vertex.slice(6, 9)).toEqual([-1, -1, -1]);
    // Before it the left edge (outward −x), after it the right edge (outward +x); both corners
    // of a square are convex.
    expect(vertex.slice(9, 13).map((value) => Math.round(value) + 0)).toEqual([-1, 0, 1, 0]);
    expect(vertex.slice(13)).toEqual([1, 1]);
  });

  it('gives a curve split into pieces no joins between them', () => {
    const ring = {
      contours: [
        [
          { kind: 'quadratic' as const, x0: 1, y0: 0, cx: 1, cy: 1, x1: 0, y1: 1 },
          { kind: 'quadratic' as const, x0: 0, y0: 1, cx: -1, cy: 1, x1: -1, y1: 0 },
          { kind: 'quadratic' as const, x0: -1, y0: 0, cx: -1, cy: -1, x1: 0, y1: -1 },
          { kind: 'quadratic' as const, x0: 0, y0: -1, cx: 1, cy: -1, x1: 1, y1: 0 },
        ],
      ],
    };
    const mesh = glyphEdgeMesh(glyphEdges(ring, { maxBulgeEm: 0.05 }));
    const joins: number[] = [];
    for (let vertex = 0; vertex < mesh.vertexCount; vertex += 6)
      joins.push(
        ...mesh.vertices.subarray(
          vertex * EDGE_FLOATS_PER_VERTEX + 13,
          vertex * EDGE_FLOATS_PER_VERTEX + 15,
        ),
      );
    // Halving keeps each piece's tangent: only the four original joins (sharp here) remain.
    expect(joins.filter((join) => join !== 0).length).toBeLessThanOrEqual(8);
  });
});
