import { expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import { addStickies } from '../cache/__fixtures__/sticky-board.js';
import { MemoryDocumentCache } from '../cache/memory-document-cache.js';

import { BOARD, ClientHarness } from './__fixtures__/client-harness.js';

it('forwards renderer preparation into automatic acknowledged snapshot compaction', async () => {
  const harness = new ClientHarness();
  const store = new YjsDocumentStore();
  const cache = new MemoryDocumentCache();
  const prepare = vi.fn(() => Promise.resolve(new Uint8Array([42])));
  try {
    await harness.connect({ store, cache, compactEvery: 1, prepareSnapshotPreview: prepare });
    addStickies(store, 1);
    await harness.settle();
    await harness.advanceAndSettle(10000);
    expect(prepare).toHaveBeenCalled();
    expect((await cache.snapshotPreview.read(BOARD))?.bytes).toEqual(new Uint8Array([42]));
    expect((await cache.load(BOARD)).snapshot).toEqual(store.encodeState());
  } finally {
    harness.destroy();
    store.destroy();
    cache.close();
  }
});
