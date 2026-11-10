import { expect, it, vi } from 'vitest';

import type { DocumentStore } from '../index.js';
import { forwardUndoSteps, storeRunState, subscribeStoreRuns, YjsDocumentStore } from '../index.js';

it('reports open, each progress value, and close without an initial callback', () => {
  const store = new YjsDocumentStore();
  const listener = vi.fn();
  const unsubscribe = subscribeStoreRuns(store, listener);
  expect(listener).not.toHaveBeenCalled();
  expect(storeRunState(store)).toBeUndefined();
  const run = store.beginRun();
  expect(listener).toHaveBeenLastCalledWith({ progress: undefined });
  expect(storeRunState(store)).toEqual({ progress: undefined });
  run.progress(1, 4);
  run.progress(2, 4);
  expect(listener.mock.calls).toEqual([
    [{ progress: undefined }],
    [{ progress: { done: 1, total: 4 } }],
    [{ progress: { done: 2, total: 4 } }],
  ]);
  expect(storeRunState(store)).toEqual({ progress: { done: 2, total: 4 } });
  run.close();
  expect(listener).toHaveBeenLastCalledWith(undefined);
  expect(storeRunState(store)).toBeUndefined();
  run.progress(3, 4);
  expect(listener).toHaveBeenCalledTimes(4);
  unsubscribe();
  store.beginRun().close();
  expect(listener).toHaveBeenCalledTimes(4);
  store.destroy();
});

it('forwards page-store subscriptions to the root and ignores stores without runs', () => {
  const root = new YjsDocumentStore();
  const page = Object.create(null) as Parameters<typeof forwardUndoSteps>[0];
  forwardUndoSteps(page, root);
  const listener = vi.fn();
  const stop = subscribeStoreRuns(page, listener);
  const run = root.beginRun();
  run.progress(1, 2);
  expect(storeRunState(page)).toEqual({ progress: { done: 1, total: 2 } });
  run.close();
  expect(listener).toHaveBeenCalledTimes(3);
  stop();
  const plain = Object.create(null) as DocumentStore;
  const absent = vi.fn();
  subscribeStoreRuns(plain, absent)();
  expect(storeRunState(plain)).toBeUndefined();
  expect(absent).not.toHaveBeenCalled();
  root.destroy();
});

it('drops listeners on destroy and ignores late progress and close', () => {
  const store = new YjsDocumentStore();
  const listener = vi.fn();
  subscribeStoreRuns(store, listener);
  const run = store.beginRun();
  expect(listener).toHaveBeenCalledTimes(1);
  store.destroy();
  run.progress(1, 2);
  run.close();
  expect(listener).toHaveBeenCalledTimes(1);
});

it('opens a closable run and tells later followers when an open follower throws', async () => {
  const store = new YjsDocumentStore();
  const error = new Error('open follower failed');
  const deferred: (() => void)[] = [];
  vi.stubGlobal('queueMicrotask', (callback: () => void) => deferred.push(callback));
  try {
    subscribeStoreRuns(store, () => {
      throw error;
    });
    const later = vi.fn();
    subscribeStoreRuns(store, later);

    const run = store.beginRun();
    expect(storeRunState(store)).toEqual({ progress: undefined });
    expect(later).toHaveBeenCalledWith({ progress: undefined });
    const idle = store.whenIdle();
    run.close();
    await expect(idle).resolves.toBeUndefined();
    expect(storeRunState(store)).toBeUndefined();
    expect(deferred).toHaveLength(2);
    for (const report of deferred) expect(report).toThrow(error);
  } finally {
    vi.unstubAllGlobals();
    store.destroy();
  }
});

it('resolves idle waiters and tells later followers when a close follower throws', async () => {
  const store = new YjsDocumentStore();
  const error = new Error('close follower failed');
  const deferred: (() => void)[] = [];
  vi.stubGlobal('queueMicrotask', (callback: () => void) => deferred.push(callback));
  try {
    subscribeStoreRuns(store, (state) => {
      if (state === undefined) throw error;
    });
    const later = vi.fn();
    subscribeStoreRuns(store, later);

    const run = store.beginRun();
    const idle = store.whenIdle();
    run.close();
    await expect(idle).resolves.toBeUndefined();
    expect(later).toHaveBeenLastCalledWith(undefined);
    expect(later).toHaveBeenCalledTimes(2);
    expect(storeRunState(store)).toBeUndefined();
    expect(deferred).toHaveLength(1);
    expect(deferred[0]).toThrow(error);
  } finally {
    vi.unstubAllGlobals();
    store.destroy();
  }
});
