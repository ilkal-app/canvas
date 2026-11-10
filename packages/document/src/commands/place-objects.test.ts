import { describe, expect, it } from 'vitest';

import type { Board, ObjectId, PrincipalId } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { ADA, fixtureObject, id } from '../store/__fixtures__/store-fixtures.js';
import { createSiblingStore, FRAME_ID } from '../z-order/__fixtures__/sibling-board.js';
import { sortedSiblings } from '../z-order/sibling-order.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
} from './__fixtures__/command-fixtures.js';
import { createGroupedStore } from './__fixtures__/grouped-board.js';
import { createNestedFramesStore } from './__fixtures__/nested-frames.js';
import { refusalsOn, storedBoardOf } from './__fixtures__/stored-board.js';
import { addPageCommand } from './pages/add-page.js';
import { moveObjectsToPageCommand } from './pages/move-to-page.js';
import { placeObjectsCommand } from './place-objects.js';
import { setLockedCommand } from './set-locked.js';
import { parentFrameToBoard } from './world-frame.js';

/**
 * Where an object's local origin is on the board, and its rotation there.
 *
 * @param board - The board.
 * @param id - The object.
 * @returns The point and the summed rotation.
 * @throws {Error} When the board has no such object.
 */
function onBoard(board: Board, id: string): { x: number; y: number; rotation: number } {
  const object = board.objects.get(id as ObjectId);
  if (object === undefined) throw new Error(`there is no object "${id}"`);
  const point = parentFrameToBoard(board, object, { x: object.x, y: object.y });
  let rotation = object.rotation;
  for (
    let parent = object.parentId === null ? undefined : board.objects.get(object.parentId);
    parent !== undefined;
    parent = parent.parentId === null ? undefined : board.objects.get(parent.parentId)
  ) {
    rotation += parent.rotation;
  }
  return { x: point?.x ?? NaN, y: point?.y ?? NaN, rotation };
}

/**
 * Expects an object to be where it was on the board, to rounding.
 *
 * @param before - The board before.
 * @param after - The board after.
 * @param id - The object.
 */
function expectStill(before: Board, after: Board, id: string): void {
  const was = onBoard(before, id);
  const is = onBoard(after, id);
  expect(is.x).toBeCloseTo(was.x, 9);
  expect(is.y).toBeCloseTo(was.y, 9);
  expect(Math.cos(is.rotation)).toBeCloseTo(Math.cos(was.rotation), 9);
  expect(Math.sin(is.rotation)).toBeCloseTo(Math.sin(was.rotation), 9);
}

describe('placeObjects among siblings', () => {
  it('puts an object directly below a sibling, writing only its z', () => {
    const store = createSiblingStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, placeObjectsCommand, {
      ids: ['s0'],
      parentId: FRAME_ID,
      belowId: 's3',
    });
    expectDiff(before, store.read(), changes, { updated: ['s0'] });
    expect(result).toEqual({ movedIds: ['s0'], reparentedIds: [] });
    expect(sortedSiblings(store, FRAME_ID)).toEqual(['s1', 's2', 's0', 's3', 's4', 's5']);
    expect({ ...mustGet(store, 's0'), z: 'a0', updatedAt: 0 }).toEqual(
      before.objects.get('s0' as ObjectId),
    );
  });

  it('puts objects on top without a sibling, keeping the order they were painted in', () => {
    const store = createSiblingStore();
    applyCommand(store, placeObjectsCommand, { ids: ['s4', 's1'], parentId: FRAME_ID });
    expect(sortedSiblings(store, FRAME_ID)).toEqual(['s0', 's2', 's3', 's5', 's1', 's4']);
    applyCommand(store, placeObjectsCommand, {
      ids: ['s5', 's0'],
      parentId: FRAME_ID,
      belowId: 's2',
    });
    expect(sortedSiblings(store, FRAME_ID)).toEqual(['s0', 's5', 's2', 's3', 's1', 's4']);
  });

  it('puts objects at the bottom, below the lowest sibling', () => {
    const store = createSiblingStore();
    applyCommand(store, placeObjectsCommand, { ids: ['s3'], parentId: FRAME_ID, belowId: 's0' });
    expect(sortedSiblings(store, FRAME_ID)).toEqual(['s3', 's0', 's1', 's2', 's4', 's5']);
  });

  it('writes nothing when the objects are already where it would put them', () => {
    const store = createSiblingStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, placeObjectsCommand, {
      ids: ['s1', 's2'],
      parentId: FRAME_ID,
      belowId: 's3',
    });
    expect(result).toEqual({ movedIds: [], reparentedIds: [] });
    expect(changes.updated).toEqual([]);
    expect(store.read()).toBe(before);
  });
});

