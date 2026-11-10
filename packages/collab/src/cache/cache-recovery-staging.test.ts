import { afterEach, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import { ADA, sticky } from './__fixtures__/sticky-board.js';
import { buildRecoveryCandidate } from './cache-recovery-candidate.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import { MemoryDocumentCache } from './memory-document-cache.js';

afterEach(() => {
  vi.restoreAllMocks();
});

it('retains the original whole record if isolated candidate application fails', () => {
  const source = new YjsDocumentStore();
  source.transact(ADA, (tx) => {
    tx.setObject(sticky('offline'));
  });
  const record = source.encodeState();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- The fault injector calls the original with the actual store receiver.
  const apply = YjsDocumentStore.prototype.applyUpdate;
  vi.spyOn(YjsDocumentStore.prototype, 'applyUpdate').mockImplementation(function (
    this: YjsDocumentStore,
    update,
    origin,
  ) {
    if (update === record) throw new Error('Isolated application unavailable.');
    apply.call(this, update, origin);
  });
  const candidate = buildRecoveryCandidate(new Uint8Array([0, 0]), [record]);
  expect(candidate.updates).toEqual([]);
  expect(candidate.unresolved).toEqual([record]);
  source.destroy();
});

it('propagates an unexpected staging failure without mutating or retaining a binding to the live store', async () => {
  const source = new YjsDocumentStore();
  source.transact(ADA, (tx) => {
    tx.setObject(sticky('cached'));
  });
  const cache = new MemoryDocumentCache();
  await cache.append('board', source.encodeState());
  const store = new YjsDocumentStore();
  const failure = new Error('Isolated storage application failed.');
  // eslint-disable-next-line @typescript-eslint/unbound-method -- The original is invoked through call with the actual store receiver.
  const apply = YjsDocumentStore.prototype.applyUpdate;
  let applications = 0;
  vi.spyOn(YjsDocumentStore.prototype, 'applyUpdate').mockImplementation(function (
    this: YjsDocumentStore,
    update,
    origin,
  ) {
    if (++applications === 2) throw failure;
    apply.call(this, update, origin);
  });
  await expect(DocumentCacheBinding.open({ store, cache, boardId: 'board' })).rejects.toBe(failure);
  expect(store.read().objects.size).toBe(0);
  store.transact(ADA, (tx) => {
    tx.setObject(sticky('later'));
  });
  expect((await cache.load('board')).updates).toHaveLength(1);
  store.destroy();
  source.destroy();
});
