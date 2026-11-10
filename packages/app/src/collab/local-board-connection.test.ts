import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryCacheStorage, MemoryDocumentCache, type DocumentCache } from '@canvas/collab';
import { DOCUMENT_LAYOUT_VERSION, YjsDocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { createDemoBoard } from '../engine/demo-board.js';
import { LOCAL_USER_ORIGIN } from '../engine/demo-document.js';

import { FakeEarlierLayouts, withEarlierLayouts } from './__fixtures__/fake-earlier-layouts.js';
import type { BoardConnection } from './board-connection.js';
import {
  createLocalBoardConnection,
  type LocalBoardConnectionOptions,
} from './local-board-connection.js';

const DEMO_SIZE = createDemoBoard().length;
const MARKER = (createDemoBoard()[1]?.id ?? '') as ObjectId;
/** A layout after this build's, which no converter reaches. */
const FUTURE_LAYOUT = DOCUMENT_LAYOUT_VERSION + 1;

const opened: BoardConnection[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const connection of opened.splice(0)) connection.destroy();
});

/**
 * Opens a local board, destroyed after the test.
 *
 * @param boardId - The board.
 * @param options - The cache and error handler.
 * @returns The connection.
 */
async function openLocal(
  boardId: string,
  options: LocalBoardConnectionOptions,
): Promise<BoardConnection> {
  const connection = await createLocalBoardConnection(boardId, options);
  opened.push(connection);
  return connection;
}

/**
 * A cache over shared storage, as each page load opens its own connection to one database.
 *
 * @param storage - The device's storage.
 * @returns The cache opener.
 */
function cacheOn(storage: MemoryCacheStorage): () => Promise<DocumentCache> {
  return () => Promise.resolve(new MemoryDocumentCache(storage));
}

/**
 * Moves an object as the local user.
 *
 * @param connection - The board.
 * @param id - The object.
 * @param x - Its new x, in world units.
 */
function moveTo(connection: BoardConnection, id: ObjectId, x: number): void {
  connection.store.transact(connection.origin, (transaction) => {
    const object = connection.store.get(id);
    if (object !== undefined) transaction.setObject({ ...object, x });
  });
}

