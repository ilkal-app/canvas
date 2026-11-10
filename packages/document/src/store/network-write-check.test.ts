import { describe, expect, it } from 'vitest';

import { fixtureObject } from './__fixtures__/store-fixtures.js';
import { checkNetworkWrite } from './network-write-check.js';

const path = fixtureObject('path-squiggle', 'path');
const [v1, v2, v3] = path.vertices;
const [s1, s2] = path.segments;

/**
 * The messages of a network write's issues, by path.
 *
 * @param written - The network as written.
 * @param stored - The network as stored.
 * @returns `path: message` lines.
 */
function issuesOf(
  written: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>> = path,
): string[] {
  return checkNetworkWrite(written, stored).issues.map(
    ({ path: at, message }) => `${at.join('.')}: ${message}`,
  );
}

describe('checkNetworkWrite: the members a write changes, and the rules they take part in', () => {
  it('parses only the changed members and keeps the stored ones as stored', () => {
    const moved = { ...v2, x: 120 } as typeof v2;
    const written = { vertices: [v1, moved, v3], segments: path.segments };
    const checked = checkNetworkWrite(written, path);
    expect(checked.issues).toEqual([]);
    const [first, second] = checked.values.vertices as readonly unknown[];
    expect(first).toBe(v1);
    expect(second).toEqual(moved);
    expect(second).not.toBe(moved);
  });

  it('does not judge a stored member a peer left invalid, and judges it once changed', () => {
    const invalid = { ...v1, x: 'left' };
    const stored = { vertices: [invalid, v2, v3], segments: path.segments };
    expect(issuesOf({ ...stored, vertices: [invalid, { ...v2, x: 120 }, v3] }, stored)).toEqual([]);
    expect(issuesOf({ ...stored, vertices: [{ ...invalid, x: 'right' }, v2, v3] }, stored)).toEqual(
      ['vertices.0.x: Invalid input: expected number, received string'],
    );
  });

  it('refuses a deleted vertex that a segment still ends at, and a new segment to nowhere', () => {
    expect(issuesOf({ vertices: [v1, v2], segments: path.segments })).toEqual([
      'segments.1: segment "s2" ends at missing vertex "v3"',
    ]);
    const stray = { ...s1, id: 's9', a: 'v1', b: 'v7' };
    expect(issuesOf({ vertices: path.vertices, segments: [s1, s2, stray] })).toEqual([
      'segments.2: segment "s9" ends at missing vertex "v7"',
    ]);
  });

  it('refuses a changed member whose id is taken, a vertex joined to itself and a pair joined twice', () => {
    expect(issuesOf({ vertices: [v1, v2, v3, { ...v1, x: 5 }], segments: path.segments })).toEqual([
      'vertices.3: vertex id "v1" is used twice',
    ]);
    const loop = { ...s1, id: 's8', a: 'v3', b: 'v3' };
    const twin = { ...s1, id: 's9', a: 'v2', b: 'v1' };
    expect(issuesOf({ vertices: path.vertices, segments: [s1, s2, loop, twin] })).toEqual([
      'segments.2: segment "s8" joins vertex "v3" to itself',
      'segments.3: segment "s9" joins "v2" and "v1", which are already joined',
    ]);
  });

  it('refuses a network that is not a list, and members that are not records or lack an id', () => {
    expect(issuesOf({ vertices: 'none', segments: path.segments })).toEqual([
      'vertices: vertices must be a list of members',
    ]);
    expect(issuesOf({ vertices: [v1, v2, v3, 5], segments: path.segments })).toEqual([
      'vertices.3: Invalid input: expected object, received number',
    ]);
    expect(issuesOf({ vertices: [v1, v2, { ...v3, id: 3 }], segments: path.segments })).toEqual([
      'vertices.2.id: Invalid input: expected string, received number',
    ]);
  });

  it('judges every member against a stored object that holds no network, and a repeated segment id', () => {
    expect(issuesOf({ vertices: path.vertices, segments: path.segments }, {})).toEqual([]);
    const again = { ...s2, a: 'v1', b: 'v3' };
    expect(issuesOf({ vertices: path.vertices, segments: [s1, s2, again] })).toEqual([
      'segments.2: segment id "s2" is used twice',
    ]);
  });
});
