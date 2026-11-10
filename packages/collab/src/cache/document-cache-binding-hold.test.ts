import { expect, it } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import { addStickies } from './__fixtures__/sticky-board.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import { MemoryCacheStorage, MemoryDocumentCache } from './memory-document-cache.js';

const BOARD = 'board-1';

it('holds a due compaction while told to, and runs it once resumed', async () => {
  const storage = new MemoryCacheStorage();
  const store = new YjsDocumentStore();
  const cache = new MemoryDocumentCache(storage);
  const binding = await DocumentCacheBinding.open({
    store,
    cache,
    boardId: BOARD,
    compactEvery: 3,
  });
  let isHeld = true;
  binding.holdCompactionWhile(() => isHeld);
  addStickies(store, 5, { batchSize: 1 });
  await binding.flush();
  expect(storage.board(BOARD).snapshot).toBeUndefined();
  expect(storage.board(BOARD).updates.size).toBe(5);
  binding.resumeCompaction();
  await binding.flush();
  expect(storage.board(BOARD).snapshot).toBeUndefined();
  isHeld = false;
  binding.resumeCompaction();
  await binding.flush();
  expect(storage.board(BOARD).snapshot).toBeDefined();
  expect(storage.board(BOARD).updates.size).toBe(0);
  binding.resumeCompaction();
  await binding.flush();
  expect(storage.board(BOARD).snapshot?.version).toBe(1);
  binding.destroy();
});
