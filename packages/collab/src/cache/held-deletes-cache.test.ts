// Fix round 1: a remote deletion the store holds back while structs are pending must
// reach the device cache's update log, so a reopen before the next compaction cannot bring the
// deleted value back once the missing update arrives.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';

import { addStickies } from './__fixtures__/sticky-board.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import { MemoryCacheStorage, MemoryDocumentCache } from './memory-document-cache.js';

/**
 * Reads a sticky's `extension` key from a store's persistence bytes (which carry held deletions;
 * call it once nothing is pending).
 *
 * @param store - The store.
 * @param id - The sticky's id.
 * @returns The key's value, or `undefined` when the key is gone.
 */
function extensionOf(store: YjsDocumentStore, id: string): unknown {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, store.encodeState());
  const value = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('extension');
  doc.destroy();
  return value;
}

describe('a deletion held while structs are pending, in the device cache', () => {
  it.each([
    ['a delete-only update', false],
    ['an update mixing it with other content, while a listener throws (fix round 2)', true],
  ] as const)('stays deleted after a reopen from the update log: %s', async (label, isMixed) => {
    const author = new YjsDocumentStore();
    const [id] = addStickies(author, 1);
    if (id === undefined) throw new Error('expected a sticky');
    // A peer's raw document: a retained extra key on the sticky, then two text updates, then the
    // key's deletion.
    const peer = new Y.Doc();
    peer.clientID = 77;
    Y.applyUpdate(peer, author.encodeState());
    const sticky = peer.getMap('objects').get(id) as Y.Map<unknown>;
    const stepFrom = (write: () => void): Uint8Array => {
      const before = Y.encodeStateVector(peer);
      write();
      return Y.encodeStateAsUpdate(peer, before);
    };
    const extension = stepFrom(() => sticky.set('extension', 'kept'));
    const missing = stepFrom(() => {
      peer.getText('note').insert(0, 'a');
    });
    const gapped = stepFrom(() => {
      peer.getText('note').insert(1, 'b');
    });
    const deletion = stepFrom(() => {
      sticky.delete('extension');
    });

    const storage = new MemoryCacheStorage();
    const device = new YjsDocumentStore();
    const binding = await DocumentCacheBinding.open({
      store: device,
      cache: new MemoryDocumentCache(storage),
      boardId: 'board',
    });
    for (const update of [author.encodeState(), extension, gapped]) {
      device.applyUpdate(update, SYSTEM_ORIGIN);
    }
    expect(device.hasPendingStructs).toBe(true);
    await binding.compact();
    if (isMixed) {
      // Content another writer adds, which integrates at once, delivered with the deletion.
      const other = new Y.Doc();
      other.clientID = 88;
      other.getText('other').insert(0, 'x');
      const mixed = Y.mergeUpdates([deletion, Y.encodeStateAsUpdate(other)]);
      other.destroy();
      const stop = device.subscribeUpdates(() => {
        throw new Error('listener failed');
      });
      expect(() => {
        device.applyUpdate(mixed, SYSTEM_ORIGIN);
      }).toThrow('listener failed');
      stop();
    } else {
      device.applyUpdate(deletion, SYSTEM_ORIGIN);
    }
    expect(label.length).toBeGreaterThan(0);
    await binding.flush();

    const reopened = new YjsDocumentStore();
    const reopenedBinding = await DocumentCacheBinding.open({
      store: reopened,
      cache: new MemoryDocumentCache(storage),
      boardId: 'board',
    });
    expect(reopened.hasPendingStructs).toBe(true);
    for (const store of [device, reopened]) store.applyUpdate(missing, SYSTEM_ORIGIN);
    expect(device.hasPendingStructs).toBe(false);
    expect(reopened.hasPendingStructs).toBe(false);
    expect(extensionOf(device, id)).toBeUndefined();
    expect(extensionOf(reopened, id)).toBeUndefined();

    for (const each of [binding, reopenedBinding]) each.destroy();
    for (const store of [author, device, reopened]) store.destroy();
    peer.destroy();
  });
});
