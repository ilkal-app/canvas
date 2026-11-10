import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { placeInstance, seedMainWithChildren } from '../commands/__fixtures__/component-boards.js';
import { setStyleCommand } from '../commands/set-style.js';
import { RELAY } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

// An instance's `colorMode` is its only style field, so its `style` group holds optional
// fields only. Instances stored before it have no `style` key: the reader takes the missing key as
// the empty group, and the writer adds the key only once a mode is set, so such instances stay as
// a layout 8 build stored them until then. (A main's `style` also holds its `name`.)

/**
 * An object's stored Yjs map.
 *
 * @param store - The store.
 * @param id - The object.
 * @returns Its map.
 */
function storedMap(store: YjsDocumentStore, id: string): Y.Map<unknown> {
  return internalsOf(store).objects.get(id) as Y.Map<unknown>;
}

describe('the optional style group of instances', () => {
  it('stores no style key until a mode is set, then reads and clears it', () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    const instanceId = placeInstance(store, mainId, { x: 1000, y: 0, instanceId: 'inst' });
    expect(storedMap(store, instanceId).has('style')).toBe(false);
    applyCommand(store, setStyleCommand, {
      changes: [
        { id: instanceId, style: { colorMode: 'dark' } },
        { id: mainId, style: { colorMode: 'light' } },
      ],
    });
    expect(storedMap(store, instanceId).get('style')).toEqual({ colorMode: 'dark' });
    expect(mustGet(store, mainId)).toMatchObject({ colorMode: 'light' });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: instanceId, style: { colorMode: null } }],
    });
    expect(storedMap(store, instanceId).get('style')).toEqual({});
    expect(mustGet(store, instanceId)).toMatchObject({ colorMode: undefined });
    store.destroy();
  });

  it('reads an instance a peer stored without a style key', () => {
    const source = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(source);
    placeInstance(source, mainId, { x: 1000, y: 0, instanceId: 'inst' });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, source.encodeState());
    expect((doc.getMap('objects').get('inst') as Y.Map<unknown>).has('style')).toBe(false);
    const reader = new YjsDocumentStore();
    reader.applyUpdate(Y.encodeStateAsUpdate(doc), RELAY);
    expect(reader.read().issues).toEqual([]);
    expect(mustGet(reader, 'inst')).toMatchObject({ type: 'instance', mainId });
    doc.destroy();
    source.destroy();
    reader.destroy();
  });
});
