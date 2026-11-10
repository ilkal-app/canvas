// The sliced switch's own edges: a smaller first slice beside the page left's
// deletes, the parents-first order under a cycle, and progress on a run it holds.
import { describe, expect, it, vi } from 'vitest';

import type { DocumentStore, StoreRun } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { parentsFirst, SlicedPageSwitch } from './sliced-page-switch.js';

const ids = (count: number): ObjectId[] =>
  Array.from(
    { length: count },
    (unused, index) => `o${String(index).padStart(2, '0')}` as ObjectId,
  );

/**
 * A store that can open a run, recording its progress and close.
 *
 * @returns The store and the run's records.
 */
function runnable() {
  const progress = vi.fn();
  const close = vi.fn();
  const run = { progress, close } as unknown as StoreRun;
  const store = { beginRun: () => run } as unknown as DocumentStore;
  return { store, progress, close };
}

describe('SlicedPageSwitch', () => {
  it('announces a smaller first slice beside the deletes, then full slices', async () => {
    const { store, progress, close } = runnable();
    const announced: [number, number][] = [];
    const sliced = new SlicedPageSwitch({
      store,
      canOpenRun: true,
      order: ids(10),
      slicing: { sliceSize: 4, firstSliceSize: 1, yieldToBrowser: () => Promise.resolve() },
      deleted: ids(3),
      announce: (created, deleted) => announced.push([created.length, deleted.length]),
      adopt: () => undefined,
    });
    await sliced.done;
    expect(announced).toEqual([
      [1, 3],
      [4, 0],
      [4, 0],
      [1, 0],
    ]);
    expect(progress).toHaveBeenLastCalledWith(10, 10);
    expect(close).toHaveBeenCalledOnce();
  });

  it('calls afterSlice after each slice is announced, so the scene goes out at once', async () => {
    const { store } = runnable();
    const events: string[] = [];
    const sliced = new SlicedPageSwitch({
      store,
      canOpenRun: true,
      order: ids(5),
      slicing: {
        sliceSize: 2,
        firstSliceSize: 1,
        yieldToBrowser: () => Promise.resolve(),
        afterSlice: () => events.push('after'),
      },
      deleted: ids(3),
      announce: (created) => events.push(`announce ${String(created.length)}`),
      adopt: () => undefined,
    });
    expect(events).toEqual(['announce 1', 'after']);
    await sliced.done;
    expect(events).toEqual(['announce 1', 'after', 'announce 2', 'after', 'announce 2', 'after']);
  });

  it('opens no run when it may not, and closes its run when the first announcement throws', () => {
    const { store, progress, close } = runnable();
    const slicing = { sliceSize: 4, yieldToBrowser: () => Promise.resolve() };
    const quiet = new SlicedPageSwitch({
      store,
      canOpenRun: false,
      order: [],
      slicing,
      deleted: [],
      announce: () => undefined,
      adopt: () => undefined,
    });
    expect(progress).not.toHaveBeenCalled();
    quiet.stop();
    expect(
      () =>
        new SlicedPageSwitch({
          store,
          canOpenRun: true,
          order: ids(2),
          slicing,
          deleted: [],
          announce: () => {
            throw new Error('listener failed');
          },
          adopt: () => undefined,
        }),
    ).toThrow('listener failed');
    expect(close).toHaveBeenCalledOnce();
  });

  it('orders parents first and ends a parent cycle', () => {
    const parents = new Map<ObjectId, ObjectId | null>([
      ['c' as ObjectId, 'b' as ObjectId],
      ['b' as ObjectId, 'a' as ObjectId],
      ['a' as ObjectId, null],
      ['x' as ObjectId, 'y' as ObjectId],
      ['y' as ObjectId, 'x' as ObjectId],
    ]);
    const order = parentsFirst([...parents.keys()], (id) => parents.get(id) ?? null);
    expect(order.indexOf('a' as ObjectId)).toBeLessThan(order.indexOf('b' as ObjectId));
    expect(order.indexOf('b' as ObjectId)).toBeLessThan(order.indexOf('c' as ObjectId));
    expect(new Set(order).size).toBe(5);
  });
});
