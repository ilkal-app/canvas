import { expect, it } from 'vitest';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import {
  createFrameClients,
  hostileUpdate,
  worldOf,
} from '../repair/__fixtures__/cycle-fixtures.js';

import { id, RELAY } from './__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from './yjs-document-store.js';

it('bases an explicit local orphan move on its projected parent and placement', () => {
  const [source] = createFrameClients([1]);
  if (source === undefined) throw new Error('missing fixture');
  const viewer = new YjsDocumentStore({ repairMode: 'read-only' });
  viewer.applyUpdate(source.encodeState(), RELAY);
  viewer.applyUpdate(hostileUpdate(source, { 'frame-outer': null }), RELAY);
  const before = worldOf(viewer.read(), 'frame-inner');
  applyCommand(viewer, moveObjectsCommand, { moves: [{ id: 'frame-inner', by: { x: 10, y: 5 } }] });
  const after = worldOf(viewer.read(), 'frame-inner');
  expect([after[2], after[3]]).toEqual([
    Number(((before[2] ?? 0) + 10).toFixed(6)),
    Number(((before[3] ?? 0) + 5).toFixed(6)),
  ]);
  const cold = new YjsDocumentStore({ repairMode: 'read-only' });
  cold.applyUpdate(viewer.encodeState(), RELAY);
  expect(cold.get(id('frame-inner'))).toEqual(viewer.get(id('frame-inner')));
  for (const store of [source, viewer, cold]) store.destroy();
});
