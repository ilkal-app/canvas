// A `bigint` in an object's `id` or `type` came out of `fromYjs` as a TypeError (the
// issue messages used `JSON.stringify`, which throws on a bigint), and nothing caught it:
// `ObjectCache.flush` rethrew on every later read and transaction, on every client that had
// the update. lib0 carries bigint on the wire, so a peer can send one. These tests send real
// updates.
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

import { deepFreeze } from './deep-freeze.js';
import { toYjs } from './object-codec.js';
import { fromYjs } from './object-reader.js';

/**
 * Sends a change of one object's `identity` group through a real update: what a peer that
 * skips the local schema writer can send.
 *
 * @param change - The fields of `identity` to replace.
 * @returns The receiver and the sender, for the assertions and cleanup.
 */
function receiveIdentity(change: Readonly<Record<string, unknown>>): {
  readonly store: ReturnType<typeof createFixtureStore>;
  readonly remote: Y.Doc;
} {
  const store = createFixtureStore();
  const remote = new Y.Doc();
  Y.applyUpdate(remote, store.encodeState());
  remote.transact(() => {
    remote.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, createDocumentMeta());
    const map = remote.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get('shape-box');
    const identity = map?.get('identity') as Record<string, unknown>;
    map?.set('identity', { ...identity, ...change });
  });
  const update = Y.encodeStateAsUpdate(remote, store.encodeStateVector());
  expect(() => {
    store.applyUpdate(update, RELAY);
  }).not.toThrow();
  return { store, remote };
}

/**
 * Checks the receiver still works: it reads, and its next transaction succeeds and is seen.
 *
 * @param store - The receiving store.
 */
function expectUsable(store: ReturnType<typeof createFixtureStore>): void {
  expect(() => store.read()).not.toThrow();
  expect(() => {
    store.transact(ADA, (tx) => {
      tx.patchObject(id('frame-plan'), { x: 42 });
    });
  }).not.toThrow();
  expect(store.get(id('frame-plan'))?.x).toBe(42);
  expect(Object.isFrozen(internalsOf(store).doc)).toBe(false);
}

describe('a bigint in an identity, received in a real update', () => {
  it('reports a bigint type as malformed and keeps the next transaction usable', () => {
    const { store, remote } = receiveIdentity({ type: 10n });
    expect(store.get(id('shape-box'))).toBeUndefined();
    expect(store.read().issues).toContainEqual({
      code: 'malformed-field',
      key: 'shape-box',
      field: 'identity',
      message: 'the type contains a shared, binary, bigint or unconvertible value',
    });
    expectUsable(store);
    store.destroy();
    remote.destroy();
  });

  it('reports a bigint id as malformed and keeps the next transaction usable', () => {
    const { store, remote } = receiveIdentity({ id: 2n ** 62n });
    expect(store.get(id('shape-box'))).toBeUndefined();
    expect(store.read().issues).toContainEqual({
      code: 'malformed-field',
      key: 'shape-box',
      field: 'id',
      message: 'id: a plain field contains a shared, binary, bigint or unconvertible value',
    });
    expectUsable(store);
    store.destroy();
    remote.destroy();
  });

  it('words a type and an id that are not text without stringifying them', () => {
    const type = receiveIdentity({ type: [1, [2]] });
    expect(type.store.read().issues).toContainEqual({
      code: 'unknown-type',
      key: 'shape-box',
      field: 'identity',
      message: 'unknown object type an array of 2 items',
    });
    expectUsable(type.store);
    const identity = receiveIdentity({ id: {} });
    expect(identity.store.read().issues).toContainEqual({
      code: 'malformed-field',
      key: 'shape-box',
      field: 'id',
      message: 'id: expected a string',
    });
    expectUsable(identity.store);
  });

  it('heals when a later update brings a readable identity back', () => {
    const { store, remote } = receiveIdentity({ type: 10n });
    const identity = fixtureObject('shape-box', 'shape');
    remote.transact(() => {
      const map = remote.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get('shape-box');
      map?.set('identity', {
        id: identity.id,
        type: identity.type,
        createdBy: identity.createdBy,
        createdAt: identity.createdAt,
      });
    });
    store.applyUpdate(Y.encodeStateAsUpdate(remote, store.encodeStateVector()), RELAY);
    expect(store.read().issues).toEqual([]);
    expect(store.get(id('shape-box'))?.type).toBe('shape');
    store.destroy();
    remote.destroy();
  });

  it('cuts a very long type and id in the message', () => {
    const { store, remote } = receiveIdentity({ type: 'x'.repeat(200_000) });
    const [issue] = store.read().issues;
    expect(issue?.code).toBe('unknown-type');
    expect(issue?.message.length).toBeLessThan(200);
    expectUsable(store);
    store.destroy();
    remote.destroy();
  });
});

