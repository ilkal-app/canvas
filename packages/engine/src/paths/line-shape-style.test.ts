import { describe, expect, it } from 'vitest';

import { pathObject } from '../spatial/__fixtures__/spatial-objects.js';

import { covers, meshBounds } from './__fixtures__/mesh-coverage.js';
import { buildLineMesh } from './line-mesh.js';
import { lineShapeOf } from './line-shape.js';
import { buildPathMesh } from './path-mesh.js';

// A line's or connector's stroke cap applies only at an end with no decoration; a
// path's open ends take it; a path's join applies at its vertices, not inside its curves.

const TOLERANCE = 0.05;
const ROUTE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];

/**
 * The stroke triangles of a mesh: what follows the fill and the cover quad.
 *
 * @param mesh - The mesh.
 * @param mesh.vertices - Its vertex list.
 * @param mesh.strokeVertexCount - How many of them are the stroke's.
 * @returns The stroke's floats.
 */
function strokeOf(mesh: {
  readonly vertices: Float32Array;
  readonly strokeVertexCount: number;
}): Float32Array {
  return mesh.vertices.subarray(mesh.vertices.length - mesh.strokeVertexCount * 2);
}

describe('a line’s stroke cap', () => {
  it('ends an undecorated end in the stroke cap, round by default', () => {
    expect(lineShapeOf({ route: ROUTE, startCap: 'none', endCap: 'none' }, 2).shaftCaps).toEqual({
      start: 'round',
      end: 'round',
    });
    const square = lineShapeOf(
      { route: ROUTE, startCap: 'none', endCap: 'none', outline: { cap: 'square' } },
      2,
    );
    expect(square.shaftCaps).toEqual({ start: 'square', end: 'square' });
  });

  it('keeps the decoration’s shaft end under a decorated end', () => {
    const shape = lineShapeOf(
      { route: ROUTE, startCap: 'none', endCap: 'triangle', outline: { cap: 'square' } },
      2,
    );
    expect(shape.shaftCaps).toEqual({ start: 'square', end: 'butt' });
    const arrow = lineShapeOf(
      { route: ROUTE, startCap: 'arrow', endCap: 'none', outline: { cap: 'butt' } },
      2,
    );
    expect(arrow.shaftCaps).toEqual({ start: 'round', end: 'butt' });
  });

  it('dashes the shaft and leaves the heads solid', () => {
    const mesh = buildLineMesh({
      route: ROUTE,
      startCap: 'none',
      endCap: 'triangle',
      strokeWidth: 2,
      tolerance: TOLERANCE,
      outline: { dash: { pattern: [10, 10], offset: 0 }, cap: 'butt' },
    });
    const stroke = strokeOf(mesh);
    expect(covers(stroke, 5, 0)).toBe(true);
    expect(covers(stroke, 15, 0)).toBe(false);
    // The triangle head, solid at the end.
    expect(covers(stroke, 99, 0)).toBe(true);
  });

  it('joins a curved connector round along its curve, whatever the join', () => {
    const curve = [
      { x: 0, y: 0 },
      { x: 0, y: 60 },
      { x: 100, y: 60 },
      { x: 100, y: 0 },
    ] as const;
    const base = { route: [curve[0], curve[3]], curve, startCap: 'none', endCap: 'none' } as const;
    const plain = buildLineMesh({ ...base, strokeWidth: 8, tolerance: 0.5 });
    const mitred = buildLineMesh({
      ...base,
      strokeWidth: 8,
      tolerance: 0.5,
      outline: { join: 'miter' },
    });
    expect(mitred.vertices).toEqual(plain.vertices);
  });
});

describe('a path’s stroke style', () => {
  it('caps its open ends with the stroke cap', () => {
    const path = pathObject('p', ROUTE);
    const network = { vertices: path.vertices, segments: path.segments };
    const round = buildPathMesh({ network, strokeWidth: 2, isFilled: false, tolerance: TOLERANCE });
    expect(meshBounds(strokeOf(round)).minX).toBeCloseTo(-1);
    const butt = buildPathMesh({
      network,
      strokeWidth: 2,
      isFilled: false,
      tolerance: TOLERANCE,
      outline: { cap: 'butt' },
    });
    expect(meshBounds(strokeOf(butt)).minX).toBeCloseTo(0);
  });

  it('applies a bevel at its vertices and joins round inside its curves', () => {
    // A curve, then a sharp corner at its end.
    const path = pathObject(
      'p',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      {
        handles: [
          { x: 30, y: -30 },
          { x: -30, y: -30 },
        ],
      },
    );
    const [curved, straight] = path.segments;
    if (!curved || !straight) throw new Error('two segments expected');
    const segments = [curved, { ...straight, ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } }];
    const network = { vertices: path.vertices, segments };
    const input = { network, strokeWidth: 10, isFilled: false, tolerance: 0.5 };
    const plain = strokeOf(buildPathMesh(input));
    const bevel = strokeOf(buildPathMesh({ ...input, outline: { join: 'bevel' } }));
    const miter = strokeOf(buildPathMesh({ ...input, outline: { join: 'miter', miterLimit: 10 } }));
    // The meshes differ only at the vertex, so the bevel draws less there than the round join.
    expect(bevel.length).toBeLessThan(plain.length);
    // Past the round join's reach on the outer bisector of the 45° corner at (100, 0).
    expect(covers(miter, 104.8, -1.99)).toBe(true);
    expect(covers(plain, 104.8, -1.99)).toBe(false);
    expect(covers(bevel, 104.8, -1.99)).toBe(false);
  });
});
