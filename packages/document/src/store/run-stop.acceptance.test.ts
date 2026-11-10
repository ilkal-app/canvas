import { expect, it } from 'vitest';

import {
  createHistory,
  createObjectsCommand,
  deleteObjectsCommand,
  startRun,
  YjsDocumentStore,
} from '@canvas/document';

import { testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import { newRectangle } from '../commands/__fixtures__/component-boards.js';

import { ADA } from './__fixtures__/store-fixtures.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

type StoppableStore = YjsDocumentStore & {
  requestStop(reason: 'revoked' | 'inbound-backlog'): void;
};

it('ignores an idle stop request, then stops a stepped command before its next part', async () => {
  const store = new YjsDocumentStore();
  (store as StoppableStore).requestStop('revoked');
  expect(store.isRunning).toBe(false);
  const gate = deferred();
  const running = startRun(
    store,
    ADA,
    createObjectsCommand,
    {
      objects: Array.from({ length: 12 }, (value, index) =>
        newRectangle(`paste-${String(index)}`, null, { x: index * 2, y: 0, width: 1, height: 1 }),
      ),
    },
    testEnvironment(),
    { maxWrites: 4, yieldToBrowser: () => gate.promise },
  );
  if (!(running instanceof Promise)) throw new Error('expected a stepped run');
  const committed = store.read().objects.size;
  expect(store.isRunning).toBe(true);
  expect(committed).toBeGreaterThan(0);
  expect(committed).toBeLessThan(12);
  (store as StoppableStore).requestStop('revoked');
  gate.resolve();
  await expect(running).rejects.toMatchObject({
    name: 'RunStoppedError',
    committedParts: 1,
    cause: { name: 'RunStopRequest', reason: 'revoked' },
  });
  expect(store.read().objects.size).toBe(committed);
  expect(store.isRunning).toBe(false);
  await store.whenIdle();
});

it('stops a stepped history restore before the next part and keeps its committed prefix', async () => {
  const store = new YjsDocumentStore();
  const objects = Array.from({ length: 750 }, (value, index) =>
    newRectangle(`paste-${String(index)}`, null, { x: index * 2, y: 0, width: 1, height: 1 }),
  );
  const created = startRun(store, ADA, createObjectsCommand, { objects }, testEnvironment(), {
    maxWrites: 500,
    yieldToBrowser: () => Promise.resolve(),
  });
  if (!(created instanceof Promise)) throw new Error('expected creation run');
  const report = await created;
  const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
  const deleted = startRun(
    store,
    ADA,
    deleteObjectsCommand,
    { ids: [...report.result.ids] },
    testEnvironment(),
    { maxWrites: 500, yieldToBrowser: () => Promise.resolve() },
  );
  if (!(deleted instanceof Promise)) throw new Error('expected deletion run');
  await deleted;
  const gate = deferred();
  const restoring = history.startRestore('undo', { yieldToBrowser: () => gate.promise });
  if (!(restoring instanceof Promise)) throw new Error('expected stepped restore');
  const committed = store.read().objects.size;
  expect(store.isRunning).toBe(true);
  expect(committed).toBeGreaterThan(0);
  expect(committed).toBeLessThan(750);
  (store as StoppableStore).requestStop('inbound-backlog');
  gate.resolve();
  await expect(restoring).rejects.toMatchObject({
    name: 'RunStoppedError',
    committedParts: 1,
    cause: { name: 'RunStopRequest', reason: 'inbound-backlog' },
  });
  expect(store.read().objects.size).toBe(committed);
  expect(store.isRunning).toBe(false);
});
