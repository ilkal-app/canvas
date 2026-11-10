import { describe, expect, it } from 'vitest';

import { OBJECT_TYPES } from '@canvas/schema';

import { layoutOf } from '../codec/object-layout.js';
import { judgedKindOf } from '../meta/field-values.js';

import { fixtureObject } from './__fixtures__/store-fixtures.js';
import {
  DOOR_KINDS_BY_KEY,
  DOOR_KINDS_BY_NETWORK,
  findDoorIssues,
  findUnscalableSizeIssues,
} from './door-values.js';

describe('findDoorIssues', () => {
  it("judges each key the codec writes as the door's own table does", () => {
    for (const type of OBJECT_TYPES) {
      for (const codec of layoutOf(type)?.codecs ?? []) {
        if (codec.kind === 'network') {
          const member = { objectId: 'o', key: codec.key, memberId: 'm' };
          expect(DOOR_KINDS_BY_NETWORK.get(codec.key)).toBe(judgedKindOf(member));
          continue;
        }
        const keys = codec.kind === 'pair' ? codec.parts : 'key' in codec ? [codec.key] : [];
        for (const key of keys) {
          expect(DOOR_KINDS_BY_KEY.get(key)).toBe(judgedKindOf({ objectId: 'o', key }));
        }
      }
    }
  });

  it('refuses a new width past 2^32, naming it, and one the board already holds in a size it writes', () => {
    const shape = fixtureObject('shape-box', 'shape');
    const wide = { ...shape, width: 2 ** 33 };
    const issues = findDoorIssues(wide, shape);
    expect(issues.map(({ path }) => path)).toEqual([['width']]);
    expect(issues[0]?.message).toContain('past-extent');
    // A size is judged whole, so a write of the other dimension keeps no refused width
    // (the hub may have repaired it meanwhile); a write that leaves the size alone writes none.
    expect(findDoorIssues({ ...wide, height: 20 }, wide).map(({ path }) => path)).toEqual([
      ['width'],
    ]);
    expect(findDoorIssues({ ...wide, x: 5 }, wide)).toEqual([]);
    expect(findDoorIssues(wide, undefined)).toHaveLength(1);
  });

  it('names a stored size that is not finite, for a command that derives from it', () => {
    const shape = fixtureObject('shape-box', 'shape');
    expect(findUnscalableSizeIssues(shape)).toEqual([]);
    expect(findUnscalableSizeIssues({ ...shape, width: 2 ** 40 })).toEqual([]);
    expect(
      findUnscalableSizeIssues({ ...shape, height: Number.NaN }).map(({ path }) => path),
    ).toEqual([['height']]);
    expect(findUnscalableSizeIssues(fixtureObject('line-divider', 'line'))).toEqual([]);
  });

  it('refuses a new rotation past float32 and takes the placement group rewritten around one', () => {
    const shape = fixtureObject('shape-box', 'shape');
    const turned = { ...shape, rotation: 1e300 };
    expect(findDoorIssues(turned, shape)).toEqual([
      expect.objectContaining({ path: ['rotation'] }),
    ]);
    expect(findDoorIssues({ ...turned, x: 1 }, turned)).toEqual([]);
  });

  it('judges a line end and a path member the write changes, each on its own', () => {
    const line = fixtureObject('line-divider', 'line');
    const [start, end] = line.points;
    const far = { ...line, points: [start, { ...end, x: Number.POSITIVE_INFINITY }] };
    expect(findDoorIssues(far, line)).toEqual([
      expect.objectContaining({ path: ['points', 1, 'x'] }),
    ]);
    const path = fixtureObject('path-squiggle', 'path');
    const vertices = path.vertices.map((vertex, index) =>
      index === 1 ? { ...vertex, y: Number.NaN } : vertex,
    );
    expect(findDoorIssues({ ...path, vertices }, path)).toEqual([
      expect.objectContaining({ path: ['vertices', 1, 'y'] }),
    ]);
    expect(findDoorIssues({ ...path, vertices, x: 3 }, { ...path, vertices })).toEqual([]);
  });

  it("judges an image's crop and natural size in its style", () => {
    const image = fixtureObject('image-photo', 'image');
    const natural = { ...image, naturalSize: { width: 2 ** 33, height: 10 } };
    expect(findDoorIssues(natural, image)).toEqual([
      expect.objectContaining({ path: ['naturalSize', 'width'] }),
    ]);
    expect(findDoorIssues({ ...natural, opacity: 0.5 }, natural)).toEqual([]);
  });

  it('judges nothing of a type it does not know, or a network that is not a list', () => {
    expect(findDoorIssues({ id: 'x', type: 'blob' }, undefined)).toEqual([]);
    const path = fixtureObject('path-squiggle', 'path');
    expect(findDoorIssues({ ...path, vertices: 'none' }, path)).toEqual([]);
  });
});
