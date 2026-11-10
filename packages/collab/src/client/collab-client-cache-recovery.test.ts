import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';

import { ADA, sticky } from '../cache/__fixtures__/sticky-board.js';
import { MemoryCacheStorage, MemoryDocumentCache } from '../cache/memory-document-cache.js';
import { prefixDocumentCache } from '../cache/prefixed-document-cache.js';

import { BOARD, ClientHarness } from './__fixtures__/client-harness.js';
import { poisonedHistory } from './__fixtures__/poisoned-device.js';
import { EDITOR_CLAIMS, unsignedToken } from './__fixtures__/unsigned-token.js';

let harness: ClientHarness;
beforeEach(() => {
  harness = new ClientHarness();
});
afterEach(() => {
  harness.destroy();
});

async function poisonedCache() {
  const storage = new MemoryCacheStorage();
  const cache = new MemoryDocumentCache(storage);
  const history = poisonedHistory();
  const store = new YjsDocumentStore();
  store.transact(ADA, (tx) => {
    tx.setObject(sticky('offline'));
  });
  await cache.append(BOARD, history.fragment);
  await cache.append(BOARD, store.encodeState());
  await cache.append(BOARD, history.filler);
  store.destroy();
  return { cache, storage };
}

describe('automatic recovery lifecycle', () => {
  it('detaches persistence when recovery metadata cannot be read during open', async () => {
    const cache = new MemoryDocumentCache();
    const store = new YjsDocumentStore();
    const failure = new Error('Recovery metadata unavailable.');
    vi.spyOn(cache.recovery, 'retained').mockRejectedValueOnce(failure);
    const append = vi.spyOn(cache, 'append');
    await expect(harness.open({ cache, store })).rejects.toBe(failure);
    store.transact(ADA, (tx) => {
      tx.setObject(sticky('after-failed-open'));
    });
    expect(append).not.toHaveBeenCalled();
    store.destroy();
  });

  it('does not treat an already-poisoned supplied live store as a fresh recovery target', async () => {
    const history = poisonedHistory();
    const store = new YjsDocumentStore();
    expect(() => {
      store.applyUpdate(Y.mergeUpdates([history.fragment, history.filler]), SYSTEM_ORIGIN);
    }).toThrow();
    const client = await harness.connect({ store, cache: new MemoryDocumentCache() });
    expect(client.status.rejectionReason).toBe('unversioned');
    expect(client.recovery).toBeUndefined();
    expect(harness.relay.doc.getMap('objects').has(history.ghostId)).toBe(false);
    store.destroy();
  });

  it('a viewer retains and exports every source without resending its edits', async () => {
    const { cache } = await poisonedCache();
    harness.relay.isReadOnly = true;
    const client = await harness.connect({
      cache,
      token: unsignedToken({ ...EDITOR_CLAIMS, role: 'viewer' }),
    });
    await harness.settle();
    expect(client.status.state).toBe('connected');
    expect(client.recovery?.state.phase).toBe('retained');
    expect(client.recovery?.state.unresolvedRecordCount).toBeGreaterThan(0);
    expect(harness.relay.doc.getMap('objects').has('offline')).toBe(false);
    expect(
      (await client.recovery?.exportSources())?.[0]?.board.updates.length,
    ).toBeGreaterThanOrEqual(3);
    expect(await cache.recovery.retained(BOARD)).toEqual([]);
  });

  it('a quota failure publishes and uploads nothing, leaving original bytes exportable', async () => {
    const { cache } = await poisonedCache();
    const errors: unknown[] = [];
    vi.spyOn(cache.recovery, 'publish').mockRejectedValue(
      new DOMException('full', 'QuotaExceededError'),
    );
    const client = await harness.connect({ cache, onError: (error) => errors.push(error) });
    await harness.settle();
    expect(client.recovery?.state.phase).toBe('failed');
    expect(errors).toHaveLength(1);
    expect(harness.relay.doc.getMap('objects').has('offline')).toBe(false);
    expect(
      (await client.recovery?.exportSources())?.[0]?.board.updates.length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('a close after publication but before replay recovers the durable candidate on reopen', async () => {
    const { cache, storage } = await poisonedCache();
    const publish = cache.recovery.publish.bind(cache.recovery);
    let release: (() => void) | undefined;
    vi.spyOn(cache.recovery, 'publish').mockImplementation(async (...args) => {
      const isPublished = await publish(...args);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return isPublished;
    });
    const first = await harness.connect({ cache });
    await harness.settle();
    expect(release).toBeTypeOf('function');
    first.destroy();
    release?.();
    const second = await harness.connect({ cache: new MemoryDocumentCache(storage) });
    await harness.settle();
    expect(second.status.state).toBe('connected');
    expect(harness.relay.doc.getMap('objects').has('offline')).toBe(true);
    expect((await second.recovery?.exportSources())?.length).toBeGreaterThan(0);
  });

  it('a prefixed recovery never captures or replaces another signed-in owner', async () => {
    const cache = new MemoryDocumentCache();
    const a = prefixDocumentCache(cache, 'a/');
    const b = prefixDocumentCache(cache, 'b/');
    const empty = Y.encodeStateAsUpdate(new Y.Doc());
    await a.append(BOARD, empty);
    const capture = await a.recovery?.capture(BOARD);
    if (capture === undefined) throw new Error('missing recovery');
    expect(await a.recovery?.publish(BOARD, capture, empty)).toBe(true);
    expect(await b.recovery?.retained(BOARD)).toEqual([]);
    expect(await b.load(BOARD)).toEqual({ snapshot: undefined, updates: [] });
  });
});