describe('placeObjects into another parent', () => {
  it('takes a root object into a turned frame where it stays on the board', () => {
    const store = createNestedFramesStore();
    const before = store.read();
    const { result } = applyCommand(store, placeObjectsCommand, {
      ids: ['rect-free'],
      parentId: 'frame-inner',
      belowId: 'rect-inner-2',
    });
    expect(result).toEqual({ movedIds: ['rect-free'], reparentedIds: ['rect-free'] });
    expect(mustGet(store, 'rect-free').parentId).toBe('frame-inner');
    expect(mustGet(store, 'rect-free').pageId).toBeNull();
    expect(sortedSiblings(store, 'frame-inner' as ObjectId)).toEqual([
      'rect-inner',
      'rect-free',
      'rect-inner-2',
    ]);
    expectStill(before, store.read(), 'rect-free');
  });

  it('takes an object into a group, and one out of a group into the parent around it', () => {
    const store = createNestedFramesStore();
    const before = store.read();
    applyCommand(store, placeObjectsCommand, { ids: ['rect-outer'], parentId: 'group-g' });
    expect(sortedSiblings(store, 'group-g' as ObjectId)).toEqual(['rect-grouped', 'rect-outer']);
    expectStill(before, store.read(), 'rect-outer');
    applyCommand(store, placeObjectsCommand, {
      ids: ['rect-grouped'],
      parentId: 'frame-outer',
      belowId: 'group-g',
    });
    expect(mustGet(store, 'rect-grouped').parentId).toBe('frame-outer');
    expect(sortedSiblings(store, 'frame-outer' as ObjectId)).toEqual([
      'frame-inner',
      'rect-grouped',
      'group-g',
    ]);
    expectStill(before, store.read(), 'rect-grouped');
  });

  it('takes an object out of a turned group onto the root, giving it a page', () => {
    const store = createGroupedStore();
    const before = store.read();
    applyCommand(store, placeObjectsCommand, {
      ids: ['rect-c'],
      parentId: null,
      belowId: 'rect-free',
    });
    const placed = mustGet(store, 'rect-c');
    expect(placed.parentId).toBeNull();
    expect(typeof placed.pageId).toBe('string');
    expect(sortedSiblings(store, null)).toEqual(['group-outer', 'rect-c', 'rect-free']);
    expectStill(before, store.read(), 'rect-c');
  });

  it('moves objects from several parents into one, in the order the board painted them', () => {
    const store = createNestedFramesStore();
    applyCommand(store, placeObjectsCommand, {
      ids: ['rect-free', 'rect-inner', 'rect-side'],
      parentId: 'frame-outer',
    });
    expect(sortedSiblings(store, 'frame-outer' as ObjectId)).toEqual([
      'frame-inner',
      'rect-outer',
      'group-g',
      'rect-inner',
      'rect-side',
      'rect-free',
    ]);
  });

  it('is one undo step, which puts every object back', () => {
    const store = createNestedFramesStore();
    const history = createHistory(store, 'user:ada' as PrincipalId);
    const before = new Map(store.read().objects);
    applyCommand(store, placeObjectsCommand, {
      ids: ['rect-free', 'rect-grouped'],
      parentId: 'frame-side',
      belowId: 'rect-side',
    });
    expect(history.undo()).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(new Map(store.read().objects)).toEqual(before);
  });
});

