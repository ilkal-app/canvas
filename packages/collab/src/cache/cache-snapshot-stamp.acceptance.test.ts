import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { DocumentCacheBinding, snapshotDigest, type SnapshotStamp } from '@canvas/collab';
import { DOCUMENT_LAYOUT_VERSION, YjsDocumentStore } from '@canvas/document';
import { SCHEMA_VERSION } from '@canvas/schema';

import { ADA, addStickies, sticky } from './__fixtures__/sticky-board.js';
import { CacheRestoreVersionError } from './cache-restore-version-error.js';
import { MemoryCacheStorage, MemoryDocumentCache } from './memory-document-cache.js';

const BOARD = 'snapshot-stamp';
const currentStamp = (snapshot: Uint8Array): SnapshotStamp => ({
  digest: snapshotDigest(snapshot),
  layoutVersion: DOCUMENT_LAYOUT_VERSION,
  schemaVersion: SCHEMA_VERSION,
});

function snapshotWithObject(id: string): Uint8Array {
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    transaction.setObject(sticky(id));
  });
  const snapshot = store.encodeState();
  store.destroy();
  return snapshot;
}

function withFutureMeta(snapshot: Uint8Array): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot);
  doc.getMap('meta').set('document', {
    layoutVersion: DOCUMENT_LAYOUT_VERSION + 1,
    schemaVersion: SCHEMA_VERSION + 1,
  });
  return Y.encodeStateAsUpdate(doc);
}

async function cacheWith(
  snapshot: Uint8Array,
  stamp?: SnapshotStamp,
): Promise<MemoryDocumentCache> {
  const cache = new MemoryDocumentCache();
  expect(await cache.compact(BOARD, snapshot, stamp)).toBe(true);
  return cache;
}

async function observedOpen(cache: MemoryDocumentCache): Promise<{
  store: YjsDocumentStore;
  trialApplications: number;
}> {
  const store = new YjsDocumentStore();
  // Capture the original method before the prototype spy replaces it.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const apply = YjsDocumentStore.prototype.applyUpdate;
  let trialApplications = 0;
  const spy = vi.spyOn(YjsDocumentStore.prototype, 'applyUpdate').mockImplementation(function (
    this: YjsDocumentStore,
    ...args: Parameters<YjsDocumentStore['applyUpdate']>
  ) {
    if (this !== store) trialApplications += 1;
    apply.apply(this, args);
  });
  try {
    const binding = await DocumentCacheBinding.open({ store, cache, boardId: BOARD });
    binding.destroy();
    return { store, trialApplications };
  } finally {
    spy.mockRestore();
  }
}

async function expectUnreadableCacheClean(cache: MemoryDocumentCache): Promise<void> {
  const store = new YjsDocumentStore();
  const before = store.encodeState();
  const apply = vi.spyOn(YjsDocumentStore.prototype, 'applyUpdate');
  try {
    await expect(
      DocumentCacheBinding.open({ store, cache, boardId: BOARD }),
    ).rejects.toBeInstanceOf(CacheRestoreVersionError);
    expect(apply.mock.contexts.some((context) => context !== store)).toBe(true);
  } finally {
    apply.mockRestore();
  }
  expect(store.read().objects.size).toBe(0);
  expect(store.encodeState()).toEqual(before);
  expect(() => {
    store.transact(ADA, (transaction) => {
      transaction.setObject(sticky('after'));
    });
  }).not.toThrow();
  store.destroy();
}

describe('snapshot stamps in memory cache', () => {
  it('keeps a stamp with its snapshot and tail, then clears it on unstamped replacement', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new MemoryDocumentCache(storage);
    const snapshot = snapshotWithObject('first');
    const stamp = currentStamp(snapshot);
    expect(await cache.compact(BOARD, snapshot, stamp)).toBe(true);
    expect((await new MemoryDocumentCache(storage).load(BOARD)).snapshotStamp).toEqual(stamp);
    await cache.append(BOARD, snapshotWithObject('tail'));
    expect((await new MemoryDocumentCache(storage).load(BOARD)).snapshotStamp).toEqual(stamp);
    expect(await cache.compact(BOARD, snapshotWithObject('second'))).toBe(true);
    expect((await new MemoryDocumentCache(storage).load(BOARD)).snapshotStamp).toBeUndefined();
  });
});

