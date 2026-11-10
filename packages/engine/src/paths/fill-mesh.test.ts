import { describe, expect, it } from 'vitest';

import type { Point } from '@canvas/schema';

import { coverCount } from './__fixtures__/mesh-coverage.js';
import { fanMesh, fillMesh } from './fill-mesh.js';

const square = (x: number, y: number, size: number): Point[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

// Whether the even-odd rule fills a point: an odd number of fan triangles cover it.
const isFilled = (mesh: Float32Array, x: number, y: number): boolean =>
  coverCount(mesh, x, y) % 2 === 1;

describe('fanMesh', () => {
  it('fans a polygon from its first point', () => {
    expect([...fanMesh(square(0, 0, 4))]).toEqual([0, 0, 4, 0, 4, 4, 0, 0, 4, 4, 0, 4]);
  });

  it('is empty for fewer than three points', () => {
    expect(fanMesh([])).toHaveLength(0);
    expect(
      fanMesh([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toHaveLength(0);
  });

  it('fills a concave polygon exactly by the even-odd rule', () => {
    // An L-shaped hexagon: concave, so a plain triangle fan would not be enough without stencil.
    const l: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ];
    const mesh = fanMesh(l);
    expect(isFilled(mesh, 2, 8)).toBe(true);
    expect(isFilled(mesh, 8, 2)).toBe(true);
    expect(isFilled(mesh, 7, 7)).toBe(false);
  });
});

describe('fillMesh', () => {
  it('leaves a hole where a loop lies inside another', () => {
    // Sample points stay off the fans' diagonals, where the inclusive count doubles.
    const mesh = fillMesh([square(0, 0, 30), square(10, 10, 10)]);
    expect(isFilled(mesh, 5, 8)).toBe(true);
    expect(isFilled(mesh, 12, 17)).toBe(false);
    expect(isFilled(mesh, 35, 5)).toBe(false);
  });

  it('leaves the overlap of two overlapping loops unfilled', () => {
    const mesh = fillMesh([square(0, 0, 20), square(10, 10, 20)]);
    expect(isFilled(mesh, 5, 8)).toBe(true);
    expect(isFilled(mesh, 12, 17)).toBe(false);
    expect(isFilled(mesh, 27, 22)).toBe(true);
  });

  it('is empty with no loops', () => {
    expect(fillMesh([])).toHaveLength(0);
  });
});
