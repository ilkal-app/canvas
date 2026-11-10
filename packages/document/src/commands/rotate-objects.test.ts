import { describe, expect, it } from 'vitest';

import {
  applyTransform,
  parentToBoardTransform,
  type BoardObject,
  type Point,
} from '@canvas/schema';

import {
  ADA,
  BOB,
  createFixtureStore,
  createSyncedPair,
  exchange,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
} from './__fixtures__/command-fixtures.js';
import { refusalsOn, storedBoardOf } from './__fixtures__/stored-board.js';
import { moveObjectsCommand } from './move-objects.js';
import { rotateObjectsCommand } from './rotate-objects.js';

/**
 * Where a point of an object's own frame is on the board.
 *
 * @param store - The store.
 * @param object - The object.
 * @param local - The point in the object's frame.
 * @returns The point in board coordinates.
 */
function boardPointOf(store: DocumentStore, object: BoardObject, local: Point): Point {
  const toParent = {
    x: object.x + Math.cos(object.rotation) * local.x - Math.sin(object.rotation) * local.y,
    y: object.y + Math.sin(object.rotation) * local.x + Math.cos(object.rotation) * local.y,
  };
  return applyTransform(parentToBoardTransform(store.read(), object), toParent);
}

describe('rotateObjects', () => {
  it('turns a root object about a board point, moving its origin round the pivot', () => {
    const store = createFixtureStore();
    const before = store.read();
    // The photo spans (900, -300)–(1300, 0); a quarter turn about its centre (1100, -150).
    const { result, changes } = applyCommand(store, rotateObjectsCommand, {
      rotations: [{ id: 'image-photo', by: Math.PI / 2, about: { x: 1100, y: -150 } }],
    });
    expect(result).toEqual({ rotatedIds: ['image-photo'] });
    expectDiff(before, store.read(), changes, { updated: ['image-photo'] });
    const photo = mustGet(store, 'image-photo');
    // The top-left corner goes to where a clockwise quarter turn about the centre puts it.
    expect(photo.x).toBeCloseTo(1250, 9);
    expect(photo.y).toBeCloseTo(-350, 9);
    expect(photo.rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(photo.updatedAt).toBe(NOW);
    expect(photo).toMatchObject({ width: 400, height: 300 });
  });

  it('keeps the pivot fixed on the board for an object inside a rotated group', () => {
    const store = createFixtureStore();
    const box = mustGet(store, 'shape-box');
    const centre = boardPointOf(store, box, { x: 80, y: 50 });
    applyCommand(store, rotateObjectsCommand, {
      rotations: [{ id: 'shape-box', by: 0.5, about: centre }],
    });
    const turned = mustGet(store, 'shape-box');
    const after = boardPointOf(store, turned, { x: 80, y: 50 });
    expect(after.x).toBeCloseTo(centre.x, 9);
    expect(after.y).toBeCloseTo(centre.y, 9);
    expect(turned.rotation).toBeCloseTo(box.rotation + 0.5, 12);
  });

  it('turns an object about its own origin when no pivot is given', () => {
    const store = createFixtureStore();
    applyCommand(store, rotateObjectsCommand, { rotations: [{ id: 'image-photo', by: -0.25 }] });
    expect(mustGet(store, 'image-photo')).toMatchObject({ x: 900, y: -300, rotation: -0.25 });
  });

  it('keeps the stored rotation within a half turn either way', () => {
    const store = createFixtureStore();
    applyCommand(store, rotateObjectsCommand, {
      rotations: [{ id: 'image-photo', by: 3 * Math.PI + 0.5 }],
    });
    expect(mustGet(store, 'image-photo').rotation).toBeCloseTo(-Math.PI + 0.5, 12);
    applyCommand(store, rotateObjectsCommand, {
      rotations: [{ id: 'image-photo', by: -Math.PI + 0.5 }],
    });
    // −π + 0.5 − π + 0.5 is −2π + 1, the same turn as 1.
    expect(mustGet(store, 'image-photo').rotation).toBeCloseTo(1, 12);
  });

  it('turns a group without rewriting its children, which turn with it', () => {
    const store = createFixtureStore();
    // A locked child locks its group's transform, so the fixture's star is unlocked.
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('shape-star'), { locked: false });
    });
    const before = store.read();
    const { changes } = applyCommand(store, rotateObjectsCommand, {
      rotations: [{ id: 'group-diagram', by: 0.25 }],
    });
    expectDiff(before, store.read(), changes, { updated: ['group-diagram'] });
    expect(mustGet(store, 'group-diagram')).toMatchObject({ x: 400, y: 120, rotation: 0.5 });
  });

  it('turns several objects about one pivot in one transaction', () => {
    const store = createFixtureStore();
    const before = store.read();
    const pivot = { x: 1000, y: 0 };
    const { changes } = applyCommand(store, rotateObjectsCommand, {
      rotations: [
        { id: 'image-photo', by: Math.PI, about: pivot },
        { id: 'video-demo', by: Math.PI, about: pivot },
      ],
    });
    expectDiff(before, store.read(), changes, { updated: ['image-photo', 'video-demo'] });
    expect(mustGet(store, 'image-photo').x).toBeCloseTo(1100, 9);
    expect(mustGet(store, 'image-photo').y).toBeCloseTo(300, 9);
    expect(mustGet(store, 'video-demo').x).toBeCloseTo(1100, 9);
    expect(mustGet(store, 'video-demo').y).toBeCloseTo(-100, 9);
  });

  it('rejects locked objects, objects turned with an ancestor, missing and repeated ids', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, rotateObjectsCommand, {
      rotations: [
        { id: 'shape-star', by: 1 },
        { id: 'group-diagram', by: 1 },
        { id: 'gone', by: 1 },
        { id: 'group-diagram', by: 2 },
      ],
    });
    expect(errors.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['missing-object', 'gone', ['rotations', 2]],
      ['duplicate-id', 'group-diagram', ['rotations', 3]],
      ['locked', 'shape-star', ['rotations', 0]],
      ['overlapping-selection', 'shape-star', ['rotations', 0]],
      // The group holds the locked star.
      ['locked', 'group-diagram', ['rotations', 1]],
    ]);
  });

  it('rejects an angle that is not a finite number', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, rotateObjectsCommand, {
      rotations: [{ id: 'image-photo', by: Number.POSITIVE_INFINITY }],
    });
    expect(errors).toEqual([expect.objectContaining({ code: 'invalid-input' })]);
  });

  it('rejects turning an object that hangs below a parent cycle', () => {
    const store = createFixtureStore();
    const group = fixtureObject('group-diagram', 'group');
    store.transact(BOB, (transaction) => {
      transaction.setObject({ ...group, id: id('loop-a'), parentId: id('loop-b') });
      transaction.setObject({ ...group, id: id('loop-b'), parentId: id('loop-a') });
      transaction.patchObject(id('image-photo'), { parentId: id('loop-a') });
    });
    expect(
      refusalsOn(storedBoardOf(store), rotateObjectsCommand, {
        rotations: [{ id: 'image-photo', by: 1 }],
      }),
    ).toEqual([expect.objectContaining({ code: 'parent-cycle', objectId: 'image-photo' })]);
  });

  it('converges when one client turns an object while another moves it', () => {
    const [ada, bob] = createSyncedPair();
    applyCommand(ada, rotateObjectsCommand, { rotations: [{ id: 'image-photo', by: 0.5 }] });
    applyCommand(
      bob,
      moveObjectsCommand,
      { moves: [{ id: 'video-demo', by: { x: 5, y: 5 } }] },
      BOB,
    );
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(ada.get(id('image-photo'))).toMatchObject({ rotation: 0.5 });
  });
});
