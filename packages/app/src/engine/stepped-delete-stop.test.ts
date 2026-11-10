import { expect, it, vi } from 'vitest';

import {
  createHistory,
  createLargeBoardObjects,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
} from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { LOCAL_USER_ORIGIN } from './demo-document.js';
import { DocumentClipboard } from './document-clipboard.js';
import { EngineDocument } from './engine-document.js';

/** The stop notice of a run that planned its parts: how many of them were applied. */
const PARTS_STOPPED = /^That change stopped partway: 2 of \d+ parts were applied\.$/;

it('tells the person when a stepped delete stopped partway', async () => {
  const store = new YjsDocumentStore();
  const objects = createLargeBoardObjects(2_100, 49);
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  const notices: string[] = [];
  const document = new EngineDocument({
    store,
    history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
    onChange: vi.fn(),
    release: vi.fn(),
    onNotice: (message) => notices.push(message),
  });
  let deliveries = 0;
  const stop = store.subscribe((changes) => {
    if (changes.deleted.length > 0 && ++deliveries === 2) throw new Error('delivery failed');
  });
  document.selectTool.select(
    objects.filter(({ parentId }) => parentId === null).map(({ id }) => id),
  );
  document.runCanvasAction({ type: 'selection', command: 'delete' }, 1);
  await store.whenIdle();
  await vi.waitFor(() => {
    expect(notices).toContainEqual(expect.stringMatching(PARTS_STOPPED));
  });
  stop();
  document.destroy();
  store.destroy();
});

it("tells the person when a stepped cut's removal stopped partway", async () => {
  const store = new YjsDocumentStore();
  const objects = createLargeBoardObjects(2_100, 50);
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  const notices: string[] = [];
  const environment = { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId };
  const document = new EngineDocument({
    store,
    history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
    origin: LOCAL_USER_ORIGIN,
    environment,
    onChange: vi.fn(),
    release: vi.fn(),
  });
  const clipboard = new DocumentClipboard({
    store,
    origin: LOCAL_USER_ORIGIN,
    environment,
    controller: document.selectTool,
    onNotice: (message) => notices.push(message),
  });
  let deliveries = 0;
  const stop = store.subscribe((changes) => {
    if (changes.deleted.length > 0 && ++deliveries === 2) throw new Error('delivery failed');
  });
  document.selectTool.select(
    objects.filter(({ parentId }) => parentId === null).map(({ id }) => id),
  );
  const cut = clipboard.prepareCut();
  if (cut.kind !== 'ready') throw new Error(`cut was ${cut.kind}`);
  cut.remove();
  await store.whenIdle();
  await vi.waitFor(() => {
    expect(notices).toContainEqual(expect.stringMatching(PARTS_STOPPED));
  });
  stop();
  document.destroy();
  store.destroy();
});
