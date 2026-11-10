import { describe, expect, it } from 'vitest';

import { isValidKey, MAX_KEY_LENGTH, type BoardObject, type ObjectId } from '@canvas/schema';

import type { BoardReader } from '../commands/command.js';
import { normalizeAngle } from '../commands/normalize-angle.js';
import { fixtureObject, id } from '../store/__fixtures__/store-fixtures.js';

import { placeOnTop, reroot } from './orphan-placement.js';

const SHAPE = fixtureObject('shape-box', 'shape');

/**
 * A board with one root child whose key is given, as `placeOnTop` reads it.
 *
 * @param topKey - The key of the root's top child.
 * @returns The reader.
 */
function rootTopped(topKey: string): BoardReader {
  const top: BoardObject = { ...SHAPE, id: id('top'), parentId: null, z: topKey };
  const none: ReadonlySet<ObjectId> = new Set();
  return {
    get: (objectId) => (objectId === top.id ? top : undefined),
    references: {
      childrenOf: () => new Set([top.id]),
      topChildOf: (parentId) => (parentId === null ? top.id : undefined),
      connectorsAttachedTo: () => none,
      instancesOf: () => new Set<ObjectId>(),
      commentsAnchoredTo: () => none,
    },
  };
}

/** Two shapes just moved from a removed group to the root. */
const MOVED: BoardObject[] = ['moved-a', 'moved-b'].map((objectId, index) => ({
  ...SHAPE,
  id: id(objectId),
  parentId: null,
  z: index === 0 ? 'a1' : 'a0',
}));

/** Where they were before. */
const FROM_GROUP = new Map(MOVED.map(({ id: objectId }) => [objectId, id('gone')]));

describe('placeOnTop', () => {
  it('keys moved objects above the top child, keeping their order by z', () => {
    const [first, second] = placeOnTop(MOVED, FROM_GROUP, rootTopped('a5'));
    expect(first?.id).toBe('moved-a');
    // moved-b (z a0) was below moved-a (z a1), so it gets the lower new key.
    expect(second !== undefined && first !== undefined && 'a5' < second.z).toBe(true);
    expect(second !== undefined && first !== undefined && second.z < first.z).toBe(true);
  });

  it('leaves an object whose parent did not change as it is', () => {
    const kept = new Map(MOVED.map(({ id: objectId }) => [objectId, null]));
    expect(placeOnTop(MOVED, kept, rootTopped('a5'))).toEqual(MOVED);
  });

  it('keeps the keys when the top key is not a fractional-index key', () => {
    expect(placeOnTop(MOVED, FROM_GROUP, rootTopped('legacy'))).toEqual(MOVED);
  });

  it('keeps the keys when keys above the top would be too long', () => {
    const longest = 'z'.repeat(MAX_KEY_LENGTH);
    expect(isValidKey(longest)).toBe(true);
    expect(placeOnTop(MOVED, FROM_GROUP, rootTopped(longest))).toEqual(MOVED);
  });
});

describe('reroot', () => {
  it('keeps an object whose parent is present', () => {
    const object = { ...SHAPE, parentId: id('here') };
    expect(reroot(object, rootTopped('a0'), () => true)).toBe(object);
  });

  it('roots an object whose remembered ancestors loop, keeping its coordinates', () => {
    const loopA = { ...fixtureObject('group-diagram', 'group'), id: id('a'), parentId: id('b') };
    const loopB = { ...loopA, id: id('b'), parentId: id('a'), x: 0, y: 0, rotation: 0 };
    const reader: BoardReader = {
      ...rootTopped('a0'),
      get: (objectId) => (objectId === 'a' ? loopA : objectId === 'b' ? loopB : undefined),
    };
    const object = { ...SHAPE, parentId: id('a') };
    const moved = reroot(object, reader, () => false);
    expect(moved.parentId).toBeNull();
    expect(moved.rotation).toBeCloseTo(SHAPE.rotation + loopA.rotation);
  });

  it('wraps a composed rotation past the angle limit, as every write and copy judges it', () => {
    // A removed group whose rotation a peer left at 2^31 rooted its members at 2^31,
    // past the ±2^30 every way in holds a rotation to (`angleSchema`), so a copy of their page
    // was refused, naming rotations no write had reached. Within the limit the sum stays exact.
    const group = {
      ...fixtureObject('group-diagram', 'group'),
      id: id('gone'),
      parentId: null,
      x: 0,
      y: 0,
      rotation: 2 ** 31,
    };
    const reader: BoardReader = {
      ...rootTopped('a0'),
      get: (objectId) => (objectId === 'gone' ? group : undefined),
    };
    const member = { ...SHAPE, parentId: id('gone'), rotation: 0.5 };
    const moved = reroot(member, reader, () => false);
    expect(Math.abs(moved.rotation)).toBeLessThanOrEqual(Math.PI);
    expect(moved.rotation).toBe(normalizeAngle(2 ** 31 + 0.5));
    const near = reroot(
      member,
      {
        ...reader,
        get: (objectId) => (objectId === 'gone' ? { ...group, rotation: 2 ** 29 } : undefined),
      },
      () => false,
    );
    expect(near.rotation).toBe(2 ** 29 + 0.5);
  });
});
