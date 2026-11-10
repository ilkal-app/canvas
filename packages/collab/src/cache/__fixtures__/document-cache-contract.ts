import { describe, expect, it } from 'vitest';

import type { CachedBoard, DocumentCache } from '../document-cache.js';

/** Opens connections to one fresh storage, as several tabs of one origin would. */
export type OpenCacheConnections = () => Promise<readonly [DocumentCache, DocumentCache]>;

const bytes = (...values: number[]) => new Uint8Array(values);
const EMPTY: CachedBoard = { snapshot: undefined, updates: [] };

/**
 * Registers the single-connection cases: loading, appending, compacting, failing, deleting.
 *
 * @param openConnections - Opens two connections to one fresh storage.
 */
function describeStorageCases(openConnections: OpenCacheConnections): void {
  it('loads nothing for a board it never stored', async () => {
    const [cache] = await openConnections();
    expect(await cache.load('board-1')).toEqual(EMPTY);
  });

  it("keeps each board's updates apart and in the order appended, as copies", async () => {
    const [writer, reader] = await openConnections();
    const first = bytes(1);
    await writer.append('board-1', first);
    await writer.append('board-2', bytes(9));
    await writer.append('board-1', bytes(2));
    first[0] = 7;
    expect(await reader.load('board-1')).toEqual({
      snapshot: undefined,
      updates: [bytes(1), bytes(2)],
    });
    expect(await reader.load('board-2')).toEqual({ snapshot: undefined, updates: [bytes(9)] });
  });

  it('compacts its own updates into a snapshot', async () => {
    const [cache, other] = await openConnections();
    await cache.append('board-1', bytes(1));
    await cache.append('board-1', bytes(2));
    expect(await cache.compact('board-1', bytes(1, 2))).toBe(true);
    expect(await other.load('board-1')).toEqual({ snapshot: bytes(1, 2), updates: [] });
  });

  it('keeps an update appended after a compaction was requested', async () => {
    const [cache, other] = await openConnections();
    await cache.append('board-1', bytes(1));
    const compacted = cache.compact('board-1', bytes(1));
    const appended = cache.append('board-1', bytes(2));
    await Promise.all([compacted, appended]);
    expect(await other.load('board-1')).toEqual({ snapshot: bytes(1), updates: [bytes(2)] });
  });

  it('deletes a board', async () => {
    const [cache, other] = await openConnections();
    await cache.append('board-1', bytes(1));
    await cache.compact('board-1', bytes(1));
    await cache.append('board-1', bytes(2));
    await cache.delete('board-1');
    expect(await other.load('board-1')).toEqual(EMPTY);
  });

  it('rejects requests once closed', async () => {
    const [cache] = await openConnections();
    cache.close();
    await expect(cache.load('board-1')).rejects.toThrow();
    await expect(cache.append('board-1', bytes(1))).rejects.toThrow();
    await expect(cache.readUpdates?.('board-1')).rejects.toThrow();
  });
}

/**
 * Registers the cases where several connections (tabs) share one storage.
 *
 * @param openConnections - Opens two connections to one fresh storage.
 */
function describeSharedStorageCases(openConnections: OpenCacheConnections): void {
  it("keeps another connection's updates it has not seen in the log", async () => {
    const [tabA, tabB] = await openConnections();
    await tabA.append('board-1', bytes(1));
    await tabB.append('board-1', bytes(2));
    expect(await tabA.compact('board-1', bytes(1))).toBe(true);
    expect(await tabB.load('board-1')).toEqual({ snapshot: bytes(1), updates: [bytes(2)] });
  });

  it('refuses to replace a snapshot another connection stored since, until it loads it', async () => {
    const [tabA, tabB] = await openConnections();
    await tabA.load('board-1');
    await tabB.append('board-1', bytes(5));
    expect(await tabB.compact('board-1', bytes(5))).toBe(true);
    await tabA.append('board-1', bytes(7));
    expect(await tabA.compact('board-1', bytes(7))).toBe(false);
    expect(await tabB.load('board-1')).toEqual({ snapshot: bytes(5), updates: [bytes(7)] });
    await tabA.load('board-1');
    expect(await tabA.compact('board-1', bytes(5, 7))).toBe(true);
    expect(await tabB.load('board-1')).toEqual({ snapshot: bytes(5, 7), updates: [] });
  });

  it('reads the log in append order without the snapshot and without seeing it', async () => {
    const [tabA, tabB] = await openConnections();
    expect(await tabA.readUpdates?.('board-1')).toEqual([]);
    await tabA.append('board-1', bytes(1));
    expect(await tabA.compact('board-1', bytes(1))).toBe(true);
    await tabA.append('board-1', bytes(2));
    await tabB.append('board-1', bytes(3));
    await tabB.append('board-2', bytes(9));
    expect(await tabA.readUpdates?.('board-1')).toEqual([bytes(2), bytes(3)]);
    // Read, not loaded: tab A's compaction keeps tab B's update for tab B.
    expect(await tabA.compact('board-1', bytes(1, 2))).toBe(true);
    expect(await tabB.load('board-1')).toEqual({ snapshot: bytes(1, 2), updates: [bytes(3)] });
  });
}

/**
 * The behaviour every {@link DocumentCache} implementation shares, as a test suite: the memory
 * cache and the IndexedDB cache both run it.
 *
 * @param name - The implementation's name, for the suite title.
 * @param openConnections - Opens two connections to one fresh storage.
 */
export function describeDocumentCacheContract(
  name: string,
  openConnections: OpenCacheConnections,
): void {
  describe(`${name} (DocumentCache contract)`, () => {
    describeStorageCases(openConnections);
    describeSharedStorageCases(openConnections);
  });
}