/**
 * Waits for the cache writes requested so far (the memory cache answers in a microtask).
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('createLocalBoardConnection', () => {
  it('seeds a board never written with the demo board, edited as the local user and saved', async () => {
    const connection = await openLocal('demo', { openCache: cacheOn(new MemoryCacheStorage()) });
    expect(connection.store.read().objects.size).toBe(DEMO_SIZE);
    expect(connection.origin).toBe(LOCAL_USER_ORIGIN);
    expect(connection.status()).toEqual({
      boardId: 'demo',
      state: 'offline',
      isLocalOnly: true,
      isSavedOnDevice: true,
      pendingUpdateCount: 0,
      isAcknowledged: false,
      isReadOnly: false,
      rejectionReason: undefined,
      collaborators: [],
      strandedEdits: [],
    });
  });

  it('keeps edits across a reload: the next load restores the board instead of seeding it', async () => {
    const storage = new MemoryCacheStorage();
    const first = await createLocalBoardConnection('demo', { openCache: cacheOn(storage) });
    moveTo(first, MARKER, 400);
    await settle();
    first.destroy();
    const reloaded = await openLocal('demo', { openCache: cacheOn(storage) });
    expect(reloaded.store.get(MARKER)?.x).toBe(400);
    expect(reloaded.store.read().objects.size).toBe(DEMO_SIZE);
  });

  it("exposes the cache's pending writes from an edit until it is stored", async () => {
    const connection = await openLocal('demo', { openCache: cacheOn(new MemoryCacheStorage()) });
    await connection.cacheWrites?.settled();
    expect(connection.cacheWrites?.isPending).toBe(false);
    moveTo(connection, MARKER, 400);
    expect(connection.cacheWrites?.isPending).toBe(true);
    await connection.cacheWrites?.settled();
    expect(connection.cacheWrites?.isPending).toBe(false);
    const unsaved = await openLocal('demo', { openCache: () => Promise.resolve(undefined) });
    expect(unsaved.cacheWrites).toBeUndefined();
  });

  it('keys the cache by board id: another board is its own', async () => {
    const storage = new MemoryCacheStorage();
    const first = await openLocal('plan', { openCache: cacheOn(storage) });
    moveTo(first, MARKER, 400);
    await settle();
    const other = await openLocal('retro', { openCache: cacheOn(storage) });
    expect(other.store.get(MARKER)?.x).not.toBe(400);
  });

  it('leaves a board someone cleared empty on the next load', async () => {
    const storage = new MemoryCacheStorage();
    const first = await createLocalBoardConnection('demo', { openCache: cacheOn(storage) });
    const store = first.store as YjsDocumentStore;
    store.transact(first.origin, (transaction) => {
      for (const id of store.read().objects.keys()) transaction.deleteObject(id);
    });
    await settle();
    first.destroy();
    const reloaded = await openLocal('demo', { openCache: cacheOn(storage) });
    expect(reloaded.store.read().objects.size).toBe(0);
  });

  it('works in memory and says it is not saved when the cache fails to open', async () => {
    const onError = vi.fn();
    const connection = await openLocal('demo', {
      openCache: () => Promise.reject(new DOMException('blocked', 'InvalidStateError')),
      onError,
    });
    expect(onError).toHaveBeenCalledWith(new DOMException('blocked', 'InvalidStateError'));
    expect(connection.store.read().objects.size).toBe(DEMO_SIZE);
    expect(connection.status()).toMatchObject({ isLocalOnly: true, isSavedOnDevice: false });
    moveTo(connection, MARKER, 400);
    expect(connection.store.get(MARKER)?.x).toBe(400);
  });

  it('works in memory, closing the cache, when the cached board cannot be read', async () => {
    const cache = new MemoryDocumentCache();
    vi.spyOn(cache, 'load').mockRejectedValue(new Error('corrupt'));
    const close = vi.spyOn(cache, 'close');
    const onError = vi.fn();
    const connection = await openLocal('demo', {
      openCache: () => Promise.resolve(cache),
      onError,
    });
    expect(onError).toHaveBeenCalledWith(new Error('corrupt'));
    expect(close).toHaveBeenCalledOnce();
    expect(connection.status().isSavedOnDevice).toBe(false);
    expect(connection.store.read().objects.size).toBe(DEMO_SIZE);
  });

  it('reports a failing cache to the page as an uncaught error when no handler is given', async () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const failure = new DOMException('blocked', 'InvalidStateError');
    const connection = await openLocal('demo', { openCache: () => Promise.reject(failure) });
    expect(reportError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(connection.status().isSavedOnDevice).toBe(false);
  });

  it('opens no cache where there is no IndexedDB, and reports nothing', async () => {
    const onError = vi.fn();
    const connection = await openLocal('demo', { onError });
    expect(onError).not.toHaveBeenCalled();
    expect(connection.status().isSavedOnDevice).toBe(false);
  });
});

/**
 * A board an earlier layout's build cached on this device: one demo object, as one update.
 *
 * @returns The cached board.
 */
function earlierCopy(): { readonly snapshot: undefined; readonly updates: Uint8Array[] } {
  const store = new YjsDocumentStore({ clientId: 77 });
  store.transact(LOCAL_USER_ORIGIN, (transaction) => {
    transaction.setObject({ ...createDemoBoard()[1], id: MARKER } as Parameters<
      typeof transaction.setObject
    >[0]);
  });
  const update = store.encodeState();
  store.destroy();
  return { snapshot: undefined, updates: [update] };
}

describe('createLocalBoardConnection and compaction', () => {
  /**
   * Makes 600 edits on a fresh local board and lets due compactions run.
   *
   * @param options - The connection's options, with the cache's storage.
   * @param storage - The storage.
   * @returns The board's cached snapshot, if any.
   */
  async function editAndCompact(
    options: LocalBoardConnectionOptions,
    storage: MemoryCacheStorage,
  ): Promise<unknown> {
    const connection = await openLocal('board-compact', {
      ...options,
      openCache: cacheOn(storage),
    });
    for (let index = 0; index < 600; index += 1) moveTo(connection, MARKER, index);
    for (let round = 0; round < 5; round += 1) await settle();
    return storage.board('board-compact').snapshot;
  }

  it('holds compactions on the fallback of a configured relay, so every edit stays a record', async () => {
    const storage = new MemoryCacheStorage();
    expect(await editAndCompact({ shouldHoldCompaction: true }, storage)).toBeUndefined();
    expect(storage.board('board-compact').updates.size).toBeGreaterThanOrEqual(600);
  });

  it('compacts as usual on a board with no relay configured', async () => {
    const storage = new MemoryCacheStorage();
    expect(await editAndCompact({}, storage)).toBeDefined();
  });
});

