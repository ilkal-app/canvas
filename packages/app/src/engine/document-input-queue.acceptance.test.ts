import { expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import * as inputQueueModule from './document-input-queue.js';

const queueModule = inputQueueModule as unknown as Record<string, unknown>;
const queueClass = queueModule.DocumentInputQueue as new (options: {
  store: YjsDocumentStore;
  onNotice(message: string): void;
}) => {
  run(entry: { check(): string | undefined; run(): void }): void;
  readonly isHolding: boolean;
  drop(): void;
};

function setUp() {
  const store = new YjsDocumentStore();
  const onNotice = vi.fn();
  const queue = new queueClass({ store, onNotice });
  const calls: string[] = [];
  const entry = (name: string, check: () => string | undefined = () => undefined) => ({
    check,
    run: () => {
      calls.push(name);
    },
  });
  return { store, onNotice, queue, calls, entry };
}

it('runs an entry synchronously when idle', () => {
  const { store, queue, calls, entry } = setUp();
  queue.run(entry('now'));
  expect(calls).toEqual(['now']);
  expect(queue.isHolding).toBe(false);
  store.destroy();
});

it('replays waiting entries in enqueue order and queues later input behind them', async () => {
  const { store, queue, calls, entry } = setUp();
  const run = store.beginRun();
  queue.run(entry('first'));
  queue.run(entry('second'));
  expect(queue.isHolding).toBe(true);
  run.close();
  queue.run(entry('third'));
  expect(calls).toEqual([]);
  await vi.waitFor(() => {
    expect(calls).toEqual(['first', 'second', 'third']);
  });
  store.destroy();
});

it('drops one stale entry with its notice and continues replay', async () => {
  const { store, queue, calls, entry, onNotice } = setUp();
  const run = store.beginRun();
  queue.run(entry('stale', () => 'changed'));
  queue.run(entry('later'));
  run.close();
  await vi.waitFor(() => {
    expect(calls).toEqual(['later']);
  });
  expect(onNotice).toHaveBeenCalledExactlyOnceWith('changed');
  store.destroy();
});

it('pauses replay when an entry opens a new run', async () => {
  const { store, queue, calls, entry } = setUp();
  let nextRun: ReturnType<typeof store.beginRun> | undefined;
  const first = store.beginRun();
  queue.run({
    check: () => undefined,
    run: () => {
      calls.push('opens');
      nextRun = store.beginRun();
    },
  });
  queue.run(entry('after'));
  first.close();
  await vi.waitFor(() => {
    expect(calls).toEqual(['opens']);
  });
  expect(queue.isHolding).toBe(true);
  nextRun?.close();
  await vi.waitFor(() => {
    expect(calls).toEqual(['opens', 'after']);
  });
  store.destroy();
});

it('runs nested input in its outer entry before the next waiting entry', async () => {
  const { store, queue, calls, entry } = setUp();
  const run = store.beginRun();
  queue.run({
    check: () => undefined,
    run: () => {
      calls.push('outer');
      queue.run(entry('inner'));
    },
  });
  queue.run(entry('later'));
  run.close();
  await vi.waitFor(() => {
    expect(calls).toEqual(['outer', 'inner', 'later']);
  });
  store.destroy();
});

it('drops pending entries explicitly without replaying them', async () => {
  const { store, queue, calls, entry } = setUp();
  const run = store.beginRun();
  queue.run(entry('dropped'));
  queue.drop();
  expect(queue.isHolding).toBe(false);
  run.close();
  await Promise.resolve();
  expect(calls).toEqual([]);
  store.destroy();
});

it('silently discards pending entries when the store is destroyed', async () => {
  const { store, queue, calls, entry, onNotice } = setUp();
  const run = store.beginRun();
  queue.run(entry('dropped'));
  store.destroy();
  run.close();
  await Promise.resolve();
  expect(calls).toEqual([]);
  expect(onNotice).not.toHaveBeenCalled();
});
