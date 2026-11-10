import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { fixtureObject, id } from '../store/__fixtures__/store-fixtures.js';

import { LastKnownObjects } from './last-known-objects.js';

const GROUP = fixtureObject('group-diagram', 'group');
const SHAPE = fixtureObject('shape-box', 'shape');

/**
 * A copy of the fixture shape under another id and parent.
 *
 * @param objectId - The id.
 * @param parentId - The parent, or `null`.
 * @returns The object.
 */
function shape(objectId: string, parentId: string | null): BoardObject {
  return { ...SHAPE, id: id(objectId), parentId: parentId === null ? null : id(parentId) };
}

describe('LastKnownObjects', () => {
  it('remembers removed objects until they come back', () => {
    const lastKnown = new LastKnownObjects();
    lastKnown.recordRemoved([GROUP]);
    expect(lastKnown.get(GROUP.id)).toBe(GROUP);
    lastKnown.forget(GROUP.id);
    expect(lastKnown.get(GROUP.id)).toBeUndefined();
    expect(lastKnown.size).toBe(0);
  });

  it('keeps only the newest objects beyond its capacity', () => {
    const lastKnown = new LastKnownObjects(2);
    lastKnown.recordRemoved([shape('a', null), shape('b', null)]);
    lastKnown.recordRemoved([shape('c', null)]);
    expect(lastKnown.get(id('a'))).toBeUndefined();
    expect(lastKnown.get(id('b'))).toBeDefined();
    expect(lastKnown.get(id('c'))).toBeDefined();
    expect(lastKnown.size).toBe(2);
  });

  it('counts a re-recorded object as new, so it outlives older ones', () => {
    const lastKnown = new LastKnownObjects(2);
    lastKnown.recordRemoved([shape('a', null), shape('b', null)]);
    lastKnown.recordRemoved([shape('a', null)]);
    lastKnown.recordRemoved([shape('c', null)]);
    expect(lastKnown.get(id('a'))).toBeDefined();
    expect(lastKnown.get(id('b'))).toBeUndefined();
  });

  it('lists as children only the objects removed together with their parent', () => {
    const lastKnown = new LastKnownObjects();
    lastKnown.recordRemoved([shape('earlier', 'g')]);
    lastKnown.recordRemoved([{ ...GROUP, id: id('g') }, shape('with-g', 'g')]);
    expect([...lastKnown.childrenOf(id('g'))]).toEqual([id('with-g')]);
    expect([...lastKnown.childrenOf(id('unknown'))]).toEqual([]);
  });

  it('drops an evicted or forgotten child from its parent', () => {
    const lastKnown = new LastKnownObjects(3);
    lastKnown.recordRemoved([{ ...GROUP, id: id('g') }, shape('one', 'g'), shape('two', 'g')]);
    lastKnown.forget(id('one'));
    expect([...lastKnown.childrenOf(id('g'))]).toEqual([id('two')]);
    lastKnown.recordRemoved([shape('x', null), shape('y', null)]);
    expect(lastKnown.get(id('g'))).toBeUndefined();
    expect([...lastKnown.childrenOf(id('g'))]).toEqual([]);
  });

  it('refuses a capacity that is not a positive integer', () => {
    expect(() => new LastKnownObjects(0)).toThrow(RangeError);
    expect(() => new LastKnownObjects(1.5)).toThrow(RangeError);
  });
});
