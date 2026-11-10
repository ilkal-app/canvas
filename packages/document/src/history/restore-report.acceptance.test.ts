import { expect, it } from 'vitest';

import {
  createHistory,
  createObjectsCommand,
  runCommand,
  setStyleCommand,
  startRun,
  YjsDocumentStore,
} from '@canvas/document';

import { testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import { newRectangle } from '../commands/__fixtures__/component-boards.js';
import { ADA, BOB, exchange } from '../store/__fixtures__/store-fixtures.js';

import { BOB_ENVIRONMENT } from './__fixtures__/creation-fixtures.js';

it('reports isChanged true across a stepped undo and redo', async () => {
  const store = new YjsDocumentStore();
  const history = createHistory(store, ADA.principalId);
  const objects = Array.from({ length: 5 }, (unused, index) =>
    newRectangle(`shape-${String(index)}`, null, { x: index * 20, y: 0, width: 10, height: 10 }),
  );
  const started = startRun(store, ADA, createObjectsCommand, { objects }, testEnvironment(), {
    maxWrites: 4,
    yieldToBrowser: () => Promise.resolve(),
  });
  if (!(started instanceof Promise)) throw new Error('creation was refused');
  await started;
  const undone = history.startRestore('undo', { yieldToBrowser: () => Promise.resolve() });
  if (undone === undefined) throw new Error('undo had no step');
  expect((await undone).isChanged).toBe(true);
  const redone = history.startRestore('redo', { yieldToBrowser: () => Promise.resolve() });
  if (redone === undefined) throw new Error('redo had no step');
  expect((await redone).isChanged).toBe(true);
  history.destroy();
  store.destroy();
});

it('reports isChanged false when a peer restyle protects the whole creation', async () => {
  for (const restore of ['sync', 'stepped'] as const) {
    const store = new YjsDocumentStore();
    const peer = new YjsDocumentStore();
    const history = createHistory(store, ADA.principalId);
    const object = newRectangle('protected', null, { x: 0, y: 0, width: 10, height: 10 });
    const created = runCommand(
      store,
      ADA,
      createObjectsCommand,
      { objects: [object] },
      testEnvironment(),
    );
    expect(created.status).toBe('applied');
    if (created.status !== 'applied') throw new Error('creation was refused');
    const createdId = created.result.ids[0];
    if (createdId === undefined) throw new Error('creation returned no id');
    exchange(store, peer);
    const restyled = runCommand(
      peer,
      BOB,
      setStyleCommand,
      { changes: [{ id: createdId, style: { fill: [0, 0, 1, 1] } }] },
      BOB_ENVIRONMENT,
    );
    expect(restyled.status).toBe('applied');
    exchange(store, peer);

    if (restore === 'sync') {
      expect(history.undo()).toBe(false);
      expect(history.lastProtection()?.objectIds).toContain(createdId);
    } else {
      const undone = history.startRestore('undo', { yieldToBrowser: () => Promise.resolve() });
      if (undone === undefined) throw new Error('undo had no step');
      const report = await undone;
      expect(report.isChanged).toBe(false);
      expect(report.protection?.objectIds).toContain(createdId);
    }
    expect(store.get(createdId)).toMatchObject({ fill: [0, 0, 1, 1] });
    history.destroy();
    peer.destroy();
    store.destroy();
  }
});