describe('a bigint anywhere in a plain field, received in a real update', () => {
  it.each([
    [
      'a group field',
      'shape-box',
      'placement',
      (group: Record<string, unknown>) => ({ ...group, x: 3n }),
    ],
    [
      'a nested array',
      'shape-box',
      'style',
      (group: Record<string, unknown>) => ({ ...group, fill: [1, 2n, 0, 1] }),
    ],
    [
      'a nested extension key',
      'shape-box',
      'style',
      (group: Record<string, unknown>) => ({
        ...group,
        stroke: { color: [0, 0, 0, 1], width: 2, extra: { deep: [{ n: 1n }] } },
      }),
    ],
  ] as const)(
    '%s makes the object unreadable, not a later TypeError',
    (kind, objectId, key, change) => {
      const store = createFixtureStore();
      const remote = new Y.Doc();
      Y.applyUpdate(remote, store.encodeState());
      remote.transact(() => {
        remote.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, createDocumentMeta());
        const map = remote.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(objectId);
        map?.set(key, change(map.get(key) as Record<string, unknown>));
      });
      store.applyUpdate(Y.encodeStateAsUpdate(remote, store.encodeStateVector()), RELAY);
      expect(store.get(id(objectId))).toBeUndefined();
      expect(store.read().issues).toContainEqual(
        expect.objectContaining({ code: 'malformed-field', key: objectId }),
      );
      expectUsable(store);
      store.destroy();
      remote.destroy();
    },
  );

  it('makes a path with a bigint in a vertex unreadable', () => {
    const store = createFixtureStore();
    const remote = new Y.Doc();
    Y.applyUpdate(remote, store.encodeState());
    remote.transact(() => {
      remote.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, createDocumentMeta());
      const map = remote.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get('path-squiggle');
      const vertices = map?.get('vertices') as Y.Map<unknown>;
      const [order, vertex] = vertices.get('v1') as [number, Record<string, unknown>];
      vertices.set('v1', [order, { ...vertex, x: 7n }]);
    });
    store.applyUpdate(Y.encodeStateAsUpdate(remote, store.encodeStateVector()), RELAY);
    expect(store.get(id('path-squiggle'))).toBeUndefined();
    expect(store.read().issues).toContainEqual(
      expect.objectContaining({ code: 'malformed-field', key: 'path-squiggle' }),
    );
    expectUsable(store);
    store.destroy();
    remote.destroy();
  });
});

describe('a deeply nested plain field, read by the codec alone', () => {
  it('reads and freezes a 20,000-level value without overflowing the stack', () => {
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME);
    const shape = fixtureObject('shape-box', 'shape');
    objects.set(shape.id, toYjs(shape));
    const map = objects.get(shape.id);
    let deep: unknown = 'leaf';
    for (let level = 0; level < 20_000; level += 1) deep = { next: deep };
    const style = map?.get('style') as Record<string, unknown>;
    map?.set('style', { ...style, stroke: deep });
    const decoded = fromYjs(shape.id, map);
    if (!('object' in decoded)) throw new Error(JSON.stringify(decoded.issue));
    let level = 0;
    let node: unknown = (decoded.object as unknown as { stroke: unknown }).stroke;
    while (typeof node === 'object' && node !== null) {
      expect(Object.isFrozen(node)).toBe(true);
      node = (node as { next: unknown }).next;
      level += 1;
    }
    expect(level).toBe(20_000);
    expect(node).toBe('leaf');
    doc.destroy();
  });

  it('freezes what deepFreeze is given, shared members and cycles included', () => {
    const shared = { leaf: [1, { two: 2 }] };
    const value: Record<string, unknown> = { first: shared, second: shared, list: [shared] };
    value.self = value;
    const frozen = deepFreeze(value);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(shared)).toBe(true);
    expect(Object.isFrozen(shared.leaf)).toBe(true);
    expect(Object.isFrozen(shared.leaf[1])).toBe(true);
  });
});
