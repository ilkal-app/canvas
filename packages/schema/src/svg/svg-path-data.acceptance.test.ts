import { describe, expect, it } from 'vitest';

import * as publicSchema from '../index.js';

import { subpathsToNetwork } from './svg-network.js';
import { readPathData } from './svg-path-data.js';

const networkToPathData = (publicSchema as Record<string, unknown>).networkToPathData as (
  vertices: ReturnType<typeof subpathsToNetwork>['vertices'],
  segments: ReturnType<typeof subpathsToNetwork>['segments'],
) => string;

function fromData(d: string) {
  const parsed = readPathData(d);
  expect(parsed.error).toBeUndefined();
  return subpathsToNetwork(parsed.subpaths, false);
}

function geometry(network: ReturnType<typeof subpathsToNetwork>) {
  const points = network.vertices.map(({ x, y }) => [x, y].join(','));
  const byId = new Map(network.vertices.map(({ id, x, y }) => [id, [x, y].join(',')]));
  const edges = network.segments.map(({ a, b, ha, hb }) => {
    const from = byId.get(a) ?? '';
    const to = byId.get(b) ?? '';
    const forward = [from, to, ha.x, ha.y, hb.x, hb.y];
    const backward = [to, from, hb.x, hb.y, ha.x, ha.y];
    return JSON.stringify(from <= to ? forward : backward);
  });
  return { points: points.sort(), edges: edges.sort() };
}

describe('path data public API', () => {
  it('exports the reader, network builder and serializer from @canvas/schema', () => {
    expect((publicSchema as Record<string, unknown>).readPathData).toBeTypeOf('function');
    expect((publicSchema as Record<string, unknown>).subpathsToNetwork).toBeTypeOf('function');
    expect(networkToPathData).toBeTypeOf('function');
  });

  it('reports offset 0 when path data does not start with a moveto', () => {
    expect(readPathData('L10 0').error).toMatch(/must start with a moveto.*offset 0/);
  });

  it('serializes a closed loop with Z and open chains as separate subpaths', () => {
    const network = fromData('M0 0 L10 0 L10 10 Z M20 0 L30 0 M40 0 L50 0');
    const d = networkToPathData(network.vertices, network.segments);
    expect(d).toMatch(/M0 0.*Z/);
    expect(d.match(/M/g) ?? []).toHaveLength(3);
    const again = fromData(d);
    expect(geometry(again)).toEqual(geometry(network));
  });

  it('uses L only when both handles are zero and C when either handle is nonzero', () => {
    const network = fromData('M0 0 L10 0 C12 3 18 3 20 0');
    const d = networkToPathData(network.vertices, network.segments);
    expect(d).toMatch(/L10 0/);
    expect(d).toMatch(/C12 3 18 3 20 0/);
    expect(geometry(fromData(d))).toEqual(geometry(network));
  });

  it('rounds numbers to three decimals and trims trailing zeros', () => {
    const network = fromData('M0.123456 1.2000 C2.123456 3.5000 4.987654 5.0000 6.0000 7.0000');
    const d = networkToPathData(network.vertices, network.segments);
    expect(d).toContain('0.123 1.2');
    expect(d).toContain('2.123 3.5 4.988 5 6 7');
    expect(d).not.toMatch(/\.\d{4}/);
  });

  it('emits every branch of a junction as a separate drawable subpath', () => {
    const vertices = [
      { id: 'v0', x: 0, y: 0, mirror: 'none' as const },
      { id: 'v1', x: 10, y: 0, mirror: 'none' as const },
      { id: 'v2', x: 20, y: 0, mirror: 'none' as const },
      { id: 'v3', x: 10, y: 10, mirror: 'none' as const },
    ];
    const zero = { x: 0, y: 0 };
    const segments = [
      { id: 's0', a: 'v0', b: 'v1', ha: zero, hb: zero },
      { id: 's1', a: 'v1', b: 'v2', ha: zero, hb: zero },
      { id: 's2', a: 'v1', b: 'v3', ha: zero, hb: zero },
    ];
    const d = networkToPathData(vertices, segments);
    expect((d.match(/M/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(fromData(d).segments).toHaveLength(3);
    expect(d).toContain('10 10');
  });
});
