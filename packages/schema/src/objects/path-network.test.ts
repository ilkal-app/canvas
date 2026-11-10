import { describe, expect, it } from 'vitest';

import { sampleObject } from './__fixtures__/object-samples.js';
import { findNetworkIssues, type Segment, type Vertex } from './path-network.js';
import { pathObjectSchema } from './path-object.js';

const ZERO = { x: 0, y: 0 };

function vertex(id: string, x = 0, y = 0): Vertex {
  return { id, x, y, mirror: 'none' };
}

function segment(id: string, a: string, b: string): Segment {
  return { id, a, b, ha: ZERO, hb: ZERO };
}

describe('findNetworkIssues', () => {
  it('accepts an open path, a closed loop and a vertex shared by three segments', () => {
    const vertices = [vertex('v1'), vertex('v2', 10), vertex('v3', 10, 10), vertex('v4', 0, 10)];
    const segments = [
      segment('s1', 'v1', 'v2'),
      segment('s2', 'v2', 'v3'),
      segment('s3', 'v3', 'v1'),
      segment('s4', 'v2', 'v4'),
    ];
    expect(findNetworkIssues(vertices, segments)).toEqual([]);
    expect(findNetworkIssues([], [])).toEqual([]);
  });

  it('reports duplicate vertex and segment ids', () => {
    expect(findNetworkIssues([vertex('v1'), vertex('v1')], [])).toEqual([
      'vertex id "v1" is used twice',
    ]);
    expect(
      findNetworkIssues(
        [vertex('v1'), vertex('v2'), vertex('v3')],
        [segment('s1', 'v1', 'v2'), segment('s1', 'v2', 'v3')],
      ),
    ).toEqual(['segment id "s1" is used twice']);
  });

  it('reports a segment ending at a missing vertex and a segment joining a vertex to itself', () => {
    expect(findNetworkIssues([vertex('v1')], [segment('s1', 'v1', 'v9')])).toEqual([
      'segment "s1" ends at missing vertex "v9"',
    ]);
    expect(findNetworkIssues([vertex('v1')], [segment('s1', 'v1', 'v1')])).toEqual([
      'segment "s1" joins vertex "v1" to itself',
    ]);
  });

  it('reports two segments joining the same pair in either direction', () => {
    expect(
      findNetworkIssues(
        [vertex('v1'), vertex('v2')],
        [segment('s1', 'v1', 'v2'), segment('s2', 'v2', 'v1')],
      ),
    ).toEqual(['segment "s2" joins "v2" and "v1", which are already joined']);
  });
});

describe('pathObjectSchema', () => {
  it('accepts a curved segment with handle offsets and mirrored vertices', () => {
    const vertices = [
      { id: 'v1', x: 0, y: 0, mirror: 'both' },
      { id: 'v2', x: 100, y: 0, mirror: 'angle' },
    ] as const;
    const segments = [
      { id: 's1', a: 'v1', b: 'v2', ha: { x: 30, y: -40 }, hb: { x: -30, y: -40 } },
    ];
    expect(
      pathObjectSchema.safeParse(sampleObject('path', 'p', { vertices: [...vertices], segments }))
        .success,
    ).toBe(true);
  });

  it('rejects a malformed network, reporting it on the segments path', () => {
    const result = pathObjectSchema.safeParse(
      sampleObject('path', 'p', {
        vertices: [vertex('v1')],
        segments: [segment('s1', 'v1', 'v2')],
      }),
    );
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['segments']]);
  });
});
