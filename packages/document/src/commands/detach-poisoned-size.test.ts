// The nightly's around-the-door fuzz saw the relay close an honest client for a size it
// never wrote ("hostile-values … size.width (not-finite)"). A detach turns an instance into a
// frame of the same id, which the store writes as a new map, every key at once; the door check
// judged its size against the stored instance, found it unchanged and let a width a peer left
// infinite go out, which the relay's door refuses once the hub has repaired it. A write that
// changes an object's type is now judged as the new object the codec stores, so the detach, and
// the deletion of a main that detaches its instances, is refused locally naming the size.
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { RELAY } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import { placeInstance, seedLeafMain } from './__fixtures__/component-boards.js';
import { mustFindCommand } from './__fixtures__/component-fixtures.js';

/**
 * A board of a leaf main `main-leaf` and an instance `inst-1` of it whose width a peer left
 * infinite, as a write around the relay's door leaves it.
 *
 * @returns The store.
 */
function poisonedInstanceBoard(): YjsDocumentStore {
  const store = new YjsDocumentStore();
  seedLeafMain(store, 'main-leaf', { x: 0, y: 0 });
  placeInstance(store, 'main-leaf', { x: 1000, y: 0, instanceId: 'inst-1' });
  const { doc, objects } = internalsOf(store);
  doc.transact(() => {
    const instance = objects.get('inst-1') as Y.Map<unknown>;
    const size = instance.get('size') as Record<string, unknown>;
    instance.set('size', { ...size, width: Number.POSITIVE_INFINITY });
  }, RELAY);
  return store;
}

describe('detaching an instance whose size a peer left past what the door takes', () => {
  it('refuses the detach naming the size, writing nothing', () => {
    const store = poisonedInstanceBoard();
    const errors = expectRejected(store, mustFindCommand('detachInstance'), { id: 'inst-1' });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'invalid-object', objectId: 'inst-1', path: ['width'] }),
    ]);
    expect(mustGet(store, 'inst-1').type).toBe('instance');
    store.destroy();
  });

  it("refuses deleting the main, which would detach the instance, naming the instance's size", () => {
    const store = poisonedInstanceBoard();
    const errors = expectRejected(store, mustFindCommand('deleteObjects'), { ids: ['main-leaf'] });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'invalid-object', objectId: 'inst-1', path: ['width'] }),
    ]);
    store.destroy();
  });

  it("names a refused copy's source in the main, never an id that was never stored", () => {
    // A copy is judged whole, as duplicatePage judges one, and named as its source there.
    const store = new YjsDocumentStore();
    const leafId = seedLeafMain(store, 'main-leaf', { x: 0, y: 0 });
    placeInstance(store, 'main-leaf', { x: 1000, y: 0, instanceId: 'inst-1' });
    const { doc, objects } = internalsOf(store);
    doc.transact(() => {
      const leaf = objects.get(leafId) as Y.Map<unknown>;
      const size = leaf.get('size') as Record<string, unknown>;
      leaf.set('size', { ...size, height: Number.POSITIVE_INFINITY });
    }, RELAY);
    const errors = expectRejected(store, mustFindCommand('detachInstance'), { id: 'inst-1' });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'invalid-object', objectId: leafId, path: ['height'] }),
    ]);
    store.destroy();
  });

  it('detaches once a write replaces the size', () => {
    const store = poisonedInstanceBoard();
    applyCommand(store, mustFindCommand('resizeObjects'), {
      resizes: [{ id: 'inst-1', to: { width: 160, height: 160 } }],
    });
    applyCommand(store, mustFindCommand('detachInstance'), { id: 'inst-1' });
    expect(mustGet(store, 'inst-1')).toMatchObject({ type: 'frame', width: 160 });
    store.destroy();
  });
});