describe('DocumentCacheBinding snapshot stamp', () => {
  it('writes the digest and this build’s versions with a compacted snapshot', async () => {
    const cache = new MemoryDocumentCache();
    const compact = vi.spyOn(cache, 'compact');
    const store = new YjsDocumentStore();
    const binding = await DocumentCacheBinding.open({ store, cache, boardId: BOARD });
    addStickies(store, 2);
    await binding.compact();
    const snapshot = (await cache.load(BOARD)).snapshot;
    if (snapshot === undefined) throw new Error('Compaction did not store a snapshot.');
    expect(compact).toHaveBeenCalledWith(BOARD, snapshot, currentStamp(snapshot));
    expect((await cache.load(BOARD)).snapshotStamp).toEqual(currentStamp(snapshot));
    binding.destroy();
    store.destroy();
  });

  it('restores a trusted snapshot without applying it to a trial store', async () => {
    const snapshot = snapshotWithObject('trusted');
    const { store, trialApplications } = await observedOpen(
      await cacheWith(snapshot, currentStamp(snapshot)),
    );
    expect(trialApplications).toBe(0);
    expect(store.read().objects.has('trusted' as never)).toBe(true);
    store.destroy();
  });

  it('trials an old unstamped snapshot and protects the real store from an unreadable one', async () => {
    const snapshot = snapshotWithObject('old');
    const { store, trialApplications } = await observedOpen(await cacheWith(snapshot));
    expect(trialApplications).toBeGreaterThan(0);
    expect(store.read().objects.size).toBe(1);
    store.destroy();
    await expectUnreadableCacheClean(await cacheWith(withFutureMeta(snapshot)));
  });

  it('trials a digest mismatch and restores readable replacement bytes', async () => {
    const original = snapshotWithObject('original');
    const replacement = snapshotWithObject('replacement');
    const storage = new MemoryCacheStorage();
    const cache = new MemoryDocumentCache(storage);
    await cache.compact(BOARD, original, currentStamp(original));
    const stored = storage.board(BOARD).snapshot;
    if (stored === undefined) throw new Error('Missing snapshot.');
    storage.board(BOARD).snapshot = { ...stored, bytes: replacement };
    const { store, trialApplications } = await observedOpen(cache);
    expect(trialApplications).toBeGreaterThan(0);
    expect(store.read().objects.has('replacement' as never)).toBe(true);
    store.destroy();
    storage.board(BOARD).snapshot = { ...stored, bytes: withFutureMeta(original) };
    await expectUnreadableCacheClean(cache);
  });

  it.each([
    ['newer schema', (stamp: SnapshotStamp) => ({ ...stamp, schemaVersion: SCHEMA_VERSION + 1 })],
    [
      'unreadable layout',
      (stamp: SnapshotStamp) => ({ ...stamp, layoutVersion: DOCUMENT_LAYOUT_VERSION + 1 }),
    ],
    [
      'missing digest',
      (stamp: SnapshotStamp) =>
        ({
          layoutVersion: stamp.layoutVersion,
          schemaVersion: stamp.schemaVersion,
        }) as SnapshotStamp,
    ],
    [
      'wrong types',
      (stamp: SnapshotStamp) =>
        ({ ...stamp, layoutVersion: 'current' }) as unknown as SnapshotStamp,
    ],
  ])('trials a %s stamp for readable and unreadable bytes', async (stampName, alter) => {
    expect(stampName).toBeTruthy();
    const snapshot = snapshotWithObject('readable');
    const cache = await cacheWith(snapshot, alter(currentStamp(snapshot)));
    const { store, trialApplications } = await observedOpen(cache);
    expect(trialApplications).toBeGreaterThan(0);
    expect(store.read().objects.size).toBe(1);
    store.destroy();
    const invalid = withFutureMeta(snapshot);
    await expectUnreadableCacheClean(await cacheWith(invalid, alter(currentStamp(invalid))));
  });

  it('trials the snapshot with a tail from a newer writer and leaves the real store clean', async () => {
    const snapshot = snapshotWithObject('base');
    const cache = await cacheWith(snapshot, currentStamp(snapshot));
    const writer = new Y.Doc();
    writer.clientID = 9001;
    Y.applyUpdate(writer, snapshot);
    const before = Y.encodeStateVector(writer);
    writer.getMap('meta').set('document', {
      layoutVersion: DOCUMENT_LAYOUT_VERSION + 1,
      schemaVersion: SCHEMA_VERSION + 1,
    });
    writer.getMap('objects').set('future', new Y.Map(Object.entries(sticky('future'))));
    await cache.append(BOARD, Y.encodeStateAsUpdate(writer, before));
    await expectUnreadableCacheClean(cache);
  });
});
