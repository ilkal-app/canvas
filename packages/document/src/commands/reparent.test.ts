import { describe, expect, it } from 'vitest';

import { ADA_ID } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { writeKeysRemotely } from '../store/__fixtures__/remote-keys.js';
import { ADA, id } from '../store/__fixtures__/store-fixtures.js';
import type { ChangeSet } from '../store/document-store.js';
import { sortedSiblings } from '../z-order/sibling-order.js';

import {
  boardPlacement,
  expectSamePlacement,
  shiftedPlacement,
} from './__fixtures__/board-geometry.js';
import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
} from './__fixtures__/command-fixtures.js';
import { createNestedFramesStore } from './__fixtures__/nested-frames.js';
import { refusalsOn, storedBoardOf } from './__fixtures__/stored-board.js';
import { moveObjectsCommand } from './move-objects.js';

// The reparenting move: `moveObjects` with a
// `parentId` moves an object and puts it in another frame or on the root in the same command,
// keeping where it is on the board, turned frames and frames inside frames included.

const closeTo = (actual: number, expected: number) => {
  expect(actual).toBeCloseTo(expected, 9);
};

describe('moveObjects with a parentId', () => {
  it('moves an object out of a turned frame to the root without a jump', () => {
    const store = createNestedFramesStore();
    const before = store.read();
    const by = { x: 500, y: 20 };
    const { result, changes } = applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'rect-outer', by, parentId: null }],
    });
    expect(result).toEqual({
      movedIds: ['rect-outer'],
      reparentedIds: ['rect-outer'],
      rerootedIds: [],
    });
    expectDiff(before, store.read(), changes, { updated: ['rect-outer'] });
    const moved = mustGet(store, 'rect-outer');
    expect(moved.parentId).toBeNull();
    expect(moved.rotation).toBe(0.1 + 0.4);
    expectSamePlacement(
      boardPlacement(store.read(), 'rect-outer'),
      shiftedPlacement(boardPlacement(before, 'rect-outer'), by),
      closeTo,
    );
  });

  it('moves an object into a turned frame inside another turned frame without a jump', () => {
    const store = createNestedFramesStore();
    const before = store.read();
    const to = { x: 200, y: 180 };
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'rect-free', to, parentId: 'frame-inner' }],
    });
    const moved = mustGet(store, 'rect-free');
    expect(moved.parentId).toBe('frame-inner');
    expect(moved.rotation).toBeCloseTo(-0.15, 12);
    const [origin, axis] = boardPlacement(store.read(), 'rect-free');
    closeTo(origin.x, to.x);
    closeTo(origin.y, to.y);
    // Unturned on the board before, so unturned after: its x axis still points along the board's.
    closeTo(axis.x - origin.x, 1);
    closeTo(axis.y - origin.y, 0);
    expect(boardPlacement(before, 'frame-inner')).toEqual(
      boardPlacement(store.read(), 'frame-inner'),
    );
  });

  it('moves an object from a nested frame into a frame beside its parent', () => {
    const store = createNestedFramesStore();
    const before = store.read();
    const by = { x: 700, y: -30 };
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'rect-inner', by, parentId: 'frame-side' }],
    });
    expect(mustGet(store, 'rect-inner')).toMatchObject({ parentId: 'frame-side' });
    expect(mustGet(store, 'rect-inner').rotation).toBeCloseTo(0.15, 12);
    expectSamePlacement(
      boardPlacement(store.read(), 'rect-inner'),
      shiftedPlacement(boardPlacement(before, 'rect-inner'), by),
      closeTo,
    );
  });

  it('turns an object out of a nested frame by exactly that frame’s rotation', () => {
    const store = createNestedFramesStore();
    const before = store.read();
    const by = { x: 150, y: 0 };
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'rect-inner', by, parentId: 'frame-outer' }],
    });
    // The shared ancestor's rotation never enters the sum, so the angle is exact.
    expect(mustGet(store, 'rect-inner')).toMatchObject({
      parentId: 'frame-outer',
      rotation: -0.25,
    });
    expectSamePlacement(
      boardPlacement(store.read(), 'rect-inner'),
      shiftedPlacement(boardPlacement(before, 'rect-inner'), by),
      closeTo,
    );
  });

  it('puts moved objects on top of the new parent’s children in their previous order', () => {
    const store = createNestedFramesStore();
    applyCommand(store, moveObjectsCommand, {
      moves: [
        { id: 'rect-inner-2', by: { x: 600, y: 0 }, parentId: 'frame-side' },
        { id: 'rect-inner', by: { x: 600, y: 0 }, parentId: 'frame-side' },
      ],
    });
    expect(sortedSiblings(store, id('frame-side'))).toEqual([
      'rect-side',
      'rect-inner',
      'rect-inner-2',
    ]);
    expect(sortedSiblings(store, id('frame-inner'))).toEqual([]);
  });

  it('stacks objects from different parents in the order they were painted in', () => {
    const store = createNestedFramesStore();
    // rect-side's own key (a5) is above rect-free's (a2), but it paints below it: its frame,
    // frame-side (a1), is below rect-free on the root.
    applyCommand(store, moveObjectsCommand, {
      moves: [
        { id: 'rect-side', by: { x: -600, y: 100 }, parentId: 'frame-inner' },
        { id: 'rect-free', by: { x: -400, y: -250 }, parentId: 'frame-inner' },
      ],
    });
    expect(sortedSiblings(store, id('frame-inner'))).toEqual([
      'rect-inner',
      'rect-inner-2',
      'rect-side',
      'rect-free',
    ]);
  });

  it('keeps the rotation it stores in (−π, π] when the parents’ turns add past π', () => {
    const store = createNestedFramesStore();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('rect-outer'), { rotation: 3 });
    });
    const before = store.read();
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'rect-outer', by: { x: 500, y: 0 }, parentId: null }],
    });
    const { rotation } = mustGet(store, 'rect-outer');
    expect(rotation).toBeCloseTo(3.4 - 2 * Math.PI, 12);
    expectSamePlacement(
      boardPlacement(store.read(), 'rect-outer'),
      shiftedPlacement(boardPlacement(before, 'rect-outer'), { x: 500, y: 0 }),
      closeTo,
    );
  });

  it('only moves an object whose parent is already the one asked for', () => {
    const store = createNestedFramesStore();
    const before = mustGet(store, 'rect-outer');
    const changes: ChangeSet[] = [];
    store.subscribe((changeSet) => changes.push(changeSet));
    const { result } = applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'rect-outer', by: { x: 5, y: 0 }, parentId: 'frame-outer' }],
    });
    expect(result).toEqual({ movedIds: ['rect-outer'], reparentedIds: [], rerootedIds: [] });
    expect(changes).toHaveLength(1);
    expect(mustGet(store, 'rect-outer')).toMatchObject({
      parentId: 'frame-outer',
      rotation: before.rotation,
      z: before.z,
    });
  });

  it('is one undo step that restores parent, position, rotation and key exactly', () => {
    const store = createNestedFramesStore();
    const history = createHistory(store, ADA_ID);
    const before = new Map(store.read().objects);
    applyCommand(store, moveObjectsCommand, {
      moves: [
        { id: 'rect-outer', by: { x: 500, y: 0 }, parentId: 'frame-side' },
        { id: 'rect-free', by: { x: -300, y: -250 }, parentId: 'frame-inner' },
      ],
    });
    expect(history.undo()).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(new Map(store.read().objects)).toEqual(before);
  });

  it('rejects a parent that is missing, not a frame, the object itself or inside it', () => {
    const store = createNestedFramesStore();
    const errors = expectRejected(store, moveObjectsCommand, {
      moves: [
        { id: 'rect-free', by: { x: 1, y: 1 }, parentId: 'gone' },
        { id: 'rect-inner', by: { x: 1, y: 1 }, parentId: 'rect-locked' },
        { id: 'frame-side', by: { x: 1, y: 1 }, parentId: 'frame-side' },
      ],
    });
    expect(errors.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['missing-parent', 'rect-free', ['moves', 0, 'parentId']],
      ['invalid-parent', 'rect-inner', ['moves', 1, 'parentId']],
      ['parent-cycle', 'frame-side', ['moves', 2, 'parentId']],
    ]);
    const inside = expectRejected(store, moveObjectsCommand, {
      moves: [{ id: 'frame-outer', by: { x: 1, y: 1 }, parentId: 'frame-inner' }],
    });
    expect(inside.map((error) => [error.code, error.objectId])).toEqual([
      ['parent-cycle', 'frame-outer'],
    ]);
  });

  it('rejects taking an object out of its group, and a parent the command also moves', () => {
    const store = createNestedFramesStore();
    const errors = expectRejected(store, moveObjectsCommand, {
      moves: [
        { id: 'rect-grouped', by: { x: 1, y: 1 }, parentId: null },
        { id: 'frame-side', by: { x: 1, y: 1 } },
        { id: 'rect-free', by: { x: 1, y: 1 }, parentId: 'frame-side' },
        { id: 'rect-outer', by: { x: 1, y: 1 }, parentId: 'frame-inner' },
        { id: 'frame-inner', by: { x: 1, y: 1 } },
      ],
    });
    expect(errors.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['invalid-parent', 'rect-grouped', ['moves', 0, 'parentId']],
      ['overlapping-selection', 'rect-free', ['moves', 2, 'parentId']],
      ['overlapping-selection', 'rect-outer', ['moves', 3, 'parentId']],
    ]);
  });

  it('still refuses a locked object, with or without a parentId', () => {
    const store = createNestedFramesStore();
    const errors = expectRejected(store, moveObjectsCommand, {
      moves: [{ id: 'rect-locked', by: { x: 1, y: 1 }, parentId: 'frame-side' }],
    });
    expect(errors.map((error) => error.code)).toEqual(['locked']);
  });

  it('rejects a parent whose top key is not a fractional-index key, or whose parents loop', () => {
    const store = createNestedFramesStore();
    writeKeysRemotely(store, { 'rect-side': 'not-a-key' });
    const unorderable = expectRejected(store, moveObjectsCommand, {
      moves: [{ id: 'rect-free', by: { x: 1, y: 1 }, parentId: 'frame-side' }],
    });
    expect(unorderable.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['unorderable-neighbours', 'rect-free', ['moves', 0, 'parentId']],
    ]);
    const side = mustGet(store, 'frame-side');
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...side, id: id('loop-a'), parentId: id('loop-b') });
      transaction.setObject({ ...side, id: id('loop-b'), parentId: id('loop-a') });
    });
    const looped = refusalsOn(storedBoardOf(store), moveObjectsCommand, {
      moves: [{ id: 'rect-free', by: { x: 1, y: 1 }, parentId: 'loop-a' }],
    });
    expect(looped.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['parent-cycle', 'rect-free', ['moves', 0, 'parentId']],
    ]);
  });
});
