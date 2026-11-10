import { expect, it, vi } from 'vitest';

import {
  createLargeBoardObjects,
  createObjectsCommand,
  deleteObjectsCommand,
  isStoreRunning,
  storeRunState,
  subscribeStoreRuns,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
} from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { DocumentInputQueue } from './document-input-queue.js';
import {
  runStepped as runSteppedUnderTest,
  STEPPED_MAX_WRITES as maxWritesUnderTest,
} from './run-stepped.js';

const runStepped = runSteppedUnderTest as unknown as (...args: unknown[]) => void;
const STEPPED_MAX_WRITES = maxWritesUnderTest as unknown as number;

const ORIGIN = { kind: 'user' as const, principalId: 'user:stepped' as const };
const ENVIRONMENT = { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId };

function seeded(count: number): { store: YjsDocumentStore; ids: ObjectId[] } {
  const store = new YjsDocumentStore();
  const objects = createLargeBoardObjects(count, 47);
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  return { store, ids: objects.filter(({ parentId }) => parentId === null).map(({ id }) => id) };
}

it('forwards refusal synchronously without leaving a busy run', () => {
  const store = new YjsDocumentStore();
  const onRefused = vi.fn();
  runStepped(store, ORIGIN, createObjectsCommand, { objects: [] }, ENVIRONMENT, { onRefused });
  expect(onRefused).toHaveBeenCalledOnce();
  expect(isStoreRunning(store)).toBe(false);
  store.destroy();
});

it('applies a one-part command immediately and calls onDone', async () => {
  const { store, ids } = seeded(1);
  const onDone = vi.fn();
  runStepped(store, ORIGIN, deleteObjectsCommand, { ids }, ENVIRONMENT, { onDone });
  expect(store.read().objects.size).toBe(0);
  expect(isStoreRunning(store)).toBe(false);
  await vi.waitFor(() => {
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ parts: 1 }));
  });
  store.destroy();
});

it('keeps the store busy across a multi-part delete and reports the completed run', async () => {
  expect(Number.isInteger(STEPPED_MAX_WRITES)).toBe(true);
  expect(STEPPED_MAX_WRITES).toBeGreaterThan(0);
  const { store, ids } = seeded(STEPPED_MAX_WRITES + 100);
  const onDone = vi.fn();
  const input = new DocumentInputQueue({ store, onNotice: vi.fn() });
  const replayed = vi.fn();
  const states: ReturnType<typeof storeRunState>[] = [];
  const stopFollowing = subscribeStoreRuns(store, (state) => {
    states.push(state);
  });
  runStepped(store, ORIGIN, deleteObjectsCommand, { ids }, ENVIRONMENT, { onDone });
  expect(isStoreRunning(store)).toBe(true);
  expect(storeRunState(store)?.progress?.done).toBe(1);
  input.run({ check: () => undefined, run: replayed });
  expect(replayed).not.toHaveBeenCalled();
  await store.whenIdle();
  await vi.waitFor(() => {
    expect(replayed).toHaveBeenCalledOnce();
  });
  await vi.waitFor(() => {
    expect(onDone).toHaveBeenCalledOnce();
  });
  const completed = onDone.mock.calls[0]?.[0] as unknown as {
    parts: number;
    committedParts: number;
  };
  expect(completed.parts).toBeGreaterThan(1);
  expect(completed.committedParts).toBe(completed.parts);
  expect(states.at(-1)).toBeUndefined();
  expect(store.read().objects.size).toBe(0);
  stopFollowing();
  input.drop();
  store.destroy();
});

it('shows the stopped notice after a committed part and releases the store', async () => {
  const { store, ids } = seeded(STEPPED_MAX_WRITES + 100);
  const onNotice = vi.fn();
  let deliveries = 0;
  const stop = store.subscribe((changes) => {
    if (changes.deleted.length > 0 && ++deliveries === 2) throw new Error('delivery failed');
  });
  runStepped(store, ORIGIN, deleteObjectsCommand, { ids }, ENVIRONMENT, { onNotice });
  await store.whenIdle();
  await vi.waitFor(() => {
    expect(onNotice).toHaveBeenCalledWith(
      'That change stopped partway: 2 of 2 parts were applied.',
    );
  });
  expect(isStoreRunning(store)).toBe(false);
  stop();
  store.destroy();
});
