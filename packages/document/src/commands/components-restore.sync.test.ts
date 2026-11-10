import { expect, it } from 'vitest';

import { resolveInstance, validateBoard } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { ADA, BOB, id, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand } from './__fixtures__/command-fixtures.js';
import { placeInstance, seedLeafMain } from './__fixtures__/component-boards.js';
import { restoreBoardCommand } from './restore-board.js';

it('retains definitions removed by restoring an older board for a concurrent offline instance', () => {
  const ada = new YjsDocumentStore({ clientId: 1 });
  const bob = new YjsDocumentStore({ clientId: 2 });
  const earlier = ada.encodeState();
  seedLeafMain(ada, 'main', { x: 0, y: 0 });
  bob.applyUpdate(ada.encodeState(), RELAY);
  const before = ada.read();
  const history = createHistory(ada, ADA.principalId);
  applyCommand(ada, restoreBoardCommand, { state: earlier });
  expect(ada.get(id('main'))).toMatchObject({ type: 'component', retired: true });
  expect(ada.get(id('main-leaf'))).toMatchObject({ parentId: 'main', text: 'Note' });
  expect(history.undo()).toBe(true);
  expect(ada.read().objects).toEqual(before.objects);
  expect(history.redo()).toBe(true);
  placeInstance(bob, 'main', { instanceId: 'late', x: 400, y: 0 }, BOB);
  ada.applyUpdate(bob.encodeState(), RELAY);
  bob.applyUpdate(ada.encodeState(), RELAY);
  for (const store of [ada, bob]) {
    expect(validateBoard(store.read())).toEqual([]);
    const instance = store.get(id('late'));
    if (instance?.type !== 'instance') throw new Error('Expected late instance');
    const resolved = resolveInstance(store.read(), instance);
    expect(resolved.isMainRetired).toBe(true);
    expect(resolved.issue).toBeUndefined();
    expect(resolved.objects).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'Note' })]),
    );
  }
  history.destroy();
  ada.destroy();
  bob.destroy();
});
