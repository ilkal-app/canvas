// Image borders live in style and tolerate refused stored values.
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import * as document from '@canvas/document';
import type { BoardObject, PrincipalId } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { RELAY, fixtureObject } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { toYjs } from './object-codec.js';
import { layoutOf } from './object-layout.js';
import { fromYjs } from './object-reader.js';

const ADA = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const BORDER = { color: { token: 'accent' }, width: 3 } as const;
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

function storedStyle(value: YjsDocumentStore, id: string): Readonly<Record<string, unknown>> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, value.encodeState());
  const style = doc.getMap<Y.Map<unknown>>('objects').get(id)?.get('style');
  doc.destroy();
  return style as Readonly<Record<string, unknown>>;
}

describe('image border document layout', () => {
  it('reserves layout 32 and reads layout 31', () => {
    // 32, not 31: took 31 first (the ledger's swap).
    expect((document as unknown as Record<string, unknown>).IMAGE_BORDER_LAYOUT_VERSION).toBe(32);
    expect(document.DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(32);
    expect(document.READABLE_LAYOUT_VERSIONS).toContain(31);
  });

  it('stores a border in style and leaves an absent border absent', () => {
    const style = layoutOf('image')?.codecs.find(
      (codec) => codec.kind === 'group' && codec.key === 'style',
    );
    expect(style).toMatchObject({ fields: expect.arrayContaining(['border']) as unknown });
    const image = fixtureObject('image-photo', 'image');
    const absent = roundTrip(image);
    expect(absent.map.get('style')).not.toHaveProperty('border');
    expect(absent.read).not.toHaveProperty('border');
    const present = roundTrip({ ...image, border: BORDER });
    expect(present.map.get('style')).toHaveProperty('border', BORDER);
    expect(present.read).toHaveProperty('border', BORDER);
    const none = roundTrip({ ...image, border: null });
    expect(none.read).toHaveProperty('border', null);
  });

  it('hides a refused stored border and carries its raw value through a move', () => {
    const value = store();
    const id = 'hostile-image';
    value.transact(ADA, (transaction) => {
      transaction.setObject({ ...fixtureObject('image-photo', 'image'), id: id as never });
    });
    const peer = new Y.Doc();
    Y.applyUpdate(peer, value.encodeState());
    const map = peer.getMap<Y.Map<unknown>>('objects').get(id);
    if (map === undefined) throw new Error('Fixture image is missing');
    const refused = { color: 'ink', width: 0 };
    map.set('style', { ...(map.get('style') as object), border: refused });
    value.applyUpdate(Y.encodeStateAsUpdate(peer), RELAY);
    expect(value.read().issues).toEqual([]);
    expect(value.get(id as never)).not.toHaveProperty('border');
    applyCommand(value, moveObjectsCommand, { moves: [{ id, by: { x: 20, y: 10 } }] });
    expect(value.get(id as never)).not.toHaveProperty('border');
    expect(storedStyle(value, id)).toHaveProperty('border', refused);
    peer.destroy();
  });
});
