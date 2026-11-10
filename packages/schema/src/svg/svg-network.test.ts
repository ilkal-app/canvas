import { describe, expect, it } from 'vitest';

import { findNetworkIssues } from '../objects/path-network.js';

import type { OutlinePiece, Subpath } from './svg-geometry.js';
import { hasOpenSubpath, placeNetwork, subpathsToNetwork } from './svg-network.js';
import { readPathData } from './svg-path-data.js';

function subpaths(data: string): readonly Subpath[] {
  return readPathData(data).subpaths;
}

const line = (x: number, y: number): OutlinePiece => ({ kind: 'line', to: { x, y } });

describe('subpathsToNetwork', () => {
  it('makes an open subpath a chain and a closed one a loop ending at its first vertex', () => {
    const network = subpathsToNetwork(subpaths('M0 0 L10 0 L10 10 M20 0 L30 0 L30 10 Z'), false);
    expect(network.vertices.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 0],
      [30, 0],
      [30, 10],
    ]);
    expect(network.segments.map(({ a, b }) => [a, b])).toEqual([
      ['v0', 'v1'],
      ['v1', 'v2'],
      ['v3', 'v4'],
      ['v4', 'v5'],
      ['v5', 'v3'],
    ]);
    expect(findNetworkIssues(network.vertices, network.segments)).toEqual([]);
  });

  it('reuses the first vertex when the last piece already ends there, and drops empty pieces', () => {
    const network = subpathsToNetwork(subpaths('M0 0 L10 0 L10 0 L10 10 L0 0 Z'), false);
    expect(network.vertices).toHaveLength(3);
    expect(network.segments.map(({ a, b }) => [a, b])).toEqual([
      ['v0', 'v1'],
      ['v1', 'v2'],
      ['v2', 'v0'],
    ]);
  });

  it('closes open subpaths with shouldCloseAll, as a fill needs', () => {
    const network = subpathsToNetwork(subpaths('M0 0 L10 0 L10 10'), true);
    expect(network.segments.map(({ a, b }) => [a, b])).toEqual([
      ['v0', 'v1'],
      ['v1', 'v2'],
      ['v2', 'v0'],
    ]);
  });

  it('keeps cubic handles as offsets from their vertices', () => {
    const network = subpathsToNetwork(subpaths('M0 0 C0 10 20 10 20 0'), false);
    expect(network.segments).toEqual([
      { id: 's0', a: 'v0', b: 'v1', ha: { x: 0, y: 10 }, hb: { x: 0, y: 10 } },
    ]);
  });

  it('splits a loop of one or two cubics so it has three vertices and stays well formed', () => {
    // A single cubic from a point back to itself, and a lens of two cubics.
    for (const data of [
      'M0 0 C10 -10 10 10 0 0 Z',
      'M0 0 C0 -10 20 -10 20 0 C20 10 0 10 0 0 Z',
      'M0 0 L20 0 C20 10 0 10 0 0 Z',
    ]) {
      const network = subpathsToNetwork(subpaths(data), false);
      expect(network.vertices.length, data).toBe(3);
      expect(findNetworkIssues(network.vertices, network.segments), data).toEqual([]);
    }
    // Halving keeps the curve: the split point of the lens's first cubic is its midpoint.
    const lens = subpathsToNetwork(subpaths('M0 0 C0 -10 20 -10 20 0 C20 10 0 10 0 0 Z'), false);
    expect(lens.vertices[1]).toMatchObject({ x: 10, y: -7.5 });
  });

  it('draws two lines there and back as one open line, and skips subpaths that draw nothing', () => {
    const network = subpathsToNetwork(subpaths('M0 0 L10 0 Z M5 5 L5 5 Z'), false);
    expect(network.segments.map(({ a, b }) => [a, b])).toEqual([['v0', 'v1']]);
    expect(network.vertices).toHaveLength(2);
    const empty: Subpath = { start: { x: 0, y: 0 }, pieces: [line(0, 0)], isClosed: false };
    expect(subpathsToNetwork([empty], true)).toEqual({ vertices: [], segments: [], loops: 0 });
  });

  it('keeps a cubic that returns to its start, with handles, as a piece', () => {
    const loop: Subpath = {
      start: { x: 0, y: 0 },
      pieces: [{ kind: 'cubic', c1: { x: 0, y: 0 }, c2: { x: 0, y: 0 }, to: { x: 0, y: 0 } }],
      isClosed: true,
    };
    expect(subpathsToNetwork([loop], false).segments).toEqual([]);
  });
});

describe('hasOpenSubpath', () => {
  it('finds open subpaths that draw something', () => {
    expect(hasOpenSubpath(subpaths('M0 0 L10 0 L10 10 Z'))).toBe(false);
    expect(hasOpenSubpath(subpaths('M0 0 L10 0 Z M20 0 L30 0'))).toBe(true);
    const empty: Subpath = { start: { x: 0, y: 0 }, pieces: [line(0, 0)], isClosed: false };
    expect(hasOpenSubpath([empty])).toBe(false);
  });
});

describe('placeNetwork', () => {
  it('moves the network so its vertices and handles start at the origin', () => {
    const network = subpathsToNetwork(subpaths('M10 20 C5 30 40 30 40 20'), false);
    const placed = placeNetwork(network);
    expect(placed.x).toBe(5);
    expect(placed.y).toBe(20);
    expect(placed.vertices.map(({ x, y }) => [x, y])).toEqual([
      [5, 0],
      [35, 0],
    ]);
    expect(placed.segments).toBe(network.segments);
  });
});
