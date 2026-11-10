import { describe, expect, it } from 'vitest';

import {
  applyTransform,
  BOARD_BOUND,
  parentToBoardTransform,
  type Board,
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

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
} from './__fixtures__/command-fixtures.js';
import { refusalsOn, storedBoardOf } from './__fixtures__/stored-board.js';
import { moveObjectsCommand } from './move-objects.js';
import { setStyleCommand } from './set-style.js';

/**
 * Where an object's local origin is on the board.
 *
 * @param board - The board.
 * @param object - The object.
 * @returns The origin in board coordinates.
 */
function boardOrigin(board: Board, object: BoardObject): Point {
  return applyTransform(parentToBoardTransform(board, object), { x: object.x, y: object.y });
}

describe('moveObjects', () => {
  it('moves root objects by a delta and stamps them, touching nothing else', () => {
    const store = createFixtureStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, moveObjectsCommand, {
      moves: [
        { id: 'image-photo', by: { x: 10, y: -5 } },
        { id: 'line-divider', to: { x: 0, y: 0 } },
      ],
    });
    expect(result).toEqual({
      movedIds: ['image-photo', 'line-divider'],
      reparentedIds: [],
      rerootedIds: [],
    });
    expectDiff(before, store.read(), changes, { updated: ['image-photo', 'line-divider'] });
    expect(mustGet(store, 'image-photo')).toEqual({
      ...fixtureObject('image-photo', 'image'),
      x: 910,
      y: -305,
      updatedAt: NOW,
    });
    expect(mustGet(store, 'line-divider')).toMatchObject({ x: 0, y: 0 });
  });

  it('takes positions in board coordinates and stores them in the parent frame', () => {
    const store = createFixtureStore();
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'text-title', to: { x: 0, y: 0 } }] });
    // The frame's origin is at (-400, -300) on the board.
    expect(mustGet(store, 'text-title')).toMatchObject({ x: 400, y: 300 });
  });

  it('moves an object in a rotated group the way it looks on the board', () => {
    const store = createFixtureStore();
    const before = store.read();
    const box = mustGet(store, 'shape-box');
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'shape-box', by: { x: 10, y: 0 } }] });
    const after = store.read();
    const from = boardOrigin(before, box);
    const to = boardOrigin(after, mustGet(store, 'shape-box'));
    expect(to.x - from.x).toBeCloseTo(10, 9);
    expect(to.y - from.y).toBeCloseTo(0, 9);
    expect(mustGet(store, 'shape-box').y).not.toBe(0);
  });

  it('moves a group without rewriting its children, which are relative to it', () => {
    const store = createFixtureStore();
    // A locked child locks its group's transform, so the fixture's star is unlocked.
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('shape-star'), { locked: false });
    });
    const before = store.read();
    const { changes } = applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'group-diagram', by: { x: 50, y: 50 } }],
    });
    expectDiff(before, store.read(), changes, { updated: ['group-diagram'] });
    expect(mustGet(store, 'group-diagram')).toMatchObject({ x: 450, y: 170 });
  });

  it('rejects locked objects, objects moved with an ancestor, missing and repeated ids', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, moveObjectsCommand, {
      moves: [
        { id: 'shape-star', by: { x: 1, y: 1 } },
        { id: 'group-diagram', by: { x: 1, y: 1 } },
        { id: 'shape-box', by: { x: 1, y: 1 } },
        { id: 'gone', by: { x: 1, y: 1 } },
        { id: 'shape-box', to: { x: 1, y: 1 } },
      ],
    });
    expect(errors.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['missing-object', 'gone', ['moves', 3]],
      ['duplicate-id', 'shape-box', ['moves', 4]],
      ['locked', 'shape-star', ['moves', 0]],
      ['overlapping-selection', 'shape-star', ['moves', 0]],
      // The group holds the locked star.
      ['locked', 'group-diagram', ['moves', 1]],
      ['overlapping-selection', 'shape-box', ['moves', 2]],
    ]);
  });

  it('rejects a move whose result lies past the board bound', () => {
    const store = createFixtureStore();
    const far = { x: BOARD_BOUND, y: BOARD_BOUND };
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'comment-free', to: far }] });
    // Twice the bound is past it: the pin's place on the board would go further out.
    const errors = expectRejected(store, moveObjectsCommand, {
      moves: [{ id: 'comment-free', by: far }],
    });
    expect(errors.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['invalid-input', 'comment-free', []],
    ]);
  });

  it('rejects moving an object that hangs below a parent cycle', () => {
    const store = createFixtureStore();
    const group = fixtureObject('group-diagram', 'group');
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...group, id: id('loop-a'), parentId: id('loop-b') });
      transaction.setObject({ ...group, id: id('loop-b'), parentId: id('loop-a') });
      transaction.patchObject(id('image-photo'), { parentId: id('loop-a') });
    });
    expect(
      refusalsOn(storedBoardOf(store), moveObjectsCommand, {
        moves: [{ id: 'image-photo', to: { x: 0, y: 0 } }],
      }),
    ).toEqual([expect.objectContaining({ code: 'parent-cycle', objectId: 'image-photo' })]);
  });

  it('converges when one client moves an object while another restyles it', () => {
    const [ada, bob] = createSyncedPair();
    applyCommand(ada, moveObjectsCommand, { moves: [{ id: 'image-photo', by: { x: 5, y: 5 } }] });
    applyCommand(
      bob,
      setStyleCommand,
      { changes: [{ id: 'image-photo', style: { opacity: 0.5 } }] },
      BOB,
    );
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(ada.get(id('image-photo'))).toMatchObject({ x: 905, y: -295, opacity: 0.5 });
  });
});
