import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createDocumentMeta, DOCUMENT_META_KEY, META_MAP_NAME } from '../meta/document-meta.js';
import {
  ADA,
  createFixtureStore,
  fixtureObject,
  id,
  RELAY,
} from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

/**
 * Sends a new value for a plain field through a real update, without the local schema writer.
 *
 * @param value - The untrusted value sent by the peer.
 * @param objectId - The object whose stored field changes.
 * @param field - The stored plain field key.
 * @returns The receiver and sender, for recovery assertions and cleanup.
 */
function receivePlainValue(
  value: unknown,
  objectId = 'shape-box',
  field = 'locked',
): {
  store: ReturnType<typeof createFixtureStore>;
  remote: Y.Doc;
} {
  const store = createFixtureStore();
  const remote = new Y.Doc();
  Y.applyUpdate(remote, store.encodeState());
  remote.transact(() => {
    remote.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, createDocumentMeta());
    remote.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(objectId)?.set(field, value);
  });
  const update = Y.encodeStateAsUpdate(remote, store.encodeStateVector());
  expect(() => {
    store.applyUpdate(update, RELAY);
  }).not.toThrow();
  return { store, remote };
}

describe('binary values received in plain fields', () => {
  it.each([
    ['direct', () => new Uint8Array([1])],
    ['nested', () => ({ extension: [{ bytes: new Uint8Array([1]) }] })],
  ] as const)(
    'reports a %s remote typed array and keeps the next transaction usable',
    (kind, makeValue) => {
      const { store, remote } = receivePlainValue(makeValue());
      expect(store.get(id('shape-box'))).toBeUndefined();
      expect(store.read().issues).toContainEqual(
        expect.objectContaining({
          code: 'malformed-field',
          key: 'shape-box',
          field: 'locked',
        }),
      );
      expect(() => {
        store.transact(ADA, (tx) => {
          tx.patchObject(id('frame-plan'), { x: 42 });
        });
      }).not.toThrow();
      expect(store.get(id('frame-plan'))?.x).toBe(42);
      expect(Object.isFrozen(internalsOf(store).doc)).toBe(false);
      store.destroy();
      remote.destroy();
    },
  );
});

describe('other remote malformed fields and recovery', () => {
  it.each([
    ['subdocument', () => new Y.Doc(), 'shape-box', 'locked', 'locked'],
    ['pair member', () => new Y.Map(), 'line-divider', 'points.0', 'points'],
  ] as const)(
    'reports a remote %s without freezing the document',
    (kind, makeValue, objectId, field, issueField) => {
      const { store, remote } = receivePlainValue(makeValue(), objectId, field);
      expect(store.get(id(objectId))).toBeUndefined();
      expect(store.read().issues).toContainEqual(
        expect.objectContaining({
          code: 'malformed-field',
          key: objectId,
          field: issueField,
        }),
      );
      store.transact(ADA, (tx) => {
        tx.patchObject(id('frame-plan'), { x: 42 });
      });
      expect(store.get(id('frame-plan'))?.x).toBe(42);
      expect(Object.isFrozen(internalsOf(store).doc)).toBe(false);
      store.destroy();
      remote.destroy();
    },
  );

  it.each(['remote write', 'setObject'] as const)(
    'heals an unreadable object through a later %s',
    (kind) => {
      const { store, remote } = receivePlainValue(new Uint8Array([1]));
      expect(store.get(id('shape-box'))).toBeUndefined();
      expect(store.read().issues).toHaveLength(1);
      if (kind === 'remote write') {
        remote.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get('shape-box')?.set('locked', false);
        store.applyUpdate(Y.encodeStateAsUpdate(remote, store.encodeStateVector()), RELAY);
      } else {
        store.transact(ADA, (tx) => {
          tx.setObject(fixtureObject('shape-box', 'shape'));
        });
      }
      expect(store.read().issues).toEqual([]);
      expect(store.get(id('shape-box'))?.locked).toBe(false);
      store.transact(ADA, (tx) => {
        tx.patchObject(id('shape-box'), { x: 77 });
      });
      expect(store.get(id('shape-box'))?.x).toBe(77);
      store.destroy();
      remote.destroy();
    },
  );

  it('continues reading an already-supported 100-level remote extension without a new depth cap', () => {
    let chain: unknown = 1;
    for (let level = 0; level < 100; level += 1) chain = { extension: chain };
    // A connector's end is an object-kind field, so a nested extension may sit in it.
    const value = { kind: 'point', extension: chain };
    const { store, remote } = receivePlainValue(value, 'connector-flow', 'from');
    expect(store.read().issues).toEqual([]);
    expect(store.get(id('connector-flow'))).toMatchObject({ from: value });
    store.transact(ADA, (tx) => {
      tx.patchObject(id('frame-plan'), { x: 42 });
    });
    expect(store.get(id('frame-plan'))?.x).toBe(42);
    store.destroy();
    remote.destroy();
  });
});
