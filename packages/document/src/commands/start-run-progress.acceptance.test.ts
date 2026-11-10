import { expect, it } from 'vitest';

import {
  afterParts,
  createObjectsCommand,
  startRun,
  subscribeStoreRuns,
  YjsDocumentStore,
} from '@canvas/document';

import { ADA } from '../store/__fixtures__/store-fixtures.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { newRectangle } from './__fixtures__/component-boards.js';

it('reports progress after every committed part and its page delivery', async () => {
  const store = new YjsDocumentStore();
  const observed: { done: number; total: number; delivered: number }[] = [];
  let delivered = 0;
  afterParts(store, () => {
    delivered += 1;
  });
  subscribeStoreRuns(store, (state) => {
    if (state?.progress !== undefined) observed.push({ ...state.progress, delivered });
  });
  const objects = Array.from({ length: 5 }, (unused, index) =>
    newRectangle(`part-${String(index)}`, null, { x: index * 10, y: 0, width: 2, height: 2 }),
  );
  const pending = startRun(store, ADA, createObjectsCommand, { objects }, testEnvironment(), {
    maxWrites: 4,
    yieldToBrowser: () => Promise.resolve(),
  });
  if (!(pending instanceof Promise)) throw new Error('expected stepped run');
  const report = await pending;
  expect(report.parts).toBeGreaterThan(1);
  expect(observed).toEqual(
    Array.from({ length: report.parts }, (unused, index) => ({
      done: index + 1,
      total: report.parts,
      delivered: index + 1,
    })),
  );
  store.destroy();
});

it('counts a committed part whose after-parts delivery throws', async () => {
  const store = new YjsDocumentStore();
  const progress: { done: number; total: number }[] = [];
  subscribeStoreRuns(store, (state) => {
    if (state?.progress !== undefined) progress.push(state.progress);
  });
  afterParts(store, () => {
    throw new Error('page delivery failed');
  });
  const objects = Array.from({ length: 5 }, (unused, index) =>
    newRectangle(`failed-${String(index)}`, null, { x: index * 10, y: 0, width: 2, height: 2 }),
  );
  const pending = startRun(store, ADA, createObjectsCommand, { objects }, testEnvironment(), {
    maxWrites: 4,
    yieldToBrowser: () => Promise.resolve(),
  });
  if (!(pending instanceof Promise)) throw new Error('expected stepped run');
  await expect(pending).rejects.toMatchObject({ committedParts: 1 });
  expect(progress).toHaveLength(1);
  expect(progress[0]?.done).toBe(1);
  expect(progress[0]?.total).toBeGreaterThan(1);
  store.destroy();
});
