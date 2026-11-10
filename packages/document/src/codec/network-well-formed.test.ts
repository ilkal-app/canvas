// One definition of a well-formed vector network, shared by the reader (which
// hides the members it names and reports them in `read().issues`) and the sync fuzz (which fails
// a decoded path it does not accept).
import { describe, expect, it } from 'vitest';

import { findNetworkIssues, type Segment, type Vertex } from '@canvas/schema';

import { hiddenMembersOf, visibleNetwork } from './network-visibility.js';
import { findNetworkMemberIssues, type StoredNetwork } from './network-well-formed.js';

const ZERO = { x: 0, y: 0 };
const V1: Vertex = { id: 'v1', x: 0, y: 0, mirror: 'none' };
const V2: Vertex = { id: 'v2', x: 100, y: 0, mirror: 'none' };
const V3: Vertex = { id: 'v3', x: 200, y: 50, mirror: 'none' };
const S1: Segment = { id: 's1', a: 'v1', b: 'v2', ha: ZERO, hb: ZERO };
const S2: Segment = { id: 's2', a: 'v2', b: 'v3', ha: ZERO, hb: ZERO };

describe('findNetworkMemberIssues', () => {
  it('finds nothing in a well-formed network, or in one with no segment', () => {
    expect(findNetworkMemberIssues({ vertices: [V1, V2, V3], segments: [S1, S2] })).toEqual([]);
    expect(findNetworkMemberIssues({ vertices: [V1, V2], segments: [] })).toEqual([]);
    expect(findNetworkMemberIssues({ vertices: [], segments: [] })).toEqual([]);
  });

  it('names a segment ending at a missing vertex, and the vertex', () => {
    expect(findNetworkMemberIssues({ vertices: [V1, V2], segments: [S1, S2] })).toEqual([
      {
        list: 'segments',
        id: 's2',
        problem: 'missing-vertex',
        relatedId: 'v3',
        message: 'segment "s2" ends at missing vertex "v3"',
      },
    ]);
  });

  it('names a segment joining a vertex to itself', () => {
    const loop = { ...S1, id: 's0', b: 'v1' };
    expect(findNetworkMemberIssues({ vertices: [V1, V2], segments: [loop, S1] })).toEqual([
      {
        list: 'segments',
        id: 's0',
        problem: 'joins-itself',
        relatedId: 'v1',
        message: 'segment "s0" joins vertex "v1" to itself',
      },
    ]);
  });

  it('names every segment but the lowest id of those joining one pair, in either direction', () => {
    const later = { ...S2, id: 'z', a: 'v3', b: 'v2' };
    const earlier = { ...S2, id: 'b' };
    const network = { vertices: [V1, V2, V3], segments: [later, S1, earlier] };
    expect(findNetworkMemberIssues(network)).toEqual([
      {
        list: 'segments',
        id: 'z',
        problem: 'duplicate-pair',
        relatedId: 'b',
        message: 'segment "z" joins "v3" and "v2", which segment "b" already joins',
      },
    ]);
  });

  it('names a vertex on no shown segment once the network shows a segment', () => {
    const stray = { ...V3, id: 'v9' };
    expect(findNetworkMemberIssues({ vertices: [V1, stray, V2], segments: [S1] })).toEqual([
      {
        list: 'vertices',
        id: 'v9',
        problem: 'stray-vertex',
        relatedId: null,
        message: 'vertex "v9" is on no segment',
      },
    ]);
    // v3's only segment is hidden, so v3 is stray too.
    expect(
      findNetworkMemberIssues({ vertices: [V1, V2, V3], segments: [S1, { ...S2, b: 'gone' }] }),
    ).toMatchObject([
      { list: 'segments', id: 's2', problem: 'missing-vertex' },
      { list: 'vertices', id: 'v3', problem: 'stray-vertex' },
    ]);
  });

  it('names no vertex when every segment is hidden, as a read then keeps them all', () => {
    const network = { vertices: [V1, V2], segments: [{ ...S1, b: 'gone' }, S2] };
    expect(findNetworkMemberIssues(network).map(({ list, id }) => `${list}:${id}`)).toEqual([
      'segments:s1',
      'segments:s2',
    ]);
    expect(visibleNetwork(network).vertices).toEqual([V1, V2]);
  });

  it('lists segments then vertices, each by id, whatever the stored order', () => {
    const network = {
      vertices: [V3, { ...V1, id: 'v8' }, V1, V2, { ...V1, id: 'v7' }],
      segments: [{ ...S2, id: 's9', b: 'x' }, S1, { ...S1, id: 's3', a: 'y' }],
    };
    const reversed = {
      vertices: [...network.vertices].reverse(),
      segments: [...network.segments].reverse(),
    };
    const ids = findNetworkMemberIssues(network).map(({ list, id }) => `${list}:${id}`);
    expect(ids).toEqual([
      'segments:s3',
      'segments:s9',
      'vertices:v3',
      'vertices:v7',
      'vertices:v8',
    ]);
    expect(findNetworkMemberIssues(reversed)).toEqual(findNetworkMemberIssues(network));
  });
});

/**
 * A seeded source of numbers in [0, 1) (mulberry32), so every run draws the same networks.
 *
 * @param seed - The seed.
 * @returns The next number, per call.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A random network as a merge could leave it: segments between random ids, some of which name
 * no vertex, some loops and some pairs joined twice.
 *
 * @param random - The random source.
 * @returns The network.
 */
function randomNetwork(random: () => number): StoredNetwork {
  const pick = (count: number) => `v${String(Math.floor(random() * count))}`;
  const vertexCount = Math.floor(random() * 6);
  const vertices = [...Array(vertexCount).keys()].map((index) => ({
    ...V1,
    id: `v${String(index)}`,
  }));
  const segments = [...Array(Math.floor(random() * 8)).keys()].map((index) => ({
    ...S1,
    id: `s${String(index)}`,
    a: pick(vertexCount + 2),
    b: pick(vertexCount + 2),
  }));
  return { vertices, segments };
}

describe('the one definition', () => {
  it('names exactly the members a read hides, and what a read shows is well formed', () => {
    const random = seededRandom(198);
    for (let run = 0; run < 500; run += 1) {
      const network = randomNetwork(random);
      const issues = findNetworkMemberIssues(network);
      const hidden = hiddenMembersOf(network);
      const named = (list: 'vertices' | 'segments') =>
        issues.filter((issue) => issue.list === list).map(({ id }) => id);
      expect(named('vertices').sort(), JSON.stringify(network)).toEqual(
        [...hidden.vertices].sort(),
      );
      expect(named('segments').sort(), JSON.stringify(network)).toEqual(
        [...hidden.segments].sort(),
      );
      const visible = visibleNetwork(network);
      expect(findNetworkMemberIssues(visible)).toEqual([]);
      expect(
        findNetworkIssues(visible.vertices as Vertex[], visible.segments as Segment[]),
      ).toEqual([]);
    }
  });
});
