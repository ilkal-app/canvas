import { afterEach, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import type { CollabStatus, CollabStatusListener } from '../client/collab-client-options.js';

import { ADA, sticky } from './__fixtures__/sticky-board.js';
import { CacheRecovery } from './cache-recovery.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import type { DocumentCache } from './document-cache.js';
import { MemoryDocumentCache } from './memory-document-cache.js';
import { prefixDocumentCache } from './prefixed-document-cache.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

async function setup(cache: DocumentCache = new MemoryDocumentCache()) {
  const source = new YjsDocumentStore();
  source.transact(ADA, (tx) => {
    tx.setObject(sticky('offline'));
  });
  await cache.append('board', source.encodeState());
  source.destroy();
  const store = new YjsDocumentStore();
  const binding = DocumentCacheBinding.attach({ store, cache, boardId: 'board' });
  const errors: unknown[] = [];
  const recovery = new CacheRecovery({
    store,
    cache,
    binding,
    boardId: 'board',
    isReplacementRequired: true,
    onError: (error) => {
      errors.push(error);
    },
  });
  const listeners = new Set<CollabStatusListener>();
  const connection = {
    status: {
      state: 'connecting',
      lastSyncedAt: undefined,
      pendingUpdateCount: 0,
      isReadOnly: false,
      isAcknowledged: false,
      rejectionReason: undefined,
    } as CollabStatus,
    subscribe(listener: CollabStatusListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stop = recovery.attach(connection, finish);
  cleanups.push(stop, () => {
    binding.destroy();
    store.destroy();
  });
  const connect = () => {
    connection.status = { ...connection.status, state: 'connected' };
    for (const listener of listeners) listener(connection.status);
  };
  return { recovery, store, cache, connection, connect, done, stop, errors };
}

it('notifies recovery observers and exposes durable publication before successful replay', async () => {
  const fixture = await setup();
  const listener = vi.fn();
  const stop = fixture.recovery.subscribe(listener);
  expect(fixture.recovery.isPublished).toBe(false);
  fixture.connect();
  await fixture.done;
  expect(fixture.recovery.isPublished).toBe(true);
  expect(fixture.store.read().objects.has('offline' as never)).toBe(true);
  expect(listener).toHaveBeenCalledTimes(3);
  stop();
  expect(fixture.errors).toEqual([]);
});

it('exports the old source even when publication finishes during the export read', async () => {
  const cache = new MemoryDocumentCache();
  const fixture = await setup(cache);
  const retained = cache.recovery.retained.bind(cache.recovery);
  vi.spyOn(cache.recovery, 'retained').mockImplementationOnce(async (board) => {
    const beforePublication = await retained(board);
    fixture.connect();
    await fixture.done;
    return beforePublication;
  });
  const exported = await fixture.recovery.exportSources();
  expect(fixture.recovery.isPublished).toBe(true);
  expect(
    exported.some(({ generation, board }) => generation === 0 && board.updates.length > 0),
  ).toBe(true);
});

it('does not duplicate a captured source when publication archives it before the next read', async () => {
  const cache = new MemoryDocumentCache();
  const fixture = await setup(cache);
  const capture = cache.recovery.capture.bind(cache.recovery);
  vi.spyOn(cache.recovery, 'capture').mockImplementationOnce(async (board) => {
    const beforePublication = await capture(board);
    fixture.connect();
    await fixture.done;
    return beforePublication;
  });
  const exported = await fixture.recovery.exportSources();
  expect(fixture.recovery.isPublished).toBe(true);
  expect(exported).toHaveLength(1);
  expect(exported[0]?.generation).toBe(0);
});

it('keeps a custom cache without generation support intact and reports the missing capability', async () => {
  const memory = new MemoryDocumentCache();
  const cache: DocumentCache = {
    load: memory.load.bind(memory),
    append: memory.append.bind(memory),
    compact: memory.compact.bind(memory),
    delete: memory.delete.bind(memory),
    close: memory.close.bind(memory),
  };
  const prefixed = prefixDocumentCache(cache, 'owner/');
  expect(prefixed.recovery).toBeUndefined();
  expect('readUpdates' in prefixed).toBe(false);
  const fixture = await setup(prefixed);
  fixture.connect();
  await fixture.done;
  expect(fixture.recovery.state.phase).toBe('failed');
  expect(fixture.errors).toHaveLength(1);
  expect(await fixture.recovery.exportSources()).toEqual([]);
  expect((await memory.load('owner/board')).updates).toHaveLength(1);
});

it('stops before publication when destroyed during capture', async () => {
  const cache = new MemoryDocumentCache();
  const fixture = await setup(cache);
  const capture = cache.recovery.capture.bind(cache.recovery);
  vi.spyOn(cache.recovery, 'capture').mockImplementation(async (board) => {
    const result = await capture(board);
    fixture.stop();
    return result;
  });
  const publish = vi.spyOn(cache.recovery, 'publish');
  fixture.connect();
  await fixture.done;
  expect(publish).not.toHaveBeenCalled();
  expect(fixture.store.read().objects.size).toBe(0);
  expect(await cache.recovery.retained('board')).toEqual([]);
});

it('refuses a stale capture and preserves concurrent source records', async () => {
  const cache = new MemoryDocumentCache();
  const fixture = await setup(cache);
  const publish = cache.recovery.publish.bind(cache.recovery);
  vi.spyOn(cache.recovery, 'publish').mockImplementation(async (...args) => {
    await cache.append('board', new Uint8Array([0, 0]));
    return publish(...args);
  });
  fixture.connect();
  await fixture.done;
  expect(fixture.recovery.state.phase).toBe('failed');
  expect(fixture.recovery.isPublished).toBe(false);
  expect(fixture.store.read().objects.size).toBe(0);
  expect((await cache.load('board')).updates).toHaveLength(2);
});

it.each(['before', 'after', 'role-change'] as const)(
  'does not replay after a transport or authorization change: %s',
  async (when) => {
    const cache = new MemoryDocumentCache();
    const fixture = await setup(cache);
    if (when === 'before') {
      const capture = cache.recovery.capture.bind(cache.recovery);
      vi.spyOn(cache.recovery, 'capture').mockImplementation(async (board) => {
        const result = await capture(board);
        fixture.connection.status = { ...fixture.connection.status, state: 'offline' };
        return result;
      });
    } else {
      const publish = cache.recovery.publish.bind(cache.recovery);
      vi.spyOn(cache.recovery, 'publish').mockImplementation(async (...args) => {
        const isPublished = await publish(...args);
        fixture.connection.status = {
          ...fixture.connection.status,
          state: when === 'role-change' ? 'connected' : 'offline',
          isReadOnly: when === 'role-change',
        };
        return isPublished;
      });
    }
    fixture.connect();
    await fixture.done;
    expect(fixture.recovery.state.phase).toBe('failed');
    expect(fixture.store.read().objects.size).toBe(0);
    expect((await fixture.recovery.exportSources()).length).toBeGreaterThan(0);
  },
);
