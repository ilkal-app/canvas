import { describe, expect, it } from 'vitest';

import {
  readStoredEntry,
  writeStoredEntriesRemotely,
} from '../store/__fixtures__/remote-values.js';
import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { B, expectInvalidInput, frameAt } from './__fixtures__/bound-fixtures.js';
import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { createObjectCommand } from './create-object.js';
import { createObjectsCommand } from './create-objects.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { groupCommand } from './group.js';
import { moveObjectsCommand } from './move-objects.js';
import { resizeObjectsCommand } from './resize-objects.js';
import { ungroupCommand } from './ungroup.js';

// THE BOUND IS ON WORLD GEOMETRY. Every extent of the box on the board of every object a
// command changes or carries ends with |after| <= max(B, |before|): a place past the bound may
// stay or move back in, never further out, continuously at the bound; and a far object can always
// be deleted and moved back inside.

/**
 * Stores an `x` on an object as a peer that skips validation would.
 *
 * @param store - The store.
 * @param objectId - The object.
 * @param x - The x to store.
 */
function placeAt(store: ReturnType<typeof createFixtureStore>, objectId: string, x: number): void {
  const placement = readStoredEntry(store, objectId, 'placement') as object;
  writeStoredEntriesRemotely(store, objectId, { placement: { ...placement, x } });
}

describe('a value past the bound may stay or move in, never further out (continuous at the bound)', () => {
  it('at B + 400: unchanged and inward are accepted, outward is refused, step by step', () => {
    const store = createFixtureStore();
    placeAt(store, 'comment-free', B + 400);
    const move = (x: number) => ({ moves: [{ id: 'comment-free', by: { x, y: 0 } }] });
    applyCommand(store, moveObjectsCommand, move(0));
    expectInvalidInput(store, moveObjectsCommand, move(1));
    applyCommand(store, moveObjectsCommand, move(-1));
    expect(mustGet(store, 'comment-free').x).toBe(B + 399);
    expectInvalidInput(store, moveObjectsCommand, move(1));
    applyCommand(store, moveObjectsCommand, move(-399));
    expect(mustGet(store, 'comment-free').x).toBe(B);
    // At the bound itself the rule is the same: one unit out is refused.
    expectInvalidInput(store, moveObjectsCommand, move(1));
    applyCommand(store, moveObjectsCommand, move(-1000));
    expect(mustGet(store, 'comment-free').x).toBe(B - 1000);
  });

  it('a move to a board position inside a frame that offsets it is judged by where it lands', () => {
    const store = createFixtureStore();
    // frame-plan sits at (-400, -300): the board point (B, 0) is (B + 400, 300) in its frame, and
    // the pin lands at B on the board, inside the bound; one unit further it would not.
    expectInvalidInput(store, moveObjectsCommand, {
      moves: [{ id: 'comment-free', to: { x: B + 1, y: 0 }, parentId: 'frame-plan' }],
    });
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'comment-free', to: { x: B, y: 0 }, parentId: 'frame-plan' }],
    });
    expect(mustGet(store, 'comment-free')).toMatchObject({ x: B + 400, y: 300 });
    // Repeated moves cannot walk an object out one bound at a time.
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'comment-free', to: { x: B, y: 0 } }],
    });
    expectInvalidInput(store, moveObjectsCommand, {
      moves: [{ id: 'comment-free', by: { x: B, y: 0 } }],
    });
  });

  it('a drag into a frame (a move by with a parent) that would carry it out is refused, inward is not', () => {
    const store = createFixtureStore();
    placeAt(store, 'comment-free', B - 1000);
    // frame-plan sits at (-400, -300): in its frame the object is 400 further along.
    expectInvalidInput(store, moveObjectsCommand, {
      moves: [{ id: 'comment-free', by: { x: 1300, y: 0 }, parentId: 'frame-plan' }],
    });
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'comment-free', by: { x: -200, y: 0 }, parentId: 'frame-plan' }],
    });
    expect(mustGet(store, 'comment-free')).toMatchObject({ parentId: 'frame-plan', x: B - 800 });
  });

  it('a resize by with an origin cannot grow a box past the bound step by step', () => {
    const store = createFixtureStore();
    applyCommand(store, createObjectCommand, {
      object: { ...frameAt(-B, -B), id: 'big', width: B, height: 10 },
    });
    const grow = (width: number) => ({
      resizes: [{ id: 'big', by: { width, height: 0 }, origin: { x: -B, y: -B } }],
    });
    // Its right edge may reach B, never one unit past it.
    expectInvalidInput(store, resizeObjectsCommand, grow(B + 1));
    applyCommand(store, resizeObjectsCommand, grow(B));
    expect(mustGet(store, 'big')).toMatchObject({ width: 2 * B });
    expectInvalidInput(store, resizeObjectsCommand, grow(1));
  });
});

describe('an honest person is never stuck under far objects', () => {
  it('deletes a far object, however far and with what attached', () => {
    const store = createFixtureStore();
    placeAt(store, 'sticky-idea', 1e308);
    placeAt(store, 'image-photo', 1e300);
    applyCommand(store, deleteObjectsCommand, { ids: ['sticky-idea', 'image-photo'] });
    expect(store.get('sticky-idea' as never)).toBeUndefined();
  });

  it('moves a far object back inside, and ungroups a group holding one', () => {
    const store = createFixtureStore();
    placeAt(store, 'video-demo', 1e300);
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'video-demo', to: { x: 10, y: 10 } }],
    });
    expect(mustGet(store, 'video-demo')).toMatchObject({ x: 10, y: 10 });
    placeAt(store, 'image-photo', 1e300);
    const { result } = applyCommand(store, groupCommand, { ids: ['image-photo', 'video-demo'] });
    applyCommand(store, ungroupCommand, { ids: [result.groupId] });
    expect(mustGet(store, 'video-demo').parentId).toBeNull();
  });
});

describe('createObjects judges a list by where its objects land', () => {
  const group = (x: number) => ({
    type: 'group' as const,
    id: 'g',
    x,
    y: 0,
  });
  const member = (id: string, x: number) => ({
    ...frameAt(x, 0),
    id,
    parentId: 'g',
    width: 0,
    height: 0,
  });

  it('takes a group of two frames B apart, whose member sits 2B from its group', () => {
    const store = createFixtureStore();
    applyCommand(store, createObjectsCommand, {
      objects: [group(-B + 50), member('a', 0), member('b', 2 * B - 100)],
    });
    const ids = [...store.read().objects.values()].filter(({ type }) => type === 'frame');
    expect(ids.some(({ x }) => x === 2 * B - 100)).toBe(true);
  });

  it('refuses the same list when its place is past the bound, naming the member', () => {
    const store = createFixtureStore();
    const errors = expectInvalidInput(store, createObjectsCommand, {
      objects: [group(-B + 200), member('a', 0), member('b', 2 * B - 100)],
    });
    // Only the member at B + 100 is past the bound, at both of its x extents.
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('minX, maxX');
  });

  it('refuses a hostile 1e300 in a member or at the top', () => {
    const store = createFixtureStore();
    expectInvalidInput(store, createObjectsCommand, { objects: [group(0), member('a', 1e300)] });
    expectInvalidInput(store, createObjectsCommand, { objects: [frameAt(1e300, 0)] });
  });
});