describe('createLocalBoardConnection after a layout bump', () => {
  it('carries a board only an earlier layout cached into the store, before any seeding', async () => {
    const earlier = new FakeEarlierLayouts(2);
    earlier.put(1, 'demo', earlierCopy());
    const connection = await openLocal('demo', {
      openCache: () => Promise.resolve(withEarlierLayouts(new MemoryDocumentCache(), earlier)),
    });
    expect(connection.store.read().objects.size).toBe(1);
    expect(connection.store.get(MARKER)).toBeDefined();
    expect(connection.status().strandedEdits).toEqual([]);
    expect(await earlier.find('demo')).toEqual([]);
  });

  it('reports what it cannot carry until the person dismisses it', async () => {
    // The bump after this build's layout is a future one with no registered converter.
    const earlier = new FakeEarlierLayouts(FUTURE_LAYOUT);
    earlier.put(DOCUMENT_LAYOUT_VERSION, 'demo', earlierCopy());
    const connection = await openLocal('demo', {
      openCache: () => Promise.resolve(withEarlierLayouts(new MemoryDocumentCache(), earlier)),
      shouldSeedDemoBoard: false,
    });
    expect(connection.store.read().objects.size).toBe(0);
    expect(connection.status().strandedEdits).toEqual([
      {
        boardId: 'demo',
        source: `fake:layout:${String(DOCUMENT_LAYOUT_VERSION)}`,
        fromLayoutVersion: DOCUMENT_LAYOUT_VERSION,
        toLayoutVersion: FUTURE_LAYOUT,
        unsentChangeCount: 1,
      },
    ]);
    const listener = vi.fn();
    const stop = connection.subscribe(listener);
    connection.dismissStrandedEdits(`fake:layout:${String(DOCUMENT_LAYOUT_VERSION)}`);
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledOnce();
    });
    expect(connection.status().strandedEdits).toEqual([]);
    expect(await earlier.find('demo')).toEqual([]);
    stop();
  });

  it('has nothing to carry or dismiss without a cache', async () => {
    const connection = await openLocal('demo', { openCache: () => Promise.resolve(undefined) });
    expect(connection.status().strandedEdits).toEqual([]);
    connection.dismissStrandedEdits('fake:layout:2');
  });
});

describe('createLocalBoardConnection for a person who may only view', () => {
  it('says so, and runs the store’s automatic repairs read-only', async () => {
    const setRepairMode = vi.spyOn(YjsDocumentStore.prototype, 'setRepairMode');
    try {
      const connection = await openLocal('viewer-board', {
        openCache: () => Promise.resolve(undefined),
        shouldSeedDemoBoard: false,
        isReadOnly: true,
      });
      expect(connection.status()).toMatchObject({ isLocalOnly: true, isReadOnly: true });
      expect(setRepairMode.mock.contexts).toContain(connection.store);
      expect(setRepairMode).toHaveBeenCalledWith('read-only');
    } finally {
      setRepairMode.mockRestore();
    }
  });

  it('reports an earlier layout’s copy and carries none of it into the store', async () => {
    const earlier = new FakeEarlierLayouts(2);
    earlier.put(1, 'demo', earlierCopy());
    const connection = await openLocal('demo', {
      openCache: () => Promise.resolve(withEarlierLayouts(new MemoryDocumentCache(), earlier)),
      shouldSeedDemoBoard: false,
      isReadOnly: true,
    });
    expect(connection.store.read().objects.size).toBe(0);
    expect(connection.status().strandedEdits).toEqual([
      expect.objectContaining({ boardId: 'demo', fromLayoutVersion: 1, toLayoutVersion: 2 }),
    ]);
    expect(await earlier.find('demo')).not.toEqual([]);
  });
});
