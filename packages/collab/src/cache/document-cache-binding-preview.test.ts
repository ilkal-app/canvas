import { expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import { addStickies } from './__fixtures__/sticky-board.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import { MemoryDocumentCache } from './memory-document-cache.js';

const BOARD = 'preview-board';
const PREVIEW = new Uint8Array([42]);

async function arrange(prepareSnapshotPreview: () => Promise<Uint8Array | undefined>) {
  const store = new YjsDocumentStore();
  const cache = new MemoryDocumentCache();
  const onError = vi.fn();
  const binding = await DocumentCacheBinding.open({
    store,
    cache,
    boardId: BOARD,
    prepareSnapshotPreview,
    onError,
  });
  addStickies(store, 1);
  return { store, cache, binding, onError };
}

function deferredPreview() {
  let finish: (value: Uint8Array | undefined) => void = () => undefined;
  const promise = new Promise<Uint8Array | undefined>((resolve) => {
    finish = resolve;
  });
  return {
    prepare: vi.fn(() => promise),
    finish: (value: Uint8Array | undefined) => {
      finish(value);
    },
  };
}

it('publishes the prepared preview atomically with the current snapshot', async () => {
  const prepare = vi.fn(() => Promise.resolve(PREVIEW));
  const { store, cache, binding } = await arrange(prepare);
  await binding.compact();
  expect(prepare).toHaveBeenCalledOnce();
  expect((await cache.snapshotPreview.read(BOARD))?.bytes).toEqual(PREVIEW);
  expect((await cache.load(BOARD)).snapshot).toEqual(store.encodeState());
  binding.destroy();
});

it('drops stale preview bytes when the store changes while preparation awaits', async () => {
  const pending = deferredPreview();
  const { store, cache, binding } = await arrange(pending.prepare);
  const compact = binding.compact();
  await vi.waitFor(() => {
    expect(pending.prepare).toHaveBeenCalledOnce();
  });
  addStickies(store, 1, { seed: 2 });
  pending.finish(PREVIEW);
  await compact;
  expect(await cache.snapshotPreview.read(BOARD)).toBeUndefined();
  expect((await cache.load(BOARD)).snapshot).toEqual(store.encodeState());
  binding.destroy();
});

it('does not compact after destruction while a preview is being prepared', async () => {
  const pending = deferredPreview();
  const { cache, binding } = await arrange(pending.prepare);
  const compact = binding.compact();
  await vi.waitFor(() => {
    expect(pending.prepare).toHaveBeenCalledOnce();
  });
  binding.destroy();
  pending.finish(PREVIEW);
  await compact;
  expect((await cache.load(BOARD)).snapshot).toBeUndefined();
  expect(await cache.snapshotPreview.read(BOARD)).toBeUndefined();
});

it('rechecks the unsent-update hold after asynchronous preview preparation', async () => {
  const pending = deferredPreview();
  const { cache, binding } = await arrange(pending.prepare);
  let isHeld = false;
  binding.holdCompactionWhile(() => isHeld);
  const compact = binding.compact();
  await vi.waitFor(() => {
    expect(pending.prepare).toHaveBeenCalledOnce();
  });
  isHeld = true;
  pending.finish(PREVIEW);
  await compact;
  expect((await cache.load(BOARD)).snapshot).toBeUndefined();
  isHeld = false;
  binding.resumeCompaction();
  await binding.flush();
  expect((await cache.snapshotPreview.read(BOARD))?.bytes).toEqual(PREVIEW);
  binding.destroy();
});

it('reports preview preparation failure but preserves ordinary snapshot compaction', async () => {
  const failure = new Error('Resource proof unavailable');
  const { store, cache, binding, onError } = await arrange(() => Promise.reject(failure));
  await binding.compact();
  expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
  expect((await cache.load(BOARD)).snapshot).toEqual(store.encodeState());
  expect(await cache.snapshotPreview.read(BOARD)).toBeUndefined();
  binding.destroy();
});

it('keeps normal compaction when a custom cache offers no preview capability', async () => {
  const prepare = vi.fn(() => Promise.resolve(PREVIEW));
  const { store, cache, binding } = await arrange(prepare);
  Object.defineProperty(cache, 'snapshotPreview', { value: undefined });
  await binding.compact();
  expect(prepare).not.toHaveBeenCalled();
  expect((await cache.load(BOARD)).snapshot).toEqual(store.encodeState());
  binding.destroy();
});

it('keeps normal compaction when the renderer cannot certify a preview', async () => {
  const { store, cache, binding } = await arrange(() => Promise.resolve(undefined));
  await binding.compact();
  expect((await cache.load(BOARD)).snapshot).toEqual(store.encodeState());
  expect(await cache.snapshotPreview.read(BOARD)).toBeUndefined();
  binding.destroy();
});
