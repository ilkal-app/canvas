// Real remote updates for the reader's tests: a peer that skips the local schema
// writer changes the fixture board through a raw Yjs document, and its update is applied to a
// store as the relay would deliver it.
import { expect } from 'vitest';
import * as Y from 'yjs';

import { createDocumentMeta, DOCUMENT_META_KEY, META_MAP_NAME } from '../../meta/document-meta.js';
import { createFixtureStore, RELAY } from '../../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../../store/yjs-document-store.js';
import { OBJECTS_MAP_NAME } from '../../store/yjs-document-store.js';

/** The receiver and the sender of a remote update. */
export interface Received {
  /** The store that applied the update. */
  readonly store: YjsDocumentStore;
  /** The sender's document, for later updates. */
  readonly remote: Y.Doc;
}

/**
 * Applies to a store holding the fixture board what a peer wrote through a raw document.
 *
 * @param write - Changes the peer's object map.
 * @param prepare - Runs on the store first, for example to make it compute a parent's top child.
 * @returns The store and the peer's document.
 */
export function receiveWrite(
  write: (objects: Y.Map<Y.Map<unknown>>) => void,
  prepare?: (store: YjsDocumentStore) => void,
): Received {
  const store = createFixtureStore();
  prepare?.(store);
  const remote = new Y.Doc();
  Y.applyUpdate(remote, store.encodeState());
  remote.transact(() => {
    remote.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, createDocumentMeta());
    write(remote.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME));
  });
  const update = Y.encodeStateAsUpdate(remote, store.encodeStateVector());
  expect(() => {
    store.applyUpdate(update, RELAY);
  }).not.toThrow();
  return { store, remote };
}

/**
 * Replaces one key of an object's map with a function of its stored value.
 *
 * @param objectId - The object.
 * @param key - The key of its map (a group, `z`, `locked`, ...).
 * @param change - Makes the new value from the stored one.
 * @returns A writer for {@link receiveWrite}.
 */
export function changeKey(
  objectId: string,
  key: string,
  change: (stored: unknown) => unknown,
): (objects: Y.Map<Y.Map<unknown>>) => void {
  return (objects) => {
    const map = objects.get(objectId);
    map?.set(key, change(map.get(key)));
  };
}

/**
 * Objects JavaScript cannot convert to a primitive, as lib0 carries them: an own `toString` that
 * is no function, a prototype set through `__proto__`, and no prototype at all. On each,
 * `<`, arithmetic, a template literal and `String()` throw.
 */
export const UNCONVERTIBLE: readonly (readonly [string, unknown])[] = [
  ['an own toString that is not a function', { toString: 1 }],
  ['a prototype set through __proto__', JSON.parse('{"__proto__": {"toString": 1}}') as unknown],
  ['no prototype', JSON.parse('{"__proto__": null}') as unknown],
];
