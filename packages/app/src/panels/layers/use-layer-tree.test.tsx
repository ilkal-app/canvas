// @vitest-environment jsdom
// The layers panel's model follows a stepped run (a sliced page switch) in one pass after it.
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { findCommand, isStoreRunning, YjsDocumentStore } from '@canvas/document';
import {
  createSeededIdGenerator,
  type ObjectId,
  type PageId,
  type PrincipalId,
} from '@canvas/schema';

import { DocumentBoardView } from '../../engine/document-board-view.js';
import { PageIndex } from '../../pages/page-index.js';
import { PageNavigator } from '../../pages/page-navigator.js';
import { PageScopedStore } from '../../pages/page-scoped-store.js';

import { useLayerTree } from './use-layer-tree.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const FIRST = 'page-1' as PageId;

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Animation frames the test runs by hand.
 *
 * @returns Whether one is waiting, and a way to run those waiting.
 */
function stubFrames() {
  let waiting: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    waiting.push(callback);
    return waiting.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  return {
    count: () => waiting.length,
    run() {
      const callbacks = waiting;
      waiting = [];
      for (const callback of callbacks) callback(0);
    },
  };
}

/**
 * A board on its first page, a second page of nine rectangles, and a navigator that switches a
 * slice of four per task, its tasks ended by hand.
 *
 * @returns The store, the board view, the navigator, the second page and the next task's start.
 */
function setUp() {
  const store = new YjsDocumentStore();
  const view = new PageScopedStore(store, new PageIndex(store), FIRST);
  const pending: (() => void)[] = [];
  const navigator = new PageNavigator({
    store,
    view,
    origin: ORIGIN,
    environment: { clock: () => 1, createId: createSeededIdGenerator(772) },
    findCommand,
    slicing: {
      sliceSize: 4,
      yieldToBrowser: () => new Promise<void>((resolve) => pending.push(resolve)),
    },
  });
  const second = (navigator.run('addPage', {}) as { pageId: PageId }).pageId;
  store.transact(ORIGIN, (tx) => {
    for (let index = 0; index < 9; index += 1) {
      tx.setObject({
        id: `rect-${String(index)}` as ObjectId,
        pageId: second,
        type: 'shape',
        parentId: null,
        x: 0,
        y: 0,
        rotation: 0,
        z: `a${String(index)}`,
        locked: false,
        createdBy: ORIGIN.principalId,
        createdAt: 1,
        updatedAt: 1,
        width: 10,
        height: 10,
        kind: 'rectangle',
        cornerRadius: 0,
        sides: 4,
        label: null,
        stroke: null,
        fill: [1, 0, 0, 1],
      });
    }
  });
  const boardView = new DocumentBoardView(
    view,
    { ids: () => [], select: () => undefined, enteredGroupId: () => null },
    { definitions: store },
  );
  const nextTask = async () => {
    const resolve = pending.shift();
    if (resolve === undefined) throw new Error('No task is waiting to start.');
    resolve();
    await vi.waitFor(() => {
      expect(pending.length > 0 || !isStoreRunning(store)).toBe(true);
    });
  };
  return { store, view, navigator, boardView, second, nextTask };
}

it('restructures the layers once a sliced page switch ends, not on every frame', async () => {
  const frames = stubFrames();
  const { store, view, navigator, boardView, second, nextTask } = setUp();
  const { result } = renderHook(() => useLayerTree(boardView));
  const tree = result.current.tree;
  if (tree === undefined) throw new Error('Expected the layers tree.');
  const version = tree.version();
  navigator.show(second);
  await nextTask();
  // Between the switch's tasks the browser draws: no pass while its run holds the board.
  expect(frames.count()).toBe(0);
  act(() => {
    frames.run();
  });
  expect(tree.rows()).toHaveLength(0);
  await nextTask();
  await vi.waitFor(() => {
    expect(frames.count()).toBe(1);
  });
  act(() => {
    frames.run();
  });
  expect(tree.rows()).toHaveLength(9);
  expect(tree.version()).toBe(version + 1);
  navigator.destroy();
  view.destroy();
  store.destroy();
});
