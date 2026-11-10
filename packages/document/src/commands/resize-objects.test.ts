import { describe, expect, it } from 'vitest';

import { applyTransform, parentToBoardTransform } from '@canvas/schema';

import {
  ADA,
  BOB,
  createFixtureStore,
  createSyncedPair,
  exchange,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
} from './__fixtures__/command-fixtures.js';
import { createGroupedStore } from './__fixtures__/grouped-board.js';
import { refusalsOn, storedBoardOf } from './__fixtures__/stored-board.js';
import { moveObjectsCommand } from './move-objects.js';
import { resizeObjectsCommand } from './resize-objects.js';

describe('resizeObjects', () => {
  it('sets a size or changes it by a delta, stamping only the resized objects', () => {
    const store = createFixtureStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, resizeObjectsCommand, {
      resizes: [
        { id: 'image-photo', to: { width: 500, height: 400 } },
        { id: 'sticky-idea', by: { width: 10, height: -20 } },
      ],
    });
    expect(result).toEqual({ resizedIds: ['image-photo', 'sticky-idea'] });
    expectDiff(before, store.read(), changes, { updated: ['image-photo', 'sticky-idea'] });
    expect(mustGet(store, 'image-photo')).toEqual({
      ...fixtureObject('image-photo', 'image'),
      width: 500,
      height: 400,
      updatedAt: NOW,
    });
    expect(mustGet(store, 'sticky-idea')).toMatchObject({ width: 210, height: 180, x: 40 });
  });

  it('moves the origin too when resizing from a top or left handle, leaving children alone', () => {
    const store = createFixtureStore();
    const before = store.read();
    const { changes } = applyCommand(store, resizeObjectsCommand, {
      resizes: [
        { id: 'frame-plan', to: { width: 1300, height: 1000 }, origin: { x: -500, y: -400 } },
        { id: 'text-title', by: { width: 10, height: 0 } },
      ],
    });
    expectDiff(before, store.read(), changes, { updated: ['frame-plan', 'text-title'] });
    expect(mustGet(store, 'frame-plan')).toMatchObject({ x: -500, y: -400, width: 1300 });
    expect(mustGet(store, 'text-title')).toMatchObject({ x: 40, y: 40, width: 330 });
  });

  it('places the origin in board coordinates inside a rotated group', () => {
    const store = createFixtureStore();
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'shape-box', to: { width: 10, height: 10 }, origin: { x: 20, y: 30 } }],
    });
    const box = mustGet(store, 'shape-box');
    const origin = applyTransform(parentToBoardTransform(store.read(), box), box);
    expect(origin.x).toBeCloseTo(20, 9);
    expect(origin.y).toBeCloseTo(30, 9);
  });

  it('rejects objects without a stored size, locked objects and negative sizes', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, resizeObjectsCommand, {
      resizes: [
        { id: 'group-diagram', to: { width: 1, height: 1 } },
        { id: 'line-divider', by: { width: 1, height: 1 } },
        { id: 'shape-star', to: { width: 1, height: 1 } },
        { id: 'image-photo', by: { width: -401, height: 0 } },
      ],
    });
    expect(errors.map((error) => [error.code, error.objectId, error.path])).toEqual([
      // The group holds the locked shape-star: a locked child locks the group's transform.
      ['locked', 'group-diagram', ['resizes', 0]],
      ['unsupported-type', 'line-divider', ['resizes', 1]],
      ['locked', 'shape-star', ['resizes', 2]],
      ['overlapping-selection', 'shape-star', ['resizes', 2]],
      ['invalid-object', 'image-photo', ['width']],
    ]);
  });

  it('resizes a group by rewriting its descendants, one change set, naming only the group', () => {
    const store = createGroupedStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'group-outer', by: { width: 50, height: 0 }, origin: { x: 90, y: 60 } }],
    });
    expect(result).toEqual({ resizedIds: ['group-outer'] });
    expectDiff(before, store.read(), changes, {
      updated: [
        'group-inner',
        'group-outer',
        'line-l',
        'line-m',
        'path-p',
        'rect-a',
        'rect-b',
        'rect-c',
      ],
    });
    // The derived box starts at the group's origin, so the corner is the group's new origin.
    expect(mustGet(store, 'group-outer')).toMatchObject({ x: 90, y: 60, rotation: 0.4 });
    expect(mustGet(store, 'rect-free')).toEqual(before.objects.get(id('rect-free')));
  });

  it('rejects a group holding a locked object, a child listed with its group, a negative size', () => {
    const store = createGroupedStore();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('rect-c'), { locked: true });
    });
    const errors = expectRejected(store, resizeObjectsCommand, {
      resizes: [
        { id: 'group-inner', to: { width: 10, height: 10 } },
        { id: 'rect-a', to: { width: 10, height: 10 } },
        { id: 'group-outer', to: { width: 10, height: 10 } },
      ],
    });
    expect(errors.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['locked', 'group-inner', ['resizes', 0]],
      ['overlapping-selection', 'group-inner', ['resizes', 0]],
      ['overlapping-selection', 'rect-a', ['resizes', 1]],
      ['locked', 'group-outer', ['resizes', 2]],
    ]);
    const shrink = expectRejected(createGroupedStore(), resizeObjectsCommand, {
      resizes: [{ id: 'group-inner', by: { width: -1000, height: 0 } }],
    });
    expect(shrink.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['invalid-input', 'group-inner', ['resizes', 0, 'by']],
    ]);
    const collapse = expectRejected(createGroupedStore(), resizeObjectsCommand, {
      resizes: [{ id: 'group-inner', to: { width: 0, height: 10 } }],
    });
    expect(collapse.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['invalid-input', 'group-inner', ['resizes', 0, 'to']],
    ]);
    // A group whose box has no width cannot grow one, but its height still scales.
    const flat = createGroupedStore();
    const rect = mustGet(flat, 'rect-free');
    if (rect.type !== 'shape') throw new Error('rect-free is a shape');
    flat.transact(ADA, (transaction) => {
      transaction.setObject({
        ...mustGet(flat, 'group-inner'),
        id: id('group-flat'),
        parentId: null,
      });
      transaction.setObject({ ...rect, id: id('rect-flat'), parentId: id('group-flat'), width: 0 });
    });
    const grow = expectRejected(flat, resizeObjectsCommand, {
      resizes: [{ id: 'group-flat', to: { width: 10, height: 30 } }],
    });
    expect(grow.map((error) => error.code)).toEqual(['invalid-input']);
    applyCommand(flat, resizeObjectsCommand, {
      resizes: [{ id: 'group-flat', to: { width: 0, height: 60 } }],
    });
    expect(mustGet(flat, 'rect-flat')).toMatchObject({ width: 0, height: 60 });
  });

  it('rejects moving the origins of an object and of its ancestor together', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, resizeObjectsCommand, {
      resizes: [
        { id: 'frame-plan', by: { width: 0, height: 0 }, origin: { x: 0, y: 0 } },
        { id: 'sticky-idea', by: { width: 0, height: 0 }, origin: { x: 0, y: 0 } },
      ],
    });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'overlapping-selection', objectId: 'sticky-idea' }),
    ]);
  });

  it('rejects an origin below a parent cycle', () => {
    const store = createFixtureStore();
    const group = fixtureObject('group-diagram', 'group');
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...group, id: id('loop-a'), parentId: id('loop-b') });
      transaction.setObject({ ...group, id: id('loop-b'), parentId: id('loop-a') });
      transaction.patchObject(id('image-photo'), { parentId: id('loop-a') });
    });
    const errors = refusalsOn(storedBoardOf(store), resizeObjectsCommand, {
      resizes: [{ id: 'image-photo', by: { width: 1, height: 1 }, origin: { x: 0, y: 0 } }],
    });
    expect(errors).toEqual([expect.objectContaining({ code: 'parent-cycle' })]);
  });

  it('converges when one client resizes an object while another moves it', () => {
    const [ada, bob] = createSyncedPair();
    applyCommand(ada, resizeObjectsCommand, {
      resizes: [{ id: 'video-demo', to: { width: 320, height: 180 } }],
    });
    applyCommand(
      bob,
      moveObjectsCommand,
      { moves: [{ id: 'video-demo', by: { x: -100, y: 0 } }] },
      BOB,
    );
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(ada.get(id('video-demo'))).toMatchObject({ x: 800, width: 320, height: 180 });
  });
});
