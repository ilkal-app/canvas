import { expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import { idleCoalesced } from './idle-coalesced.js';

it('runs at once while idle, and the latest call once a run ends', async () => {
  const store = new YjsDocumentStore();
  const work = vi.fn();
  const call = idleCoalesced(store, work);
  call(1);
  expect(work).toHaveBeenLastCalledWith(1);
  const run = store.beginRun();
  call(2);
  call(3);
  expect(work).toHaveBeenCalledOnce();
  run.close();
  await vi.waitFor(() => {
    expect(work).toHaveBeenLastCalledWith(3);
  });
  expect(work).toHaveBeenCalledTimes(2);
  store.destroy();
});

it('lets a call made once idle take the waiting one over', async () => {
  const store = new YjsDocumentStore();
  const work = vi.fn();
  const call = idleCoalesced(store, work);
  const run = store.beginRun();
  call('held');
  run.close();
  call('now');
  await Promise.resolve();
  await Promise.resolve();
  expect(work.mock.calls).toEqual([['now']]);
  store.destroy();
});