describe('placeObjects refusals', () => {
  it('refuses a locked parent', () => {
    const store = createNestedFramesStore();
    applyCommand(store, setLockedCommand, { ids: ['frame-side'], locked: true });
    const errors = expectRejected(store, placeObjectsCommand, {
      ids: ['rect-free'],
      parentId: 'frame-side',
    });
    expect(errors.map(({ code }) => code)).toEqual(['locked']);
  });

  it('refuses a parent that is not a frame or a group, or does not exist', () => {
    const store = createNestedFramesStore();
    const notContainer = expectRejected(store, placeObjectsCommand, {
      ids: ['rect-free'],
      parentId: 'rect-side',
    });
    expect(notContainer.map(({ code }) => code)).toEqual(['invalid-parent']);
    const missing = expectRejected(store, placeObjectsCommand, {
      ids: ['rect-free'],
      parentId: 'nowhere',
    });
    expect(missing.map(({ code }) => code)).toEqual(['missing-parent']);
  });

  it('refuses a parent that is a moved object or inside one', () => {
    const store = createNestedFramesStore();
    const inside = expectRejected(store, placeObjectsCommand, {
      ids: ['frame-outer'],
      parentId: 'frame-inner',
    });
    expect(inside.map(({ code }) => code)).toEqual(['parent-cycle']);
    const itself = expectRejected(store, placeObjectsCommand, {
      ids: ['group-g'],
      parentId: 'group-g',
    });
    expect(itself.map(({ code }) => code)).toEqual(['parent-cycle']);
  });

  it('refuses a sibling that is not a child of the parent, or is one of the objects', () => {
    const store = createNestedFramesStore();
    const elsewhere = expectRejected(store, placeObjectsCommand, {
      ids: ['rect-free'],
      parentId: 'frame-side',
      belowId: 'rect-outer',
    });
    expect(elsewhere.map(({ code }) => code)).toEqual(['invalid-input']);
    const offRoot = expectRejected(store, placeObjectsCommand, {
      ids: ['rect-free'],
      parentId: null,
      belowId: 'rect-side',
    });
    expect(offRoot.map(({ code }) => code)).toEqual(['invalid-input']);
    const moved = expectRejected(store, placeObjectsCommand, {
      ids: ['rect-free', 'rect-locked'],
      parentId: null,
      belowId: 'rect-free',
    });
    expect(moved.map(({ code }) => code)).toEqual(['invalid-input']);
    const missing = expectRejected(store, placeObjectsCommand, {
      ids: ['rect-free'],
      parentId: null,
      belowId: 'nothing',
    });
    expect(missing.map(({ code }) => code)).toEqual(['missing-object']);
  });

  it('refuses an object listed with one of its ancestors, and ids missing or listed twice', () => {
    const store = createNestedFramesStore();
    const nested = expectRejected(store, placeObjectsCommand, {
      ids: ['group-g', 'rect-grouped'],
      parentId: null,
    });
    expect(nested.map(({ code }) => code)).toEqual(['overlapping-selection']);
    const twice = expectRejected(store, placeObjectsCommand, {
      ids: ['rect-free', 'rect-free', 'nothing'],
      parentId: null,
    });
    expect(twice.map(({ code }) => code)).toEqual(['duplicate-id', 'missing-object']);
  });

  it('refuses a parent on another page', () => {
    const store = createNestedFramesStore();
    const { result } = applyCommand(store, addPageCommand, {});
    applyCommand(store, moveObjectsToPageCommand, { ids: ['rect-free'], pageId: result.pageId });
    const errors = expectRejected(store, placeObjectsCommand, {
      ids: ['rect-free'],
      parentId: 'frame-side',
    });
    expect(errors.map(({ code }) => code)).toEqual(['cross-page']);
  });

  it('refuses a placement through a stored parent cycle', () => {
    const store = createNestedFramesStore();
    const group = fixtureObject('group-diagram', 'group');
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...group, id: id('loop-a'), parentId: id('loop-b') });
      transaction.setObject({ ...group, id: id('loop-b'), parentId: id('loop-a') });
      transaction.setObject({ ...fixtureObject('shape-box', 'shape'), parentId: id('loop-a') });
    });
    const errors = refusalsOn(storedBoardOf(store), placeObjectsCommand, {
      ids: ['shape-box'],
      parentId: 'loop-b',
    });
    expect(errors.map(({ code }) => code)).toEqual(['parent-cycle']);
  });

  it('refuses neighbours whose stored keys are not fractional-index keys', () => {
    const cases = [
      { keys: { 3: '!' }, input: { ids: ['s0'], parentId: FRAME_ID, belowId: 's3' } },
      { keys: { 0: '!' }, input: { ids: ['s3'], parentId: FRAME_ID, belowId: 's0' } },
      { keys: { 5: '~' }, input: { ids: ['s0'], parentId: FRAME_ID } },
    ];
    for (const { keys, input } of cases) {
      const errors = expectRejected(createSiblingStore(6, keys), placeObjectsCommand, input);
      expect(errors.map(({ code }) => code)).toEqual(['unorderable-neighbours']);
    }
  });
});
