import { expect, it } from 'vitest';

import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { newRectangle } from './__fixtures__/component-boards.js';
import { createObjectsCommand } from './create-objects.js';
import { startRun } from './start-run.js';

/** `createObjects` with a split that throws. */
const throwingSplit = {
  ...createObjectsCommand,
  split: () => {
    throw new Error('split failed');
  },
};

const input = {
  objects: Array.from({ length: 3 }, (unused, index) =>
    newRectangle(`split-${String(index)}`, null, { x: index * 10, y: 0, width: 2, height: 2 }),
  ),
};

const options = { maxWrites: 2, yieldToBrowser: () => Promise.resolve() };

it('holds nothing when the split throws, planned at once', () => {
  const store = new YjsDocumentStore();
  expect(() => startRun(store, ADA, throwingSplit, input, testEnvironment(), options)).toThrow(
    'split failed',
  );
  expect(store.isRunning).toBe(false);
  store.destroy();
});

it('releases the hold when the split throws after a staged plan, writing nothing', async () => {
  const store = new YjsDocumentStore();
  const pending = startRun(store, ADA, throwingSplit, input, testEnvironment(), {
    ...options,
    isPlanStaged: true,
  });
  if (!(pending instanceof Promise)) throw new Error('expected a staged run');
  await expect(pending).rejects.toThrow('split failed');
  expect(store.isRunning).toBe(false);
  expect(store.read().objects.size).toBe(0);
  store.destroy();
});
