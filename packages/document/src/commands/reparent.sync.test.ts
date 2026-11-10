import { describe, expect, it } from 'vitest';

import { ADA_ID } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { BOB, exchange, id } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { sortedSiblings } from '../z-order/sibling-order.js';

import {
  boardPlacement,
  expectSamePlacement,
  shiftedPlacement,
} from './__fixtures__/board-geometry.js';
import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { createNestedFramesStore } from './__fixtures__/nested-frames.js';
import { moveObjectsCommand } from './move-objects.js';

// Sync tests for the reparenting move: two clients edit the same
// frames concurrently and must converge, and the object a client dropped must stay where that
// client put it relative to its new parent.

/**
 * Two stores holding the nested-frames board, as two synced clients would.
 *
 * @returns Ada's store and Bob's.
 */
function createPair(): [YjsDocumentStore, YjsDocumentStore] {
  const ada = createNestedFramesStore();
  const bob = new YjsDocumentStore();
  exchange(ada, bob);
  return [ada, bob];
}

/**
 * Checks that both clients hold the same, valid board.
 *
 * @param ada - One client.
 * @param bob - The other.
 */
function expectConverged(ada: YjsDocumentStore, bob: YjsDocumentStore): void {
  expect(new Map(bob.read().objects)).toEqual(new Map(ada.read().objects));
  expect(ada.read().issues).toEqual([]);
}

const closeTo = (actual: number, expected: number) => {
  expect(actual).toBeCloseTo(expected, 9);
};

describe('concurrent reparenting moves', () => {
  it('converge when one client drags an object out of a frame while another moves the frame', () => {
    const [ada, bob] = createPair();
    applyCommand(ada, moveObjectsCommand, {
      moves: [{ id: 'rect-outer', by: { x: 500, y: 0 }, parentId: null }],
    });
    const dropped = boardPlacement(ada.read(), 'rect-outer');
    applyCommand(
      bob,
      moveObjectsCommand,
      { moves: [{ id: 'frame-outer', by: { x: 30, y: 30 } }] },
      BOB,
    );
    exchange(ada, bob);
    expectConverged(ada, bob);
    expect(mustGet(bob, 'rect-outer').parentId).toBeNull();
    // Out of the frame, it no longer follows it.
    expectSamePlacement(boardPlacement(bob.read(), 'rect-outer'), dropped, closeTo);
  });

  it('converge when one client drops an object into a frame while another moves the frame', () => {
    const [ada, bob] = createPair();
    applyCommand(ada, moveObjectsCommand, {
      moves: [{ id: 'rect-free', to: { x: 850, y: 100 }, parentId: 'frame-side' }],
    });
    const dropped = boardPlacement(ada.read(), 'rect-free');
    const by = { x: 0, y: 200 };
    applyCommand(bob, moveObjectsCommand, { moves: [{ id: 'frame-side', by }] }, BOB);
    exchange(ada, bob);
    expectConverged(ada, bob);
    expect(mustGet(bob, 'rect-free').parentId).toBe('frame-side');
    // In the frame, it follows it.
    expectSamePlacement(
      boardPlacement(bob.read(), 'rect-free'),
      shiftedPlacement(dropped, by),
      closeTo,
    );
  });

  it('keep one of two concurrent reparents of the same object, whole, on every client', () => {
    const [ada, bob] = createPair();
    applyCommand(ada, moveObjectsCommand, {
      moves: [{ id: 'rect-outer', by: { x: 400, y: 0 }, parentId: null }],
    });
    applyCommand(
      bob,
      moveObjectsCommand,
      { moves: [{ id: 'rect-outer', by: { x: 700, y: -100 }, parentId: 'frame-side' }] },
      BOB,
    );
    const versions = [mustGet(ada, 'rect-outer'), mustGet(bob, 'rect-outer')];
    exchange(ada, bob);
    expectConverged(ada, bob);
    expect(versions).toContainEqual(mustGet(ada, 'rect-outer'));
  });

  it('converge with distinct keys on top when two clients drop objects into one frame', () => {
    const [ada, bob] = createPair();
    applyCommand(ada, moveObjectsCommand, {
      moves: [{ id: 'rect-free', by: { x: 300, y: -300 }, parentId: 'frame-side' }],
    });
    applyCommand(
      bob,
      moveObjectsCommand,
      { moves: [{ id: 'rect-inner', by: { x: 700, y: 0 }, parentId: 'frame-side' }] },
      BOB,
    );
    exchange(ada, bob);
    expectConverged(ada, bob);
    const order = sortedSiblings(ada, id('frame-side'));
    expect(sortedSiblings(bob, id('frame-side'))).toEqual(order);
    expect(order[0]).toBe('rect-side');
    expect(new Set(order.slice(1))).toEqual(new Set(['rect-free', 'rect-inner']));
    expect(mustGet(ada, 'rect-free').z).not.toBe(mustGet(ada, 'rect-inner').z);
  });

  it('undo puts the object back in its frame even after a collaborator moved the frame', () => {
    const [ada, bob] = createPair();
    const history = createHistory(ada, ADA_ID);
    const before = mustGet(ada, 'rect-outer');
    applyCommand(ada, moveObjectsCommand, {
      moves: [{ id: 'rect-outer', by: { x: 500, y: 0 }, parentId: null }],
    });
    exchange(ada, bob);
    applyCommand(
      bob,
      moveObjectsCommand,
      { moves: [{ id: 'frame-outer', by: { x: 30, y: 30 } }] },
      BOB,
    );
    exchange(ada, bob);
    expect(history.undo()).toBe(true);
    exchange(ada, bob);
    expectConverged(ada, bob);
    expect(mustGet(bob, 'rect-outer')).toEqual(before);
    expect(mustGet(bob, 'frame-outer')).toMatchObject({ x: 130, y: 80 });
  });
});
