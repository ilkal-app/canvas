import { describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { ADA, sticky } from './__fixtures__/sticky-board.js';
import { restoreCached, restoreCachedInSteps } from './cache-restore.js';

const directly = (apply: () => Promise<void>): Promise<void> => apply();

/**
 * Two updates of one board: its first sticky, then a second one written after it.
 *
 * @returns The two updates, in order.
 */
function twoUpdates(): [Uint8Array, Uint8Array] {
  const writer = new YjsDocumentStore();
  writer.transact(ADA, (transaction) => {
    transaction.setObject(sticky('first'));
  });
  const first = writer.encodeState();
  const before = writer.encodeStateVector();
  writer.transact(ADA, (transaction) => {
    transaction.setObject(sticky('second', 1));
  });
  const second = writer.encodeState(before);
  writer.destroy();
  return [first, second];
}

describe('restoreCachedInSteps', () => {
  it('yields only inside the store when there is a snapshot and no tail', async () => {
    const [first] = twoUpdates();
    const store = new YjsDocumentStore();
    const yieldToBrowser = vi.fn(() => Promise.resolve());
    await restoreCachedInSteps(store, { snapshot: first, updates: [] }, yieldToBrowser, directly);
    expect(yieldToBrowser).toHaveBeenCalledTimes(2);
    expect(store.read().objects.size).toBe(1);
    store.destroy();
  });

  it('applies a merged tail alone when there is no snapshot', async () => {
    const store = new YjsDocumentStore();
    const yieldToBrowser = vi.fn(() => Promise.resolve());
    await restoreCachedInSteps(
      store,
      { snapshot: undefined, updates: twoUpdates() },
      yieldToBrowser,
      directly,
    );
    expect(yieldToBrowser).toHaveBeenCalledTimes(2);
    expect([...store.read().objects.keys()].sort()).toEqual(['first', 'second'] as ObjectId[]);
    store.destroy();
  });

  it('does nothing for an empty cache', async () => {
    const store = new YjsDocumentStore();
    const yieldToBrowser = vi.fn(() => Promise.resolve());
    await restoreCachedInSteps(
      store,
      { snapshot: undefined, updates: [] },
      yieldToBrowser,
      directly,
    );
    expect(yieldToBrowser).not.toHaveBeenCalled();
    store.destroy();
  });
});

describe('restoreCached', () => {
  it('applies a snapshot and its tail', () => {
    const [first, second] = twoUpdates();
    const store = new YjsDocumentStore();
    restoreCached(store, { snapshot: first, updates: [second] });
    expect(store.read().objects.size).toBe(2);
    store.destroy();
  });
});
