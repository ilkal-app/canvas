import { describe, expect, it, vi } from 'vitest';

import { createHistory, findCommand, YjsDocumentStore, type ChangeSet } from '@canvas/document';
import {
  createSeededIdGenerator,
  type ObjectId,
  type PageId,
  type PrincipalId,
} from '@canvas/schema';

import * as pageViewModule from './create-page-view.js';
import { PageIndex } from './page-index.js';
import { PageNavigator } from './page-navigator.js';
import { PageScopedStore } from './page-scoped-store.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const FIRST = 'page-1' as PageId;
const environment = { clock: () => 1, createId: createSeededIdGenerator(558) };

/**
 * A manually released browser yield.
 *
 * @returns Its yield function and next release.
 */
function yields() {
  const pending: (() => void)[] = [];
  return {
    yieldToBrowser: () => new Promise<void>((resolve) => pending.push(resolve)),
    async next() {
      const resolve = pending.shift();
      if (resolve === undefined) throw new Error('a browser yield is pending');
      resolve();
      await Promise.resolve();
    },
  };
}

/**
 * A navigator with three pages and objects on the second and third.
 *
 * @param slicing - Optional browser slices.
 * @param slicing.sliceSize - Maximum number of created ids per slice.
 * @param slicing.yieldToBrowser - Browser yield between slices.
 * @returns The store, view, navigator, pages, and yield gate.
 */
function setup(slicing?: { sliceSize: number; yieldToBrowser: () => Promise<void> }) {
  const store = new YjsDocumentStore();
  const view = new PageScopedStore(store, new PageIndex(store), FIRST);
  const beforeSwitch = vi.fn();
  const navigator = new PageNavigator({
    store,
    view,
    origin: ORIGIN,
    environment,
    findCommand,
    beforeSwitch,
    ...(slicing === undefined ? {} : { slicing }),
  });
  const second = (navigator.run('addPage', {}) as { pageId: PageId }).pageId;
  const third = (navigator.run('addPage', {}) as { pageId: PageId }).pageId;
  const shape = {
    type: 'shape' as const,
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: ORIGIN.principalId,
    createdAt: 1,
    updatedAt: 1,
    width: 10,
    height: 10,
    kind: 'rectangle' as const,
    cornerRadius: 0,
    sides: 4,
    label: null,
    stroke: null,
    fill: [1, 0, 0, 1] as [number, number, number, number],
  };
  store.transact(ORIGIN, (tx) => {
    for (const pageId of [second, third]) {
      for (let index = 0; index < 9; index += 1) {
        tx.setObject({ ...shape, id: `${pageId}-${index.toString()}` as ObjectId, pageId });
      }
    }
  });
  return { store, view, navigator, second, third, beforeSwitch };
}

describe('PageNavigator sliced switches', () => {
  it('runs beforeSwitch, publishes the first slice, then tells listeners synchronously', async () => {
    const gate = yields();
    const { store, view, navigator, second, beforeSwitch } = setup({
      sliceSize: 4,
      yieldToBrowser: gate.yieldToBrowser,
    });
    const order: string[] = [];
    const changes: ChangeSet[] = [];
    view.subscribe((change) => {
      order.push('slice');
      changes.push(change);
    });
    beforeSwitch.mockImplementation(() => order.push('before'));
    navigator.subscribe(() => order.push('page'));
    navigator.show(second);
    expect(navigator.current()).toBe(second);
    expect(changes[0]?.created).toHaveLength(4);
    expect(order).toEqual(['before', 'slice', 'page']);
    expect(beforeSwitch).toHaveBeenCalledWith(FIRST, second);
    await gate.next();
    expect(changes[1]?.created).toHaveLength(4);
    expect(order).toEqual(['before', 'slice', 'page', 'slice']);
    await gate.next();
    expect(changes[2]?.created).toHaveLength(1);
    navigator.destroy();
    view.destroy();
    store.destroy();
  });

  it('holds user switches during a slice and shows only the latest requested page', async () => {
    const gate = yields();
    const { store, view, navigator, second, third } = setup({
      sliceSize: 4,
      yieldToBrowser: gate.yieldToBrowser,
    });
    const shown: PageId[] = [];
    navigator.subscribe(() => shown.push(navigator.current()));
    navigator.step(1);
    expect(navigator.current()).toBe(second);
    navigator.show(FIRST);
    navigator.show(third);
    expect(navigator.current()).toBe(second);
    await gate.next();
    await gate.next();
    await Promise.resolve();
    expect(navigator.current()).toBe(third);
    expect(shown).toEqual([second, third]);
    navigator.destroy();
    view.destroy();
    store.destroy();
  });

  it('slices an undo follow-switch before notifying the page listener', async () => {
    const gate = yields();
    const { store, view, navigator, second } = setup({
      sliceSize: 4,
      yieldToBrowser: gate.yieldToBrowser,
    });
    const history = createHistory(store, ORIGIN.principalId, { captureTimeout: 0 });
    store.transact(ORIGIN, (tx) => {
      const source = store.get(`${second}-0` as ObjectId);
      if (source === undefined) throw new Error('source shape exists');
      tx.setObject({ ...source, id: 'undone' as ObjectId });
    });
    history.stopCapturing();
    const order: string[] = [];
    const changes: ChangeSet[] = [];
    view.subscribe((change) => {
      order.push('slice');
      changes.push(change);
    });
    navigator.subscribe(() => order.push('page'));
    expect(history.undo()).toBe(true);
    expect(navigator.current()).toBe(second);
    expect(changes[0]?.created).toHaveLength(4);
    expect(order).toEqual(['slice', 'page']);
    await gate.next();
    await gate.next();
    history.destroy();
    navigator.destroy();
    view.destroy();
    store.destroy();
  });

  it('keeps the one-change-set switch when slicing is absent', () => {
    const { store, view, navigator, second } = setup();
    const changes: ChangeSet[] = [];
    view.subscribe((change) => changes.push(change));
    navigator.show(second);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.created).toHaveLength(9);
    navigator.destroy();
    view.destroy();
    store.destroy();
  });

  it('configures createPageView with 3,200 object slices', () => {
    expect(Reflect.get(pageViewModule, 'PAGE_SWITCH_SLICE_SIZE')).toBe(3_200);
  });
});
