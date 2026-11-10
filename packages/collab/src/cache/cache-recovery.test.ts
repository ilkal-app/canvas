import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import type { DocumentCache, CacheRecoveryStorage } from './document-cache.js';
import { openIndexedDbCache } from './indexeddb-cache.js';
import { MemoryCacheStorage, MemoryDocumentCache } from './memory-document-cache.js';

/**
 * Requires the capability under test.
 *
 * @param cache - Cache being tested.
 * @returns The required recovery capability.
 * @throws {Error} When the capability is absent.
 */
function recoveryOf(cache: DocumentCache): CacheRecoveryStorage {
  if (cache.recovery === undefined) throw new Error('Recovery capability missing.');
  return cache.recovery;
}

const bytes = (...values: number[]) => new Uint8Array(values);
const factories = {
  memory: () => {
    const storage = new MemoryCacheStorage();
    return () => Promise.resolve(new MemoryDocumentCache(storage));
  },
  indexeddb: () => {
    const factory = new IDBFactory();
    return () => openIndexedDbCache({ factory });
  },
};

for (const [name, factory] of Object.entries(factories)) {
  describe(`${name} recovery generations`, () => {
    it('publishes atomically while retaining old snapshots, tails and later old-tab writes', async () => {
      const open: () => Promise<DocumentCache> = factory();
      const writer = await open();
      const recovery = await open();
      await writer.append('b', bytes(1));
      await writer.compact('b', bytes(1));
      await writer.append('b', bytes(2));
      const captured = await recoveryOf(recovery).capture('b');
      expect(await recoveryOf(recovery).publish('b', captured, bytes(8))).toBe(true);
      await writer.append('b', bytes(3));
      expect(await writer.compact('b', bytes(1, 2, 3))).toBe(false);
      expect(await writer.load('b')).toEqual({ snapshot: bytes(1), updates: [bytes(2), bytes(3)] });
      const fresh = await open();
      expect(await fresh.load('b')).toEqual({ snapshot: bytes(8), updates: [] });
      expect(await recoveryOf(fresh).retained('b')).toEqual([
        expect.objectContaining({
          generation: 0,
          board: { snapshot: bytes(1), updates: [bytes(2), bytes(3)] },
        }),
      ]);
      await recovery.append('b', bytes(9));
      expect(await fresh.load('b')).toEqual({ snapshot: bytes(8), updates: [bytes(9)] });
    });

    it('preserves manual archive policy across later writes, publication and compaction', async () => {
      const open: () => Promise<DocumentCache> = factory();
      const writer = await open();
      const publisher = await open();
      await writer.append('b', bytes(1));
      const recovery = recoveryOf(publisher);
      expect(await recovery.publish('b', await recovery.capture('b'), bytes(2), 'manual')).toBe(
        true,
      );
      await writer.append('b', bytes(3));
      await publisher.compact('b', bytes(2));
      expect(await recovery.publish('b', await recovery.capture('b'), bytes(4))).toBe(true);
      const retained = await recoveryOf(await open()).retained('b');
      expect(retained[0]).toMatchObject({
        replayPolicy: 'manual',
        board: { updates: [bytes(1), bytes(3)] },
      });
    });

    it('rejects a disappeared bound generation after an explicit board deletion', async () => {
      const open: () => Promise<DocumentCache> = factory();
      const publisher = await open();
      const deleting = await open();
      await publisher.append('b', bytes(1));
      const recovery = recoveryOf(publisher);
      await recovery.publish('b', await recovery.capture('b'), bytes(2));
      await deleting.delete('b');
      await expect(publisher.load('b')).rejects.toThrow('generation');
      expect(await (await open()).load('b')).toEqual({ snapshot: undefined, updates: [] });
    });

    it('refuses stale captures after concurrent append or compaction without losing bytes', async () => {
      const open: () => Promise<DocumentCache> = factory();
      const a = await open();
      const b = await open();
      await a.append('b', bytes(1));
      const first = await recoveryOf(a).capture('b');
      await b.append('b', bytes(2));
      expect(await recoveryOf(a).publish('b', first, bytes(8))).toBe(false);
      await b.load('b');
      const second = await recoveryOf(a).capture('b');
      await b.compact('b', bytes(1, 2));
      expect(await recoveryOf(a).publish('b', second, bytes(8))).toBe(false);
      expect(await (await open()).load('b')).toEqual({ snapshot: bytes(1, 2), updates: [] });
    });

    it('isolates boards and successive generations, and returns independent byte copies', async () => {
      const open: () => Promise<DocumentCache> = factory();
      const a = await open();
      await a.append('other', bytes(7));
      await a.append('b', bytes(1));
      const first = await recoveryOf(a).capture('b');
      const original = first.board.updates[0];
      if (original === undefined) throw new Error('Missing captured update.');
      original[0] = 99;
      const snapshot = bytes(2);
      expect(await recoveryOf(a).publish('b', first, snapshot)).toBe(true);
      snapshot[0] = 99;
      const second = await recoveryOf(a).capture('b');
      expect(await recoveryOf(a).publish('b', second, bytes(3))).toBe(true);
      expect(await recoveryOf(a).publish('b', second, bytes(4))).toBe(false);
      expect((await recoveryOf(a).retained('b')).map((item) => item.board)).toEqual([
        { snapshot: undefined, updates: [bytes(1)] },
        { snapshot: bytes(2), updates: [] },
      ]);
      expect(await (await open()).load('b')).toEqual({ snapshot: bytes(3), updates: [] });
      expect(await a.load('other')).toEqual({ snapshot: undefined, updates: [bytes(7)] });
    });
  });
}
