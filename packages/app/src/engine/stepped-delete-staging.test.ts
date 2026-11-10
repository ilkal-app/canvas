import { expect, it, vi } from 'vitest';

import {
  createHistory,
  createLargeBoardObjects,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
} from '@canvas/document';
import { createSeededIdGenerator } from '@canvas/schema';

import { LOCAL_USER_ORIGIN } from './demo-document.js';
import { EngineDocument } from './engine-document.js';

it('plans a delete of one large group in a task of its own, its descendants counted', async () => {
  const store = new YjsDocumentStore();
  const objects = createLargeBoardObjects(600, 11);
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  const document = new EngineDocument({
    store,
    history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: createSeededIdGenerator(61) },
    onChange: vi.fn(),
    release: vi.fn(),
  });
  const roots = objects.filter(({ parentId }) => parentId === null).map(({ id }) => id);
  document.selectTool.select(roots);
  document.runCanvasAction({ type: 'arrange', command: 'group' }, 1);
  await store.whenIdle();
  // A few roots now hold the board: far fewer than a part writes, their descendants far more.
  const selected = document.inspect().selectedIds;
  expect(selected.length).toBeLessThan(10);
  const before = store.read().objects.size;
  expect(before).toBeGreaterThan(500);
  document.runCanvasAction({ type: 'selection', command: 'delete' }, 2);
  // Staged: the store is held and nothing is written in this task.
  expect(store.isRunning).toBe(true);
  expect(store.read().objects.size).toBe(before);
  await store.whenIdle();
  expect(store.read().objects.size).toBe(0);
  document.destroy();
  store.destroy();
});
