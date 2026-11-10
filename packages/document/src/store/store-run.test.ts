// The run gate of a store: one run at a time, its synchronous authority, and
// who waits for it.
import { describe, expect, it, vi } from 'vitest';

import { ADA } from './__fixtures__/store-fixtures.js';
import { RunGate, StoreBusyError, StoreDestroyedError } from './store-run.js';
import {
  storeRunState,
  subscribeStoreRuns,
  waitForStoreIdle,
  whenStoreIdle,
} from './when-store-idle.js';
import { YjsDocumentStore } from './yjs-document-store.js';

describe('RunGate', () => {
  it('opens one run at a time and refuses a run after it closed', () => {
    const gate = new RunGate();
    const run = gate.begin();
    expect(() => gate.begin()).toThrow(StoreBusyError);
    run.close();
    run.close();
    expect(() => {
      run.enter(() => undefined);
    }).toThrow('closed');
    gate.begin().close();
  });

  it('authorizes nested enters and only while they run', () => {
    const gate = new RunGate();
    const run = gate.begin();
    expect(() => {
      gate.check();
    }).toThrow(StoreBusyError);
    run.enter(() => {
      run.enter(() => {
        gate.check();
      });
      gate.check();
    });
    expect(() => {
      gate.check();
    }).toThrow(StoreBusyError);
    run.close();
    gate.check();
  });

  it('resolves idle at once with no run, and rejects once destroyed', async () => {
    const gate = new RunGate();
    await expect(gate.whenIdle()).resolves.toBeUndefined();
    gate.destroy();
    await expect(gate.whenIdle()).rejects.toBeInstanceOf(StoreDestroyedError);
  });
});

describe('YjsDocumentStore runs', () => {
  it('keeps setting the repair mode it already has a no-op while idle', () => {
    const store = new YjsDocumentStore();
    store.setRepairMode('write');
    store.transact(ADA, () => undefined);
    store.destroy();
  });
});

it('takes no follower once the store is destroyed', () => {
  const store = new YjsDocumentStore();
  store.destroy();
  const listener = vi.fn();
  subscribeStoreRuns(store, listener)();
  expect(listener).not.toHaveBeenCalled();
  expect(storeRunState(store)).toBeUndefined();
});

it('drops work waiting for a run when the store is destroyed as the run ends', async () => {
  const store = new YjsDocumentStore();
  const run = store.beginRun();
  const work = vi.fn();
  whenStoreIdle(store, work);
  const waited = waitForStoreIdle(store);
  run.close();
  store.destroy();
  await expect(waited).resolves.toBe(false);
  await Promise.resolve();
  expect(work).not.toHaveBeenCalled();
});
