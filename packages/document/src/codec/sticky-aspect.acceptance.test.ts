// A sticky's optional aspect survives the grouped codec and command writes.
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { BoardObject, PrincipalId } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { setStyleCommand } from '../commands/set-style.js';
import { fixtureObject, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { toYjs } from './object-codec.js';
import { layoutOf } from './object-layout.js';
import { fromYjs } from './object-reader.js';

const ID = 'wide-note';
const ADA = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const stores: YjsDocumentStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.destroy();
});

function store(): YjsDocumentStore {
  const value = new YjsDocumentStore();
  stores.push(value);
  return value;
}

function roundTrip(object: BoardObject): { map: Y.Map<unknown>; read: BoardObject } {
  const objects = new Y.Doc().getMap<unknown>('objects');
  objects.set(object.id, toYjs(object));
  const map = objects.get(object.id) as Y.Map<unknown>;
  const decoded = fromYjs(object.id, map);
  if ('issue' in decoded) throw new Error(decoded.issue.message);
  return { map, read: decoded.object };
}

function storedStyle(value: YjsDocumentStore): Readonly<Record<string, unknown>> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, value.encodeState());
  const result = doc.getMap<Y.Map<unknown>>('objects').get(ID)?.get('style');
  doc.destroy();
  return result as Readonly<Record<string, unknown>>;
}

describe('sticky aspect document storage', () => {
  it('keeps aspect in the style group and round-trips wide without adding a square default', () => {
    const style = layoutOf('sticky')?.codecs.find(
      (codec) => codec.kind === 'group' && codec.key === 'style',
    );
    expect(style).toMatchObject({ fields: expect.arrayContaining(['aspect']) as unknown });
    const square = roundTrip({
      ...fixtureObject('sticky-idea', 'sticky'),
      id: ID as never,
      parentId: null,
    });
    expect(square.map.get('style')).not.toHaveProperty('aspect');
    expect(square.read).not.toHaveProperty('aspect');
    const wide = roundTrip({
      ...fixtureObject('sticky-idea', 'sticky'),
      id: ID as never,
      parentId: null,
      aspect: 'wide',
    });
    expect(wide.map.get('style')).toHaveProperty('aspect', 'wide');
    expect(wide.read).toHaveProperty('aspect', 'wide');
  });

  it('creates, changes, and explicitly removes the aspect through setStyle', () => {
    const value = store();
    value.transact(ADA, (transaction) => {
      transaction.setObject({
        ...fixtureObject('sticky-idea', 'sticky'),
        id: ID as never,
        parentId: null,
        aspect: 'wide',
      });
    });
    expect(value.get(ID as never)).toHaveProperty('aspect', 'wide');
    expect(storedStyle(value)).toHaveProperty('aspect', 'wide');
    applyCommand(value, setStyleCommand, {
      changes: [{ id: ID, style: { aspect: 'square' } }],
    });
    expect(value.get(ID as never)).toHaveProperty('aspect', 'square');
    applyCommand(value, setStyleCommand, {
      changes: [{ id: ID, style: { aspect: undefined } }],
    });
    expect(value.get(ID as never)).not.toHaveProperty('aspect');
    expect(storedStyle(value)).not.toHaveProperty('aspect');
  });

  it('reads a refused peer value as absent and carries it through a move', () => {
    const source = store();
    source.transact(ADA, (transaction) => {
      transaction.setObject({
        ...fixtureObject('sticky-idea', 'sticky'),
        id: ID as never,
        parentId: null,
      });
    });
    const peer = new Y.Doc();
    Y.applyUpdate(peer, source.encodeState());
    const map = peer.getMap<Y.Map<unknown>>('objects').get(ID);
    if (map === undefined) throw new Error('Fixture sticky is missing');
    map.set('style', { ...(map.get('style') as object), aspect: 'huge' });
    source.applyUpdate(Y.encodeStateAsUpdate(peer), RELAY);
    expect(source.read().issues).toEqual([]);
    expect(source.get(ID as never)).not.toHaveProperty('aspect');
    applyCommand(source, moveObjectsCommand, {
      moves: [{ id: ID, by: { x: 20, y: 10 } }],
    });
    expect(storedStyle(source)).toHaveProperty('aspect', 'huge');
    peer.destroy();
  });
});
