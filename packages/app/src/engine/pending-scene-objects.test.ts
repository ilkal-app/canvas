import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { PendingSceneObjects } from './pending-scene-objects.js';

const id = (value: string): ObjectId => value as ObjectId;
// frame ⊃ group ⊃ leaf; loose at the root; drawn by a cached preview: loose.
const PARENTS = new Map<ObjectId, ObjectId | null>([
  [id('frame'), null],
  [id('group'), id('frame')],
  [id('leaf'), id('group')],
  [id('loose'), null],
]);
const parentOf = (child: ObjectId): ObjectId | null => PARENTS.get(child) ?? null;

/**
 * Owes the four objects, `loose` drawn by a cached preview.
 *
 * @returns What is owed.
 */
function owed(): PendingSceneObjects {
  return new PendingSceneObjects(PARENTS.keys(), new Set([id('loose')]));
}

describe('PendingSceneObjects', () => {
  it('takes an object with its owed ancestors, root first, once', () => {
    const pending = owed();
    expect(pending.take([id('leaf')], parentOf)).toEqual({
      created: [id('frame'), id('group'), id('leaf')],
      updated: [],
    });
    expect(pending.take([id('leaf'), id('unknown')], parentOf)).toEqual({
      created: [],
      updated: [],
    });
    expect(pending.size).toBe(1);
  });

  it('takes the next objects in document order, a preview-drawn one as updated', () => {
    const pending = owed();
    expect(pending.takeNext(1, parentOf)).toEqual({ created: [id('frame')], updated: [] });
    expect(pending.takeNext(5, parentOf)).toEqual({
      created: [id('group'), id('leaf')],
      updated: [id('loose')],
    });
    expect(pending.size).toBe(0);
  });

  it('routes a change: owed objects go as owed, with ancestors; others pass through', () => {
    const pending = owed();
    const routed = pending.route(
      { created: [id('new')], updated: [id('leaf'), id('sent')], deleted: [] },
      parentOf,
    );
    expect(routed).toEqual({
      created: [id('new'), id('frame'), id('group'), id('leaf')],
      updated: [id('sent')],
      deleted: [],
    });
    expect(pending.size).toBe(1);
  });

  it('deletes an owed object from the renderer only if a cached preview drew it', () => {
    const pending = owed();
    expect(
      pending.route(
        { created: [], updated: [], deleted: [id('leaf'), id('loose'), id('gone')] },
        parentOf,
      ),
    ).toEqual({ created: [], updated: [], deleted: [id('loose'), id('gone')] });
    expect(pending.takeNext(5, parentOf)).toEqual({
      created: [id('frame'), id('group')],
      updated: [],
    });
  });

  it('puts the given owed objects first, in document order, and counts them', () => {
    const pending = owed();
    expect(pending.prioritize([id('loose'), id('group'), id('unknown')])).toBe(2);
    expect(pending.takeNext(1, parentOf)).toEqual({
      created: [id('frame'), id('group')],
      updated: [],
    });
    expect(pending.takeNext(1, parentOf)).toEqual({ created: [], updated: [id('loose')] });
    expect(pending.takeNext(1, parentOf)).toEqual({ created: [id('leaf')], updated: [] });
  });

  it('sends the owed ancestors of a new or reparented object ahead of it', () => {
    const pending = owed();
    const parents = new Map(PARENTS);
    parents.set(id('kid'), id('group'));
    parents.set(id('moved'), id('loose'));
    const routed = pending.route(
      { created: [id('kid')], updated: [id('moved')], deleted: [] },
      (child) => parents.get(child) ?? null,
    );
    expect(routed).toEqual({
      created: [id('frame'), id('group'), id('kid')],
      updated: [id('loose'), id('moved')],
      deleted: [],
    });
  });

  it('stops at a parent cycle', () => {
    const pending = new PendingSceneObjects([id('a'), id('b')], new Set());
    const cycle = new Map([
      [id('a'), id('b')],
      [id('b'), id('a')],
    ]);
    expect(pending.take([id('a')], (child) => cycle.get(child) ?? null)).toEqual({
      created: [id('b'), id('a')],
      updated: [],
    });
  });
});
