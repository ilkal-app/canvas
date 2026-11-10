import { expect, it } from 'vitest';

import { createHistory, startRun, YjsDocumentStore } from '@canvas/document';

import { ADA } from '../store/__fixtures__/store-fixtures.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { newRectangle } from './__fixtures__/component-boards.js';
import { createObjectsCommand } from './create-objects.js';
import type { StartRunOptions } from './start-run.js';

const objects = (count: number) =>
  Array.from({ length: count }, (unused, index) =>
    newRectangle(`staged-${String(index)}`, null, { x: index * 10, y: 0, width: 2, height: 2 }),
  );

const staged = (yieldToBrowser: () => Promise<void>): StartRunOptions => ({
  maxWrites: 4,
  yieldToBrowser,
  isPlanStaged: true,
});

it('holds the board before planning yields, then commits all parts as one undo step', async () => {
  const store = new YjsDocumentStore();
  const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
  let release: () => void = () => undefined;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = startRun(
    store,
    ADA,
    createObjectsCommand,
    { objects: objects(501) },
    testEnvironment(),
    staged(() => paused),
  );
  expect(pending).toBeInstanceOf(Promise);
  expect(store.isRunning).toBe(true);
  expect(store.read().objects.size).toBe(0);
  release();
  if (!(pending instanceof Promise)) throw new Error('expected a staged run');
  await pending;
  expect(store.read().objects.size).toBe(501);
  expect(history.undo()).toBe(true);
  expect(store.read().objects.size).toBe(0);
  store.destroy();
});

it('refuses invalid input found after a yield without applying any part', async () => {
  const store = new YjsDocumentStore();
  const input = { objects: [...objects(500), { width: -1 }] } as never;
  const pending = startRun(
    store,
    ADA,
    createObjectsCommand,
    input,
    testEnvironment(),
    staged(() => Promise.resolve()),
  );
  expect(pending).toBeInstanceOf(Promise);
  if (!(pending instanceof Promise)) throw new Error('expected a staged refusal');
  await expect(pending).rejects.toMatchObject({ name: 'RunRefusedError' });
  expect(store.read().objects.size).toBe(0);
  expect(store.isRunning).toBe(false);
  store.destroy();
});

it('stops during planning with zero committed parts and releases the hold', async () => {
  const store = new YjsDocumentStore();
  const pending = startRun(
    store,
    ADA,
    createObjectsCommand,
    { objects: objects(501) },
    testEnvironment(),
    staged(() => {
      store.requestStop('revoked');
      return Promise.resolve();
    }),
  );
  expect(pending).toBeInstanceOf(Promise);
  if (!(pending instanceof Promise)) throw new Error('expected a staged stop');
  await expect(pending).rejects.toMatchObject({
    name: 'RunStoppedError',
    committedParts: 0,
    plannedParts: undefined,
  });
  expect(store.read().objects.size).toBe(0);
  expect(store.isRunning).toBe(false);
  store.destroy();
});

it('destroy during planning rejects before writing and closes the run', async () => {
  const store = new YjsDocumentStore();
  let created = 0;
  store.subscribe((change) => {
    created += change.created.length;
  });
  const pending = startRun(
    store,
    ADA,
    createObjectsCommand,
    { objects: objects(501) },
    testEnvironment(),
    staged(() => {
      store.destroy();
      return Promise.resolve();
    }),
  );
  expect(pending).toBeInstanceOf(Promise);
  if (!(pending instanceof Promise)) throw new Error('expected a staged destroy');
  await expect(pending).rejects.toMatchObject({ name: 'StoreDestroyedError' });
  expect(created).toBe(0);
  expect(store.isRunning).toBe(false);
});
