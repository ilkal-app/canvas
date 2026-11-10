import { expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import { ManualTime } from '../presence/__fixtures__/manual-time.js';

import { addStickies } from './__fixtures__/sticky-board.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import { MemoryCacheStorage, MemoryDocumentCache } from './memory-document-cache.js';

it('does not restore or endlessly compact a generation another tab retained for recovery', async () => {
  const storage = new MemoryCacheStorage();
  const cache = new MemoryDocumentCache(storage);
  const publisher = new MemoryDocumentCache(storage);
  const store = new YjsDocumentStore();
  const peer = new YjsDocumentStore();
  const time = new ManualTime();
  const errors: unknown[] = [];
  const binding = await DocumentCacheBinding.open({
    store,
    cache,
    boardId: 'board',
    idleScheduler: time,
    idleTimeoutMs: 1,
    onError: (error) => errors.push(error),
  });
  try {
    addStickies(store, 1);
    await binding.flush();
    addStickies(peer, 1, { seed: 99 });
    // Old bytes may include content this live store never saw; recovery retains them verbatim.
    await cache.append('board', peer.encodeState());
    const captured = await publisher.recovery.capture('board');
    const freshSnapshot = store.encodeState();
    expect(await publisher.recovery.publish('board', captured, freshSnapshot)).toBe(true);
    const load = vi.spyOn(cache, 'load');
    const compact = vi.spyOn(cache, 'compact');
    const attempt = binding.compact();
    time.advanceBy(1);
    await attempt;
    expect(load).not.toHaveBeenCalled();
    expect(time.pendingTaskCount).toBe(0);
    expect(store.read().objects.size).toBe(1);
    expect(errors).toEqual([]);
    time.advanceBy(100);
    expect(compact).toHaveBeenCalledTimes(1);
    addStickies(store, 1, { seed: 17 });
    await binding.flush();
    const retained = await publisher.recovery.retained('board');
    expect(retained[0]?.board.updates).toHaveLength(captured.board.updates.length + 1);
    expect(await new MemoryDocumentCache(storage).load('board')).toEqual({
      snapshot: freshSnapshot,
      updates: [],
    });
  } finally {
    binding.destroy();
    store.destroy();
    peer.destroy();
  }
});

it('still reloads and retries an ordinary custom cache conflict without recovery support', async () => {
  const store = new YjsDocumentStore();
  const time = new ManualTime();
  const load = vi.fn().mockResolvedValue({ snapshot: undefined, updates: [] });
  const compact = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const binding = await DocumentCacheBinding.open({
    store,
    boardId: 'board',
    cache: {
      load,
      compact,
      append: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      close: () => undefined,
    },
    idleScheduler: time,
    idleTimeoutMs: 1,
  });
  try {
    const attempt = binding.compact();
    time.advanceBy(1);
    await attempt;
    expect(load).toHaveBeenCalledTimes(2);
    expect(time.pendingTaskCount).toBe(1);
    time.advanceBy(1);
    await binding.flush();
    expect(compact).toHaveBeenCalledTimes(2);
    expect(time.pendingTaskCount).toBe(0);
  } finally {
    binding.destroy();
    store.destroy();
  }
});
