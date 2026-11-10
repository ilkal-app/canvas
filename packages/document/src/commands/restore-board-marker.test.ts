import { expect, it } from 'vitest';
import * as Y from 'yjs';

import { ADA_ID } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { META_MAP_NAME } from '../meta/document-meta.js';
import { RESTORE_MARKER_KEY, restoreMarkerSchema } from '../meta/restore-marker.js';
import {
  ADA,
  BOB,
  createFixtureStore,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { restoreBoardCommand } from './restore-board.js';
import { runCommand } from './run-command.js';

it('includes one restore intent beside its object changes, while undo writes no new intent', () => {
  const store = createFixtureStore();
  const state = store.encodeState();
  store.transact(BOB, (transaction) => {
    transaction.patchObject(id('video-demo'), { x: 999 });
  });
  const history = createHistory(store, ADA_ID);
  const updates: Uint8Array[] = [];
  store.subscribeUpdates((update) => updates.push(update.update));
  const before = store.encodeState();
  expect(runCommand(store, ADA, restoreBoardCommand, { state }, testEnvironment()).status).toBe(
    'applied',
  );
  expect(updates).toHaveLength(1);
  const received = new Y.Doc();
  Y.applyUpdate(received, before);
  const first = updates[0];
  if (first === undefined) throw new Error('Restore update missing');
  Y.applyUpdate(received, first);
  const marker = restoreMarkerSchema.parse(received.getMap(META_MAP_NAME).get(RESTORE_MARKER_KEY));
  expect(marker).toMatchObject({ version: 1, part: 0, parts: 1 });
  const item = internalsOf(store).doc.getMap(META_MAP_NAME)._map.get(RESTORE_MARKER_KEY);
  expect(history.undo()).toBe(true);
  expect(internalsOf(store).doc.getMap(META_MAP_NAME)._map.get(RESTORE_MARKER_KEY)).toBe(item);
  received.destroy();
  history.destroy();
  store.destroy();
});

it('shares one intent id and complete part count across a large restore', () => {
  const store = createFixtureStore();
  const state = store.encodeState();
  store.transact(BOB, (transaction) => {
    for (let index = 0; index < 2_500; index += 1)
      transaction.setObject({
        ...fixtureObject('sticky-idea', 'sticky'),
        id: id(`added-${String(index)}`),
        parentId: null,
      });
  });
  const receiver = new Y.Doc();
  Y.applyUpdate(receiver, store.encodeState());
  const markers: unknown[] = [];
  store.subscribeUpdates((update) => {
    Y.applyUpdate(receiver, update.update);
    markers.push(receiver.getMap(META_MAP_NAME).get(RESTORE_MARKER_KEY));
  });
  expect(runCommand(store, ADA, restoreBoardCommand, { state }, testEnvironment()).status).toBe(
    'applied',
  );
  const parsed = markers.map((marker) => restoreMarkerSchema.parse(marker));
  expect(parsed).toHaveLength(3);
  expect(new Set(parsed.map((marker) => marker.id)).size).toBe(1);
  expect(parsed.map((marker) => [marker.part, marker.parts])).toEqual([
    [0, 3],
    [1, 3],
    [2, 3],
  ]);
  receiver.destroy();
  store.destroy();
});

it('restoring identical content writes neither object updates nor timeline intent', () => {
  const store = createFixtureStore();
  const state = store.encodeState();
  const updates: Uint8Array[] = [];
  store.subscribeUpdates((update) => updates.push(update.update));
  expect(runCommand(store, ADA, restoreBoardCommand, { state }, testEnvironment()).status).toBe(
    'applied',
  );
  expect(updates).toEqual([]);
  expect(store.encodeState()).toEqual(state);
  expect(internalsOf(store).doc.getMap(META_MAP_NAME).has(RESTORE_MARKER_KEY)).toBe(false);
  store.destroy();
});

it('refuses an incomplete honest delta without clearing the live board', () => {
  const source = createFixtureStore();
  let delta: Uint8Array | undefined;
  source.subscribeUpdates((update) => {
    delta = update.update;
  });
  source.transact(BOB, (transaction) => {
    transaction.patchObject(id('video-demo'), { x: 999 });
  });
  const target = createFixtureStore();
  const before = target.encodeState();
  if (delta === undefined) throw new Error('Fixture delta missing');
  expect(
    runCommand(target, ADA, restoreBoardCommand, { state: delta }, testEnvironment()).status,
  ).toBe('rejected');
  expect(target.encodeState()).toEqual(before);
  source.destroy();
  target.destroy();
});
