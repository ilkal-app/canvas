// Object links live in the style group and tolerate hostile stored values.
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { BoardObject, PrincipalId } from '@canvas/schema';

import { applyCommand, expectRejected } from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { setStyleCommand } from '../commands/set-style.js';
import { RELAY, fixtureObject } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { toYjs } from './object-codec.js';
import { layoutOf } from './object-layout.js';
import { fromYjs } from './object-reader.js';

const ADA = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const LINK = 'https://example.com/target';
const stores: YjsDocumentStore[] = [];
afterEach(() => {
  for (const value of stores.splice(0)) value.destroy();
});

/**
 * Makes a tracked store for a test.
 *
 * @returns A store destroyed after the test.
 */
function store(): YjsDocumentStore {
  const value = new YjsDocumentStore();
  stores.push(value);
  return value;
}

/**
 * Reads one integrated object and its stored map.
 *
 * @param object - The object to encode.
 * @returns Its stored map and decoded value.
 * @throws {Error} If the codec refuses the object.
 */
function roundTrip(object: BoardObject): { map: Y.Map<unknown>; read: BoardObject } {
  const objects = new Y.Doc().getMap<unknown>('objects');
  objects.set(object.id, toYjs(object));
  const map = objects.get(object.id) as Y.Map<unknown>;
  const decoded = fromYjs(object.id, map);
  if ('issue' in decoded) throw new Error(decoded.issue.message);
  return { map, read: decoded.object };
}

/**
 * Reads the raw style group from a store's encoded state.
 *
 * @param value - The source store.
 * @param id - The object's id.
 * @returns The stored style group.
 */
function storedStyle(value: YjsDocumentStore, id: string): Readonly<Record<string, unknown>> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, value.encodeState());
  const result = doc.getMap<Y.Map<unknown>>('objects').get(id)?.get('style');
  doc.destroy();
  return result as Readonly<Record<string, unknown>>;
}

/**
 * Reads an existing fixture object of the requested linkable type.
 *
 * @param type - The fixture type.
 * @returns Its object.
 */
function linkableFixture(type: 'text' | 'sticky' | 'image'): BoardObject {
  const id = { text: 'text-title', sticky: 'sticky-idea', image: 'image-photo' }[type];
  return fixtureObject(id, type);
}

describe('link document storage', () => {
  it.each(['text', 'sticky', 'image'] as const)('stores an optional %s link in style', (type) => {
    const style = layoutOf(type)?.codecs.find(
      (codec) => codec.kind === 'group' && codec.key === 'style',
    );
    expect(style).toMatchObject({ fields: expect.arrayContaining(['link']) as unknown });
    const original = linkableFixture(type);
    const absent = roundTrip(original);
    expect(absent.map.get('style')).not.toHaveProperty('link');
    expect(absent.read).not.toHaveProperty('link');
    const present = roundTrip({ ...original, link: LINK } as BoardObject);
    expect(present.map.get('style')).toHaveProperty('link', LINK);
    expect(present.read).toHaveProperty('link', LINK);
  });

  it.each(['text', 'sticky', 'image'] as const)('sets and explicitly removes a %s link', (type) => {
    const value = store();
    const id = `${type}-style-link`;
    value.transact(ADA, (transaction) => {
      transaction.setObject({ ...linkableFixture(type), id: id as never });
    });
    applyCommand(value, setStyleCommand, { changes: [{ id, style: { link: LINK } }] });
    expect(value.get(id as never)).toHaveProperty('link', LINK);
    expect(storedStyle(value, id)).toHaveProperty('link', LINK);
    applyCommand(value, setStyleCommand, { changes: [{ id, style: { link: undefined } }] });
    expect(value.get(id as never)).not.toHaveProperty('link');
    expect(storedStyle(value, id)).not.toHaveProperty('link');
  });

  it.each(['text', 'sticky', 'image'] as const)(
    'rejects unsafe %s link style without writing',
    (type) => {
      const value = store();
      const id = `${type}-unsafe-link`;
      value.transact(ADA, (transaction) => {
        transaction.setObject({ ...linkableFixture(type), id: id as never });
      });
      expectRejected(value, setStyleCommand, {
        changes: [{ id, style: { link: 'javascript:alert(1)' } }],
      });
    },
  );

  it.each(['text', 'sticky', 'image'] as const)(
    'hides a hostile %s link and carries it through a move',
    (type) => {
      const value = store();
      const id = `${type}-hostile-link`;
      value.transact(ADA, (transaction) => {
        transaction.setObject({ ...linkableFixture(type), id: id as never });
      });
      const peer = new Y.Doc();
      Y.applyUpdate(peer, value.encodeState());
      const map = peer.getMap<Y.Map<unknown>>('objects').get(id);
      if (map === undefined) throw new Error('Fixture object is missing');
      map.set('style', { ...(map.get('style') as object), link: 'javascript:alert(1)' });
      value.applyUpdate(Y.encodeStateAsUpdate(peer), RELAY);
      expect(value.read().issues).toEqual([]);
      expect(value.get(id as never)).not.toHaveProperty('link');
      applyCommand(value, moveObjectsCommand, { moves: [{ id, by: { x: 20, y: 10 } }] });
      expect(value.get(id as never)).not.toHaveProperty('link');
      expect(storedStyle(value, id)).toHaveProperty('link', 'javascript:alert(1)');
      peer.destroy();
    },
  );
});
