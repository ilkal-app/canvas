// A segment's ends and a member's id are whatever a peer stored, and lib0 carries a
// bigint, binary data and an object with no prototype. Judging the network (`String(end)` in a
// message, or `JSON.stringify`) threw on them out of every read, so every client that had the
// update failed on every later read and transaction. Now the segment is hidden and reported
// like any other with a missing end, in a message of bounded length. Real remote updates.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createDocumentMeta, DOCUMENT_META_KEY, META_MAP_NAME } from '../meta/document-meta.js';
import { ADA, createFixtureStore, id, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

/**
 * Receives a real update in which the fixture path's segment `s2` ends at `end` instead of `v3`.
 *
 * @param end - The value the peer stores as the segment's end `b`.
 * @returns The receiving store.
 */
function receiveSegmentEnd(end: unknown): ReturnType<typeof createFixtureStore> {
  const store = createFixtureStore();
  const remote = new Y.Doc();
  Y.applyUpdate(remote, store.encodeState());
  remote.transact(() => {
    remote.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, createDocumentMeta());
    const path = remote.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get('path-squiggle');
    const segments = path?.get('segments') as Y.Map<unknown>;
    const [order, segment] = segments.get('s2') as [number, Record<string, unknown>];
    segments.set('s2', [order, { ...segment, b: end }]);
  });
  const update = Y.encodeStateAsUpdate(remote, store.encodeStateVector());
  expect(() => {
    store.applyUpdate(update, RELAY);
  }).not.toThrow();
  remote.destroy();
  return store;
}

describe('a segment end a peer chose', () => {
  it.each([
    ['a very long string', 'v'.repeat(500_000), /missing vertex "v+"… \(500000 characters\)$/],
    ['an array', [1, [2]], /missing vertex an array of 2 items$/],
  ] as const)(
    '%s hides the segment and reports it, and the next transaction works',
    (kind, end, message) => {
      const store = receiveSegmentEnd(end);
      expect(() => store.read()).not.toThrow();
      const issues = store.read().issues.filter(({ code }) => code === 'hidden-segment');
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ key: 'path-squiggle', field: 'segments', member: 's2' });
      expect(issues[0]?.message).toMatch(message);
      expect(issues[0]?.message.length).toBeLessThan(200);
      expect(store.get(id('path-squiggle'))).toMatchObject({ segments: [{ id: 's1' }] });
      expect(() => {
        store.transact(ADA, (tx) => {
          tx.patchObject(id('frame-plan'), { x: 42 });
        });
      }).not.toThrow();
      expect(store.get(id('frame-plan'))?.x).toBe(42);
      store.destroy();
    },
  );

  // Fix round 1: an end JavaScript cannot convert (a bigint, an object with an own `toString`,
  // a `__proto__` prototype or none) makes the path unreadable, as `malformed-field`, instead of
  // a hidden segment: no code may see such a value, which throws on `<`, `+`, `String()` and
  // in a template literal. These two expectations changed from `hidden-segment` with the rule.
  it.each([
    ['a bigint', 12n],
    ['an object whose toString is not a function', { toString: 1 }],
    ['an object with no prototype', JSON.parse('{"__proto__":null}') as unknown],
    ['an object with a prototype set through __proto__', JSON.parse('{"__proto__":{"a":1}}')],
  ] as const)('makes the path unreadable when an end is %s', (kind, end) => {
    const store = receiveSegmentEnd(end);
    expect(store.get(id('path-squiggle'))).toBeUndefined();
    expect(store.read().issues).toContainEqual(
      expect.objectContaining({ code: 'malformed-field', key: 'path-squiggle' }),
    );
    store.destroy();
  });
});
