import { expect, it } from 'vitest';

import {
  createHistory,
  createObjectsCommand,
  startRun,
  subscribeStoreRuns,
  YjsDocumentStore,
} from '@canvas/document';

import { testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import { newRectangle } from '../commands/__fixtures__/component-boards.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';

it('reports restored parts as the stepped undo commits them', async () => {
  const store = new YjsDocumentStore();
  const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
  const objects = Array.from({ length: 5 }, (unused, index) =>
    newRectangle(`restore-${String(index)}`, null, { x: index * 10, y: 0, width: 2, height: 2 }),
  );
  const started = startRun(store, ADA, createObjectsCommand, { objects }, testEnvironment(), {
    maxWrites: 4,
    yieldToBrowser: () => Promise.resolve(),
  });
  if (!(started instanceof Promise)) throw new Error('expected stepped run');
  await started;
  const progress: { done: number; total: number }[] = [];
  subscribeStoreRuns(store, (state) => {
    if (state?.progress !== undefined) progress.push(state.progress);
  });
  const restoring = history.startRestore('undo', { yieldToBrowser: () => Promise.resolve() });
  if (!(restoring instanceof Promise)) throw new Error('expected stepped restore');
  const report = await restoring;
  expect(report.parts).toBeGreaterThan(1);
  expect(progress).toEqual(
    Array.from({ length: report.parts }, (unused, index) => ({
      done: index + 1,
      total: report.parts,
    })),
  );
  store.destroy();
});
