import { describe, expect, it } from 'vitest';

import { BOARD_BOUND, type BoardObject, type ObjectId } from '@canvas/schema';

import { fixtureObject } from '../store/__fixtures__/store-fixtures.js';

import type { BoxSource } from './box-source.js';
import { isFarObject } from './far-object.js';

const B = BOARD_BOUND;

/**
 * A board of objects as a box source.
 *
 * @param objects - The objects.
 * @returns The source.
 */
function sourceOf(objects: readonly BoardObject[]): BoxSource {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return {
    get: (key) => byId.get(key),
    childrenOf: (key) => objects.filter(({ parentId }) => parentId === key).map(({ id }) => id),
  };
}

/**
 * An object of the fixture board, placed.
 *
 * @param id - Its id.
 * @param parentId - Its parent.
 * @param fields - Its placement and size.
 * @returns The object.
 */
function shape(id: string, parentId: string | null, fields: Record<string, number>): BoardObject {
  return {
    ...fixtureObject('shape-box', 'shape'),
    id: id as ObjectId,
    parentId: parentId as ObjectId | null,
    rotation: 0,
    ...fields,
  };
}

/**
 * A group, placed.
 *
 * @param id - Its id.
 * @param x - Its x.
 * @param parentId - Its parent.
 * @returns The group.
 */
function group(id: string, x: number, parentId: string | null = null): BoardObject {
  return {
    ...fixtureObject('group-diagram', 'group'),
    id: id as ObjectId,
    parentId: parentId as ObjectId | null,
    x,
    y: 0,
    rotation: 0,
  };
}

describe('isFarObject: by where the object is on the board, never by what it stores', () => {
  it('is false for a member stored 2B from its group inside the bound, true one unit past it', () => {
    const source = sourceOf([
      group('g', -B),
      shape('in', 'g', { x: 2 * B, y: 0, width: 0, height: 0 }),
      shape('out', 'g', { x: 2 * B + 1, y: 0, width: 0, height: 0 }),
    ]);
    expect(isFarObject(source, 'in' as ObjectId)).toBe(false);
    expect(isFarObject(source, 'out' as ObjectId)).toBe(true);
  });

  it('is true for a group whose descendant is far, and for an object under a group that cannot be placed', () => {
    const source = sourceOf([
      group('outer', 0),
      group('inner', 0, 'outer'),
      shape('deep', 'inner', { x: B - 5, y: 0, width: 10, height: 1 }),
      group('broken', Number.NaN),
      shape('under', 'broken', { x: 0, y: 0, width: 1, height: 1 }),
      { ...group('cycle-a', 0), parentId: 'cycle-b' as ObjectId },
      { ...group('cycle-b', 0), parentId: 'cycle-a' as ObjectId },
    ]);
    for (const name of ['outer', 'inner', 'deep', 'broken', 'under', 'cycle-a']) {
      expect(isFarObject(source, name as ObjectId), name).toBe(true);
    }
  });

  it('is false for an object that is not on the board', () => {
    expect(isFarObject(sourceOf([]), 'nowhere' as ObjectId)).toBe(false);
  });
});
