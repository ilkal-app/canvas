import { expect, it } from 'vitest';

import { resolveInstance, validateBoard } from '@canvas/schema';

import { placeInstance, seedLeafMain } from '../commands/__fixtures__/component-boards.js';
import { ADA, BOB, id, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { Link } from './__fixtures__/history-fixtures.js';
import { createHistory } from './undo-manager.js';

it('protects a main creation once another person has placed an instance of it', () => {
  const ada = new YjsDocumentStore({ clientId: 1 });
  const bob = new YjsDocumentStore({ clientId: 2 });
  const history = createHistory(ada, ADA.principalId);
  seedLeafMain(ada, 'main', { x: 0, y: 0 });
  bob.applyUpdate(ada.encodeState(), RELAY);
  const link = new Link(ada, bob);
  placeInstance(bob, 'main', { instanceId: 'instance', x: 500, y: 0 }, BOB);
  link.deliver();
  expect(history.undo()).toBe(false);
  link.deliver();
  expect(validateBoard(ada.read())).toEqual([]);
  expect(ada.get(id('main'))).toBeDefined();
  history.destroy();
  ada.destroy();
  bob.destroy();
});

it('keeps an offline instance resolvable when main creation is undone concurrently', () => {
  const ada = new YjsDocumentStore({ clientId: 1 });
  const bob = new YjsDocumentStore({ clientId: 2 });
  const history = createHistory(ada, ADA.principalId);
  seedLeafMain(ada, 'main', { x: 0, y: 0 });
  bob.applyUpdate(ada.encodeState(), RELAY);
  const link = new Link(ada, bob);
  link.disconnect();
  history.undo();
  placeInstance(bob, 'main', { instanceId: 'instance', x: 500, y: 0 }, BOB);
  link.reconnect();
  for (const store of [ada, bob]) {
    expect(validateBoard(store.read())).toEqual([]);
    const instance = store.get(id('instance'));
    if (instance?.type !== 'instance') throw new Error('Expected retained instance');
    const resolved = resolveInstance(store.read(), instance);
    expect(resolved.issue).toBeUndefined();
    expect(resolved.isMainRetired).toBe(true);
    expect(resolved.objects).toEqual([]);
    expect(store.get(id('main-leaf'))).toMatchObject({ parentId: null, text: 'Note' });
  }
  history.destroy();
  ada.destroy();
  bob.destroy();
});
