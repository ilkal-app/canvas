import { describe, expect, it } from 'vitest';

import type { Segment, Vertex } from '../objects/path-network.js';

import { networkToPathData } from './network-path-data.js';
import { subpathsToNetwork } from './svg-network.js';
import { readPathData } from './svg-path-data.js';

const ZERO = { x: 0, y: 0 };

function vertex(id: string, x: number, y: number): Vertex {
  return { id, x, y, mirror: 'none' };
}

function line(id: string, a: string, b: string): Segment {
  return { id, a, b, ha: ZERO, hb: ZERO };
}

/**
 * The network path data reads back to, as the board would store it.
 *
 * @param data - Path data.
 * @returns Its network.
 */
function networkOf(data: string) {
  const read = readPathData(data);
  expect(read.error).toBeUndefined();
  return subpathsToNetwork(read.subpaths, false);
}

/**
 * A network's segments as curves, independent of ids, order and direction: each segment's end
 * points and absolute control points, rounded, in whichever direction sorts first.
 *
 * @param network - The network.
 * @param network.vertices - Its vertices.
 * @param network.segments - Its segments.
 * @returns The curves, sorted.
 */
function curvesOf(network: { vertices: readonly Vertex[]; segments: readonly Segment[] }) {
  const byId = new Map(network.vertices.map((each) => [each.id, each]));
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return network.segments
    .map((segment) => {
      const a = byId.get(segment.a) ?? vertex('?', NaN, NaN);
      const b = byId.get(segment.b) ?? vertex('?', NaN, NaN);
      const points = [a.x, a.y, a.x + segment.ha.x, a.y + segment.ha.y];
      const back = [b.x, b.y, b.x + segment.hb.x, b.y + segment.hb.y];
      const forward = [...points, ...back].map(round).join(' ');
      const reverse = [...back, ...points].map(round).join(' ');
      return forward < reverse ? forward : reverse;
    })
    .sort();
}

describe('networkToPathData', () => {
  it('writes an open chain as lines from its first end', () => {
    const vertices = [vertex('p', 0, 0), vertex('q', 10, 0), vertex('r', 10, 5)];
    const segments = [line('s1', 'p', 'q'), line('s2', 'q', 'r')];
    expect(networkToPathData(vertices, segments)).toBe('M0 0L10 0L10 5');
  });

  it('closes a loop with Z, leaving its last line to the closepath', () => {
    const vertices = [vertex('a', 0, 0), vertex('b', 4, 0), vertex('c', 4, 3)];
    const segments = [line('s0', 'a', 'b'), line('s1', 'b', 'c'), line('s2', 'c', 'a')];
    expect(networkToPathData(vertices, segments)).toBe('M0 0L4 0L4 3Z');
  });

  it('writes a curved segment as a cubic with absolute control points, either way round', () => {
    const vertices = [vertex('a', 0, 0), vertex('b', 10, 0)];
    const forward: Segment = { id: 's', a: 'a', b: 'b', ha: { x: 2, y: 5 }, hb: { x: -2, y: 5 } };
    expect(networkToPathData(vertices, [forward])).toBe('M0 0C2 5 8 5 10 0');
    // Walked from `b` (the chain's first end in vertex order), the handles swap.
    const backward = [vertex('b', 10, 0), vertex('a', 0, 0)];
    expect(networkToPathData(backward, [forward])).toBe('M10 0C8 5 2 5 0 0');
  });

  it('rounds to three decimals, trims zeros and never writes a negative zero', () => {
    const vertices = [vertex('a', 0.12345, -0.0001), vertex('b', 2.5, 1 / 3)];
    expect(networkToPathData(vertices, [line('s', 'a', 'b')])).toBe('M0.123 0L2.5 0.333');
  });

  it('splits a junction into chains that each end there', () => {
    const vertices = [vertex('j', 0, 0), vertex('x', 5, 0), vertex('y', 0, 5), vertex('z', -5, 0)];
    const segments = [line('s0', 'j', 'x'), line('s1', 'j', 'y'), line('s2', 'j', 'z')];
    expect(networkToPathData(vertices, segments)).toBe('M0 0L5 0M0 0L0 5M0 0L-5 0');
  });

  it('skips a segment whose end the network does not hold', () => {
    const vertices = [vertex('a', 0, 0), vertex('b', 5, 0)];
    const segments = [line('s0', 'a', 'b'), line('s1', 'b', 'gone'), line('s2', 'gone', 'a')];
    expect(networkToPathData(vertices, segments)).toBe('M0 0L5 0');
    expect(networkToPathData([vertex('a', 0, 0)], [line('s', 'gone', 'lost')])).toBe('');
  });

  it('writes nothing for a network with no segments', () => {
    expect(networkToPathData([vertex('a', 1, 1)], [])).toBe('');
  });

  it.each([
    ['a triangle and an open stroke', 'M0 0L10 0L10 10ZM20 0L30 5'],
    ['a curved loop', 'M0 0C0 -5 10 -5 10 0C10 5 0 5 0 0Z'],
    ['two curved loops', 'M0 0C5 0 5 5 5 10L0 10ZM20 20C25 20 25 25 25 30L20 30Z'],
    ['an arc', 'M0 0A5 5 0 0 1 10 0'],
    ['relative and smooth commands', 'm2 2c1 0 2 1 2 2s1 2 2 2l3 -1h2v2z'],
  ])('reads back to the same network: %s', (unused, data) => {
    const network = networkOf(data);
    const written = networkToPathData(network.vertices, network.segments);
    const again = networkOf(written);
    expect(curvesOf(again)).toEqual(curvesOf(network));
    expect(again.loops).toBe(network.loops);
  });

  it('does not mutate its inputs', () => {
    const vertices = Object.freeze([
      Object.freeze(vertex('a', 0, 0)),
      Object.freeze(vertex('b', 1, 1)),
    ]);
    const segments = Object.freeze([Object.freeze(line('s', 'a', 'b'))]);
    expect(networkToPathData(vertices, segments)).toBe('M0 0L1 1');
  });
});
