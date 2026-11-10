import { expect, it } from 'vitest';

import { validateBoard } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import {
  createFrameClients,
  hostileUpdate,
  moveInto,
  worldOf,
} from '../repair/__fixtures__/cycle-fixtures.js';

import { id, RELAY } from './__fixtures__/store-fixtures.js';
import type { DocumentUpdate } from './document-store.js';
import { YjsDocumentStore } from './yjs-document-store.js';

it('projects a cycle closed by orphan repair and materializes its root for an explicit move', () => {
  const [source, editor] = createFrameClients([1, 2]) as [YjsDocumentStore, YjsDocumentStore];
  moveInto(source, 'frame-outer', 'frame-side', { x: 800, y: 0 });
  editor.applyUpdate(source.encodeState(editor.encodeStateVector()), RELAY);
  const viewer = new YjsDocumentStore({ repairMode: 'read-only' });
  viewer.applyUpdate(source.encodeState(), RELAY);
  const updates: DocumentUpdate[] = [];
  viewer.subscribeUpdates((update) => updates.push(update));
  const update = hostileUpdate(source, {
    'frame-outer': null,
    'frame-side': { placement: { parentId: 'frame-inner' } },
  });
  viewer.applyUpdate(update, RELAY);
  editor.applyUpdate(update, RELAY);
  expect(new Map(viewer.read().objects)).toEqual(new Map(editor.read().objects));
  expect(validateBoard(viewer.read())).toEqual([]);
  expect(viewer.read().issues).toContainEqual(
    expect.objectContaining({ code: 'parent-cycle', key: 'frame-inner' }),
  );
  expect(updates.filter(({ isLocal }) => isLocal)).toEqual([]);
  const rootBefore = worldOf(viewer.read(), 'frame-inner');
  applyCommand(viewer, moveObjectsCommand, { moves: [{ id: 'frame-side', by: { x: 10, y: 5 } }] });
  expect(worldOf(viewer.read(), 'frame-inner')).toEqual(rootBefore);
  expect(updates.filter(({ isLocal }) => isLocal)).toHaveLength(1);
  const cold = new YjsDocumentStore({ repairMode: 'read-only' });
  cold.applyUpdate(viewer.encodeState(), RELAY);
  expect(cold.get(id('frame-inner'))).toEqual(viewer.get(id('frame-inner')));
  expect(validateBoard(cold.read())).toEqual([]);
  for (const store of [source, editor, viewer, cold]) store.destroy();
});
