import { expect, it } from 'vitest';

import { createHistory, startRun, YjsDocumentStore } from '@canvas/document';

import { ADA } from '../store/__fixtures__/store-fixtures.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { newRectangle } from './__fixtures__/component-boards.js';
import { createObjectsCommand } from './create-objects.js';

it('reports the planned part count when a command or restore stops', async () => {
  const store = new YjsDocumentStore();
  const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
  const input = {
    objects: Array.from({ length: 5 }, (unused, index) =>
      newRectangle(`parts-${String(index)}`, null, { x: index * 10, y: 0, width: 2, height: 2 }),
    ),
  };
  const environment = testEnvironment();
  const first = startRun(store, ADA, createObjectsCommand, input, environment, {
    maxWrites: 4,
    yieldToBrowser: () => Promise.reject(new Error('stop')),
  });
  if (!(first instanceof Promise)) throw new Error('expected a stepped command');
  await expect(first).rejects.toMatchObject({ committedParts: 1, plannedParts: 3 });
  const all = startRun(store, ADA, createObjectsCommand, input, environment, {
    maxWrites: 4,
    yieldToBrowser: () => Promise.resolve(),
  });
  if (!(all instanceof Promise)) throw new Error('expected a stepped command');
  await all;
  const undo = history.startRestore('undo', {
    yieldToBrowser: () => Promise.reject(new Error('stop')),
  });
  if (!(undo instanceof Promise)) throw new Error('expected a stepped restore');
  await expect(undo).rejects.toMatchObject({ committedParts: 1, plannedParts: 3 });
  store.destroy();
});
