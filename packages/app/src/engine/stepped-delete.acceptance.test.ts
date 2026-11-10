import { expect, it, vi } from 'vitest';

import {
  createHistory,
  createLargeBoardObjects,
  isStoreRunning,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
} from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { LOCAL_USER_ORIGIN } from './demo-document.js';
import { DocumentClipboard } from './document-clipboard.js';
import { runHistoryCommand } from './engine-document-commands.js';
import { EngineDocument } from './engine-document.js';

it('deletes a large selection over several tasks, clears it, and restores it in one undo', async () => {
  const store = new YjsDocumentStore();
  const objects = createLargeBoardObjects(2_100, 47);
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId);
  const document = new EngineDocument({
    store,
    history,
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
    onChange: vi.fn(),
    release: vi.fn(),
  });
  const roots = objects.filter(({ parentId }) => parentId === null).map(({ id }) => id);
  document.selectTool.select(roots);
  const deletedParts: number[] = [];
  const stop = store.subscribe((changes) => {
    if (changes.deleted.length > 0) deletedParts.push(changes.deleted.length);
  });
  document.runCanvasAction({ type: 'selection', command: 'delete' }, 1);
  expect(isStoreRunning(store)).toBe(true);
  await store.whenIdle();
  expect(deletedParts.length).toBeGreaterThan(1);
  expect(deletedParts.reduce((sum, count) => sum + count, 0)).toBe(objects.length);
  expect(store.read().objects.size).toBe(0);
  expect(document.selectTool.selection.ids).toEqual([]);
  runHistoryCommand(history, 'undo');
  await store.whenIdle();
  expect(store.read().objects.size).toBe(objects.length);
  expect(history.canUndo()).toBe(false);
  runHistoryCommand(history, 'redo');
  await store.whenIdle();
  expect(store.read().objects.size).toBe(0);
  stop();
  document.destroy();
  store.destroy();
});

it('runs a cut removal through the same stepped delete path', async () => {
  const store = new YjsDocumentStore();
  const objects = createLargeBoardObjects(2_100, 48);
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId);
  const document = new EngineDocument({
    store,
    history,
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
    onChange: vi.fn(),
    release: vi.fn(),
  });
  const clipboard = new DocumentClipboard({
    store,
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
    controller: document.selectTool,
  });
  document.selectTool.select(
    objects.filter(({ parentId }) => parentId === null).map(({ id }) => id),
  );
  const cut = clipboard.prepareCut();
  if (cut.kind !== 'ready') throw new Error(`cut was ${cut.kind}`);
  cut.remove();
  expect(isStoreRunning(store)).toBe(true);
  await store.whenIdle();
  expect(store.read().objects.size).toBe(0);
  const undone = history.startRestore('undo', { yieldToBrowser: () => Promise.resolve() });
  if (undone === undefined) throw new Error('cut had no undo step');
  await undone;
  expect(store.read().objects.size).toBe(objects.length);
  document.destroy();
  store.destroy();
});
