import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';

import { addStickies } from './__fixtures__/sticky-board.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import { openIndexedDbCache } from './indexeddb-cache.js';

/**
 * Reads pending history from persistence bytes without using document package internals.
 *
 * @param store - The cache-backed document.
 * @returns Its raw decoded document, owned by the caller.
 */
function persistedDoc(store: YjsDocumentStore): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, store.encodeState());
  return doc;
}

describe('pending recovery with concurrent IndexedDB tabs', () => {
  it('retains pending structs, pending deletes and both tabs edits through a stale compaction CAS', async () => {
    const factory = new IDBFactory();
    const firstCache = await openIndexedDbCache({ factory });
    const secondCache = await openIndexedDbCache({ factory });
    const thirdCache = await openIndexedDbCache({ factory });
    const writer = new Y.Doc();
    writer.getText('note').insert(0, 'a');
    const dependency = Y.encodeStateAsUpdate(writer);
    const vector = Y.encodeStateVector(writer);
    writer.getText('note').insert(1, 'b');
    const fragment = Y.encodeStateAsUpdate(writer, vector);
    const beforeDelete = Y.encodeStateVector(writer);
    writer.getText('note').delete(0, 1);
    const deletion = Y.encodeStateAsUpdate(writer, beforeDelete);
    await firstCache.append('board', Y.mergeUpdates([fragment, deletion]));
    const first = new YjsDocumentStore();
    const second = new YjsDocumentStore();
    const firstBinding = await DocumentCacheBinding.open({
      store: first,
      cache: firstCache,
      boardId: 'board',
    });
    const secondBinding = await DocumentCacheBinding.open({
      store: second,
      cache: secondCache,
      boardId: 'board',
    });
    addStickies(first, 1, { seed: 1 });
    addStickies(second, 1, { seed: 2 });
    await firstBinding.flush();
    await secondBinding.flush();
    // First's snapshot leaves the second tab's unseen log; second's CAS must reload it.
    await firstBinding.compact();
    await secondBinding.compact();
    await secondBinding.flush();
    const reopened = new YjsDocumentStore();
    const reopenedBinding = await DocumentCacheBinding.open({
      store: reopened,
      cache: thirdCache,
      boardId: 'board',
    });
    expect(reopened.read().objects.size).toBe(2);
    const persisted = persistedDoc(reopened);
    expect(persisted.store.pendingStructs).not.toBeNull();
    expect(persisted.store.pendingDs).not.toBeNull();
    const relay = new Y.Doc();
    Y.applyUpdate(relay, reopened.encodeSyncState());
    expect(relay.store.pendingStructs).toBeNull();
    expect(relay.store.pendingDs).not.toBeNull();
    expect(reopened.hasPendingStructs).toBe(true);
    reopened.applyUpdate(dependency, SYSTEM_ORIGIN);
    expect(reopened.hasPendingStructs).toBe(false);
    Y.applyUpdate(relay, reopened.encodeSyncState(Y.encodeStateVector(relay)));
    expect(relay.getText('note').toJSON()).toBe('b');
    expect(reopened.read().objects.size).toBe(2);
    await reopenedBinding.flush();
    for (const binding of [firstBinding, secondBinding, reopenedBinding]) binding.destroy();
    for (const cache of [firstCache, secondCache, thirdCache]) cache.close();
    for (const store of [first, second, reopened]) store.destroy();
    writer.destroy();
    persisted.destroy();
    relay.destroy();
  });
});
