import { Buffer } from 'node:buffer';

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import type { DocumentCache } from './document-cache.js';
import { openIndexedDbCache } from './indexeddb-cache.js';
import { MemoryCacheStorage, MemoryDocumentCache } from './memory-document-cache.js';

const bytes = (...values: number[]) => new Uint8Array(values);
const BOARD = 'preview-board';
const factories = [
  {
    name: 'memory',
    open: (): Promise<readonly [DocumentCache, DocumentCache]> => {
      const storage = new MemoryCacheStorage();
      return Promise.resolve([new MemoryDocumentCache(storage), new MemoryDocumentCache(storage)]);
    },
  },
  {
    name: 'IndexedDB',
    open: async (): Promise<readonly [DocumentCache, DocumentCache]> => {
      const factory = new IDBFactory();
      return [await openIndexedDbCache({ factory }), await openIndexedDbCache({ factory })];
    },
  },
];

function previews(cache: DocumentCache) {
  if (cache.snapshotPreview === undefined) throw new Error('Missing preview capability');
  return cache.snapshotPreview;
}

for (const factory of factories) {
  describe(`${factory.name} snapshot preview`, () => {
    it('stores a preview with its snapshot while keeping unseen and later updates', async () => {
      const [writer, other] = await factory.open();
      await writer.append(BOARD, bytes(1));
      await other.append(BOARD, bytes(2));
      const compacted = previews(writer).compact(BOARD, bytes(1), bytes(9));
      const later = writer.append(BOARD, bytes(3));
      expect(await compacted).toBe(true);
      await later;
      expect(await previews(other).read(BOARD)).toEqual({
        snapshotVersion: 1,
        bytes: bytes(9),
      });
      expect(await other.load(BOARD)).toEqual({
        snapshot: bytes(1),
        updates: [bytes(2), bytes(3)],
      });
      writer.close();
      other.close();
    });

    it('fences old-generation previews and retains recovery sources through later compaction', async () => {
      const [writer, oldTab] = await factory.open();
      try {
        await writer.load(BOARD);
        expect(await previews(writer).compact(BOARD, bytes(1), bytes(9))).toBe(true);
        await oldTab.load(BOARD);
        const recovery = writer.recovery;
        if (recovery === undefined) throw new Error('Missing recovery capability');
        const capture = await recovery.capture(BOARD);
        expect(await recovery.publish(BOARD, capture, bytes(2))).toBe(true);
        expect(await previews(writer).read(BOARD)).toBeUndefined();
        expect(await previews(writer).compact(BOARD, bytes(3), bytes(8))).toBe(true);
        expect(await previews(oldTab).read(BOARD)).toBeUndefined();
        expect(await previews(oldTab).compact(BOARD, bytes(4), bytes(7))).toBe(false);
        const retained = await recovery.retained(BOARD);
        expect(retained).toHaveLength(1);
        expect(retained[0]?.board.snapshot).toEqual(bytes(1));
        expect(await writer.compact(BOARD, bytes(5))).toBe(true);
        expect(await previews(writer).read(BOARD)).toBeUndefined();
        expect(await recovery.retained(BOARD)).toEqual(retained);
      } finally {
        writer.close();
        oldTab.close();
      }
    });

    it('owns Buffer inputs whose slice method returns a borrowed view', async () => {
      const [writer, reader] = await factory.open();
      const snapshot = Buffer.from([1]);
      const preview = Buffer.from([9]);
      const pending = previews(writer).compact(BOARD, snapshot, preview);
      snapshot[0] = 2;
      preview[0] = 8;
      expect(await pending).toBe(true);
      expect([...((await reader.load(BOARD)).snapshot ?? [])]).toEqual([1]);
      expect([...((await previews(reader).read(BOARD))?.bytes ?? [])]).toEqual([9]);
      writer.close();
      reader.close();
    });

    it('a preview-only read does not authorize replacing a snapshot', async () => {
      const [writer, other] = await factory.open();
      expect(await previews(writer).compact(BOARD, bytes(1), bytes(9))).toBe(true);
      expect(await previews(other).read(BOARD)).toBeDefined();
      expect(await previews(other).compact(BOARD, bytes(2), bytes(8))).toBe(false);
      expect(await other.compact(BOARD, bytes(2))).toBe(false);
      expect(await previews(writer).read(BOARD)).toEqual({
        snapshotVersion: 1,
        bytes: bytes(9),
      });
      writer.close();
      other.close();
    });

    it('owns input bytes before an asynchronous transaction and read output bytes', async () => {
      const [writer, other] = await factory.open();
      const snapshot = bytes(1);
      const preview = bytes(9);
      const compacted = previews(writer).compact(BOARD, snapshot, preview);
      snapshot[0] = 3;
      preview[0] = 4;
      expect(await compacted).toBe(true);
      const result = await previews(other).read(BOARD);
      expect(result).toEqual({ snapshotVersion: 1, bytes: bytes(9) });
      if (result === undefined) throw new Error('Expected stored preview');
      result.bytes[0] = 5;
      expect(await previews(writer).read(BOARD)).toEqual({
        snapshotVersion: 1,
        bytes: bytes(9),
      });
      const loaded = await other.load(BOARD);
      expect(loaded.snapshot).toEqual(bytes(1));
      if (loaded.snapshot === undefined) throw new Error('Expected snapshot');
      loaded.snapshot[0] = 6;
      expect((await writer.load(BOARD)).snapshot).toEqual(bytes(1));
      writer.close();
      other.close();
    });

    it('ordinary compaction clears the old preview and deletion removes both', async () => {
      const [writer, other] = await factory.open();
      expect(await previews(other).read(BOARD)).toBeUndefined();
      await previews(writer).compact(BOARD, bytes(1), bytes(9));
      expect(await writer.compact(BOARD, bytes(2))).toBe(true);
      expect(await previews(other).read(BOARD)).toBeUndefined();
      await previews(writer).compact(BOARD, bytes(3), bytes(8));
      await writer.delete(BOARD);
      expect(await previews(other).read(BOARD)).toBeUndefined();
      expect(await other.load(BOARD)).toEqual({ snapshot: undefined, updates: [] });
      writer.close();
      other.close();
    });

    it('refuses preview operations after close', async () => {
      const [writer, other] = await factory.open();
      writer.close();
      await expect(previews(writer).read(BOARD)).rejects.toThrow();
      await expect(previews(writer).compact(BOARD, bytes(1), bytes(9))).rejects.toThrow();
      other.close();
    });
  });
}
